-- PROPOSAL ONLY: do not run on the connected project until explicitly approved.
-- Verified against Hospital Móviles uvebpsbbwofthucghccc. PostgreSQL 17.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

ALTER TABLE public.doctor_schedules ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.doctor_schedules ADD COLUMN consulting_assignment_id uuid
 REFERENCES public.doctor_consulting_rooms(id) ON DELETE RESTRICT;
ALTER TABLE public.doctor_schedules ADD CONSTRAINT planning_finite_schedule
 CHECK (NOT active OR (valid_until IS NOT NULL AND valid_until-valid_from BETWEEN 0 AND 366));
ALTER TABLE public.doctor_consulting_rooms ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.doctor_consulting_rooms ADD COLUMN slot_minutes integer NOT NULL DEFAULT 30
 CHECK (slot_minutes BETWEEN 5 AND 180);
ALTER TABLE public.staff_absences ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.doctor_consulting_rooms DROP CONSTRAINT doctor_consulting_rooms_consulting_room_id_tstzrange_excl;
ALTER TABLE public.doctor_consulting_rooms DROP CONSTRAINT doctor_consulting_rooms_doctor_id_tstzrange_excl;
ALTER TABLE public.doctor_consulting_rooms ADD CONSTRAINT planning_room_overlap
 EXCLUDE USING gist (consulting_room_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (active);
ALTER TABLE public.doctor_consulting_rooms ADD CONSTRAINT planning_doctor_overlap
 EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (active);
ALTER TABLE public.staff_absences ADD CONSTRAINT planning_absence_overlap
 EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (active);
CREATE INDEX planning_schedule_assignment_idx ON public.doctor_schedules(consulting_assignment_id);
CREATE INDEX planning_schedule_doctor_idx ON public.doctor_schedules(doctor_id,valid_from,valid_until) WHERE active;

-- One transaction lock shared by appointments and planning prevents write skew.
-- All entrypoints use READ COMMITTED so checks after waiting see the latest commit.
CREATE FUNCTION private.planning_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'La programación requiere aislamiento READ COMMITTED';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 RETURN NULL;
END $$;

CREATE FUNCTION private.planning_medical_coverage(p_doctor uuid,p_start timestamptz,p_end timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT range_agg(tstzrange(
   (d.day::date+s.start_time) AT TIME ZONE 'America/Guatemala',
   (d.day::date+s.end_time) AT TIME ZONE 'America/Guatemala','[)')) @> tstzrange(p_start,p_end,'[)')
 FROM generate_series((p_start AT TIME ZONE 'America/Guatemala')::date::timestamp,
   ((p_end-interval '1 microsecond') AT TIME ZONE 'America/Guatemala')::date::timestamp,interval '1 day') d(day)
 JOIN public.doctor_schedules s ON s.doctor_id=p_doctor AND s.active
  AND s.weekday=extract(dow FROM d.day) AND d.day::date BETWEEN s.valid_from AND s.valid_until),false)
$$;

CREATE FUNCTION private.planning_valid_slot(p_doctor uuid,p_room uuid,p_start timestamptz,p_end timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_end>p_start
 AND EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles r ON r.user_id=s.profile_id
   AND r.role='doctor' AND r.active WHERE s.id=p_doctor AND s.active AND s.category='doctor')
 AND EXISTS(SELECT 1 FROM public.consulting_rooms WHERE id=p_room AND active)
 AND EXISTS(SELECT 1 FROM public.staff_shifts WHERE staff_id=p_doctor AND status<>'cancelado'
   AND starts_at<=p_start AND ends_at>=p_end)
 AND NOT EXISTS(SELECT 1 FROM public.staff_absences WHERE staff_id=p_doctor AND active
   AND tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,p_end,'[)'))
 AND private.planning_medical_coverage(p_doctor,p_start,p_end)
 AND EXISTS(SELECT 1 FROM public.doctor_consulting_rooms a WHERE a.doctor_id=p_doctor
   AND a.consulting_room_id=p_room AND a.active AND a.starts_at<=p_start AND a.ends_at>=p_end
   AND extract(epoch FROM p_end-p_start)=a.slot_minutes*60
   AND mod(extract(epoch FROM p_start-a.starts_at),a.slot_minutes*60)=0)
$$;

CREATE FUNCTION private.assert_staff_planning() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Every recurring medical window must be covered by a working shift.
 IF EXISTS(
  SELECT 1 FROM public.doctor_schedules s
  CROSS JOIN LATERAL generate_series(s.valid_from::timestamp,s.valid_until::timestamp,interval '1 day') d(day)
  WHERE s.active AND s.weekday=extract(dow FROM d.day)
  AND (d.day::date+s.end_time) AT TIME ZONE 'America/Guatemala'>now()
  AND NOT EXISTS(SELECT 1 FROM public.staff_shifts w WHERE w.staff_id=s.doctor_id AND w.status<>'cancelado'
   AND w.starts_at <= (d.day::date+s.start_time) AT TIME ZONE 'America/Guatemala'
   AND w.ends_at >= (d.day::date+s.end_time) AT TIME ZONE 'America/Guatemala')) THEN
  RAISE EXCEPTION 'La consulta debe estar dentro del horario laboral. Ajusta o desactiva primero la consulta';
 END IF;
 IF EXISTS(
  WITH windows AS MATERIALIZED (
   SELECT s.id,s.doctor_id,tstzrange((d.day::date+s.start_time) AT TIME ZONE 'America/Guatemala',
    (d.day::date+s.end_time) AT TIME ZONE 'America/Guatemala','[)') period
   FROM public.doctor_schedules s CROSS JOIN LATERAL
    generate_series(s.valid_from::timestamp,s.valid_until::timestamp,interval '1 day')d(day)
   WHERE s.active AND s.weekday=extract(dow FROM d.day))
  SELECT 1 FROM windows a JOIN windows b ON a.id<b.id AND a.doctor_id=b.doctor_id AND a.period&&b.period
  WHERE upper(a.period)>now()) THEN RAISE EXCEPTION 'Los horarios médicos se solapan'; END IF;
 IF EXISTS(SELECT 1 FROM public.doctor_consulting_rooms a
  LEFT JOIN public.staff s ON s.id=a.doctor_id
  LEFT JOIN public.consulting_rooms r ON r.id=a.consulting_room_id
  WHERE a.active AND a.ends_at>now() AND (
   NOT s.active OR s.category<>'doctor' OR NOT r.active
   OR NOT EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.role='doctor' AND u.active)
   OR mod(extract(epoch FROM a.ends_at-a.starts_at),a.slot_minutes*60)<>0
   OR NOT private.planning_medical_coverage(a.doctor_id,a.starts_at,a.ends_at)
   OR NOT EXISTS(SELECT 1 FROM public.staff_shifts w WHERE w.staff_id=a.doctor_id AND w.status<>'cancelado'
    AND w.starts_at<=a.starts_at AND w.ends_at>=a.ends_at))) THEN
  RAISE EXCEPTION 'Consultorio, doctor o jornada no válidos; la duración debe ser múltiplo de la cita';
 END IF;
 IF EXISTS(SELECT 1 FROM public.appointments a
   WHERE a.status IN('programada','confirmada','en_atencion') AND a.ends_at>now()
   AND NOT private.planning_valid_slot(a.doctor_id,a.consulting_room_id,a.starts_at,a.ends_at)) THEN
  RAISE EXCEPTION 'Conflicto con citas vigentes. Reprograma explícitamente las citas antes de cambiar la jornada, ausencia o consultorio';
 END IF;
END $$;

CREATE FUNCTION private.planning_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.assert_staff_planning();
 IF TG_TABLE_NAME IN('staff_shifts','staff_absences','doctor_schedules','doctor_consulting_rooms','consulting_rooms') THEN
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id)
   VALUES(auth.uid(),'planning_'||lower(TG_OP),TG_TABLE_NAME,coalesce(NEW.id,OLD.id)::text);
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['staff_shifts','staff_absences','doctor_schedules','doctor_consulting_rooms','consulting_rooms','appointments','staff','user_roles'] LOOP
  EXECUTE format('CREATE TRIGGER planning_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.planning_lock()',t);
  EXECUTE format('CREATE CONSTRAINT TRIGGER planning_guard AFTER INSERT OR UPDATE OR DELETE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.planning_guard()',t);
 END LOOP;
END $$;

-- Existing appointment RPC signature remains compatible with iOS / Android.
CREATE OR REPLACE FUNCTION public.schedule_appointment(p_patient uuid,p_doctor uuid,p_room uuid,p_start timestamptz,p_end timestamptz,p_request uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF NOT (private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_start<=now() OR NOT private.planning_valid_slot(p_doctor,p_room,p_start,p_end) THEN
  RAISE EXCEPTION 'Cita fuera de disponibilidad, descanso o duración configurada'; END IF;
 IF p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointment_requests
  WHERE id=p_request AND patient_id=p_patient AND status IN('pendiente','en_revision')) THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
 INSERT INTO public.appointments(request_id,patient_id,doctor_id,consulting_room_id,starts_at,ends_at,created_by)
 VALUES(p_request,p_patient,p_doctor,p_room,p_start,p_end,auth.uid()) RETURNING id INTO v_id;
 IF p_request IS NOT NULL THEN UPDATE public.appointment_requests SET status='agendada',reviewed_by=auth.uid() WHERE id=p_request; END IF;
 INSERT INTO public.appointment_status_history(appointment_id,new_status,actor_id) VALUES(v_id,'programada',auth.uid());
 RETURN v_id;
END $$;

-- RLS: own medical schedules for doctors; necessary availability for reception.
DROP POLICY schedules_read ON public.doctor_schedules;
CREATE POLICY schedules_read ON public.doctor_schedules FOR SELECT TO authenticated
 USING(private.has_role('admin') OR private.has_role('recepcionista') OR doctor_id=private.my_staff_id());
DROP POLICY doctor_rooms_read ON public.doctor_consulting_rooms;
CREATE POLICY doctor_rooms_read ON public.doctor_consulting_rooms FOR SELECT TO authenticated
 USING(private.has_role('admin') OR private.has_role('recepcionista') OR doctor_id=private.my_staff_id());
DROP POLICY absences_read ON public.staff_absences;
CREATE POLICY absences_read ON public.staff_absences FOR SELECT TO authenticated
 USING(private.has_role('admin') OR staff_id=private.my_staff_id());

-- Admin RPC uses SECURITY INVOKER: table privileges and RLS are enforced.
CREATE FUNCTION public.save_staff_planning(p_kind text,p_values jsonb,p_id uuid DEFAULT NULL,p_version text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 v_staff uuid; v_start timestamptz; v_end timestamptz; v_day date; v_dates date[];
 v_room uuid; v_id uuid; v_existing text; v_minutes integer; v_segment timestamptz;
 v_boundary timestamptz; v_active boolean; v_row record;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede configurar horarios'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
 IF p_kind NOT IN('shift','absence','consultation','room') THEN RAISE EXCEPTION 'Operación inválida'; END IF;
 v_active:=coalesce((p_values->>'active')::boolean,true);
 IF p_id IS NOT NULL THEN
  CASE p_kind
   WHEN 'shift' THEN SELECT xmin::text INTO v_existing FROM public.staff_shifts WHERE id=p_id FOR UPDATE;
   WHEN 'absence' THEN SELECT xmin::text INTO v_existing FROM public.staff_absences WHERE id=p_id FOR UPDATE;
   WHEN 'consultation' THEN SELECT xmin::text INTO v_existing FROM public.doctor_consulting_rooms WHERE id=p_id FOR UPDATE;
   WHEN 'room' THEN SELECT xmin::text INTO v_existing FROM public.consulting_rooms WHERE id=p_id FOR UPDATE;
  END CASE;
  IF v_existing IS NULL OR p_version IS DISTINCT FROM v_existing THEN RAISE EXCEPTION 'El registro cambió. Actualiza la programación'; END IF;
 END IF;
 IF p_kind='room' THEN
  IF nullif(trim(p_values->>'code'),'') IS NULL OR length(p_values->>'code')>40 THEN RAISE EXCEPTION 'Código de consultorio obligatorio (máximo 40 caracteres)'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO public.consulting_rooms(code,floor_id,active) VALUES(trim(p_values->>'code'),nullif(p_values->>'floor_id','')::smallint,v_active) RETURNING id INTO v_id;
  ELSE
   UPDATE public.consulting_rooms SET code=trim(p_values->>'code'),floor_id=nullif(p_values->>'floor_id','')::smallint,active=v_active WHERE id=p_id RETURNING id INTO v_id;
  END IF;
 ELSE
  v_staff:=(p_values->>'staff_id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=v_staff AND (active OR NOT v_active)) THEN RAISE EXCEPTION 'Selecciona personal activo'; END IF;
  IF p_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM public.staff_shifts WHERE p_kind='shift' AND id=p_id AND staff_id<>v_staff
   UNION ALL SELECT 1 FROM public.staff_absences WHERE p_kind='absence' AND id=p_id AND staff_id<>v_staff
   UNION ALL SELECT 1 FROM public.doctor_consulting_rooms WHERE p_kind='consultation' AND id=p_id AND doctor_id<>v_staff) THEN RAISE EXCEPTION 'No se puede cambiar el empleado del registro'; END IF;
  SELECT array_agg(x::date ORDER BY x) INTO v_dates FROM (SELECT DISTINCT value #>> '{}' AS x FROM jsonb_array_elements(p_values->'dates'))d;
  IF cardinality(v_dates) IS NULL OR cardinality(v_dates) NOT BETWEEN 1 AND 84 OR
   v_dates[cardinality(v_dates)]-v_dates[1]>366 OR (p_id IS NOT NULL AND cardinality(v_dates)<>1) THEN RAISE EXCEPTION 'Selecciona entre 1 y 84 días (edición: un día)'; END IF;
  IF (p_values->>'start_time')::time IS NULL OR (p_values->>'end_time')::time IS NULL OR
   (p_values->>'start_time')::time=(p_values->>'end_time')::time THEN RAISE EXCEPTION 'Entrada y salida deben ser diferentes'; END IF;
  FOREACH v_day IN ARRAY v_dates LOOP
   v_start:=(v_day+(p_values->>'start_time')::time) AT TIME ZONE 'America/Guatemala';
   v_end:=((v_day+CASE WHEN (p_values->>'end_time')::time<(p_values->>'start_time')::time THEN 1 ELSE 0 END)+(p_values->>'end_time')::time) AT TIME ZONE 'America/Guatemala';
   IF v_end<=v_start OR v_end-v_start>interval '24 hours' OR (p_id IS NULL AND v_start<now()) THEN RAISE EXCEPTION 'Horario inválido o fecha pasada'; END IF;
   IF p_kind='shift' THEN
    IF coalesce(p_values->>'shift_type','') NOT IN('ordinario','guardia') THEN RAISE EXCEPTION 'Tipo de turno inválido'; END IF;
    IF p_id IS NULL THEN
     INSERT INTO public.staff_shifts(staff_id,starts_at,ends_at,shift_type,status) VALUES(v_staff,v_start,v_end,p_values->>'shift_type',CASE WHEN v_active THEN 'programado' ELSE 'cancelado' END) RETURNING id INTO v_id;
    ELSE
     UPDATE public.staff_shifts SET starts_at=v_start,ends_at=v_end,shift_type=p_values->>'shift_type',status=CASE WHEN v_active THEN 'programado' ELSE 'cancelado' END WHERE id=p_id RETURNING id INTO v_id;
    END IF;
   ELSIF p_kind='absence' THEN
    IF nullif(trim(p_values->>'reason'),'') IS NULL OR length(p_values->>'reason')>500 THEN RAISE EXCEPTION 'Indica un motivo de hasta 500 caracteres'; END IF;
    IF p_id IS NULL THEN
     INSERT INTO public.staff_absences(staff_id,starts_at,ends_at,reason,active) VALUES(v_staff,v_start,v_end,trim(p_values->>'reason'),v_active) RETURNING id INTO v_id;
    ELSE
     UPDATE public.staff_absences SET starts_at=v_start,ends_at=v_end,reason=trim(p_values->>'reason'),active=v_active WHERE id=p_id RETURNING id INTO v_id;
    END IF;
   ELSE
    IF v_active AND NOT EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles r ON r.user_id=s.profile_id WHERE s.id=v_staff AND s.category='doctor' AND r.role='doctor' AND r.active) THEN RAISE EXCEPTION 'Selecciona un doctor con rol activo'; END IF;
    v_room:=(p_values->>'room_id')::uuid; v_minutes:=(p_values->>'slot_minutes')::integer;
    IF v_room IS NULL OR v_minutes IS NULL OR v_minutes NOT BETWEEN 5 AND 180 THEN RAISE EXCEPTION 'Consultorio y duración de cita (5–180 minutos) obligatorios'; END IF;
    IF p_id IS NULL THEN
     INSERT INTO public.doctor_consulting_rooms(doctor_id,consulting_room_id,starts_at,ends_at,slot_minutes,active) VALUES(v_staff,v_room,v_start,v_end,v_minutes,v_active) RETURNING id INTO v_id;
    ELSE
     UPDATE public.doctor_consulting_rooms SET consulting_room_id=v_room,starts_at=v_start,ends_at=v_end,slot_minutes=v_minutes,active=v_active WHERE id=p_id RETURNING id INTO v_id;
     UPDATE public.doctor_schedules SET active=false WHERE consulting_assignment_id=p_id AND active;
    END IF;
    v_segment:=v_start;
    WHILE v_segment<v_end LOOP
     v_boundary:=least(v_end,(((v_segment AT TIME ZONE 'America/Guatemala')::date+1)::timestamp AT TIME ZONE 'America/Guatemala'));
     INSERT INTO public.doctor_schedules(doctor_id,weekday,start_time,end_time,valid_from,valid_until,active,consulting_assignment_id)
     VALUES(v_staff,extract(dow FROM v_segment AT TIME ZONE 'America/Guatemala'),
      (v_segment AT TIME ZONE 'America/Guatemala')::time,
      CASE WHEN (v_boundary AT TIME ZONE 'America/Guatemala')::time='00:00' THEN '24:00'::time ELSE (v_boundary AT TIME ZONE 'America/Guatemala')::time END,
      (v_segment AT TIME ZONE 'America/Guatemala')::date,(v_segment AT TIME ZONE 'America/Guatemala')::date,v_active,v_id);
     v_segment:=v_boundary;
    END LOOP;
   END IF;
  END LOOP;
 END IF;
 -- Deferrable guards inspect the final state of all records in this batch.
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN jsonb_build_object('id',v_id,'count',coalesce(cardinality(v_dates),1));
END $$;

CREATE FUNCTION public.read_staff_planning(p_from timestamptz,p_until timestamptz)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración'; END IF;
 IF p_until<=p_from OR p_until-p_from>interval '32 days' THEN RAISE EXCEPTION 'Rango de lectura inválido'; END IF;
 SELECT jsonb_build_object('ready',true,
  'staff',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.id,s.profile_id,s.employee_code,s.category,s.active,p.first_name,p.last_name FROM public.staff s LEFT JOIN public.profiles p ON p.id=s.profile_id ORDER BY s.employee_code)x),
  'rooms',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT r.*,r.xmin::text version FROM public.consulting_rooms r ORDER BY code)x),
  'floors',(SELECT coalesce(jsonb_agg(f),'[]') FROM public.hospital_floors f),
  'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.*,s.xmin::text version FROM public.staff_shifts s WHERE s.starts_at<p_until AND s.ends_at>p_from ORDER BY starts_at)x),
  'absences',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT a.*,a.xmin::text version FROM public.staff_absences a WHERE a.starts_at<p_until AND a.ends_at>p_from ORDER BY starts_at)x),
  'consultations',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT a.*,a.xmin::text version FROM public.doctor_consulting_rooms a WHERE a.starts_at<p_until AND a.ends_at>p_from ORDER BY starts_at)x)
 ) INTO v;
 RETURN v;
END $$;

CREATE FUNCTION public.get_medical_availability(p_from timestamptz,p_until timestamptz,p_doctor uuid DEFAULT NULL,p_room uuid DEFAULT NULL)
 RETURNS TABLE(doctor_id uuid,doctor_name text,consulting_room_id uuid,room_code text,starts_at timestamptz,ends_at timestamptz,slot_minutes integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista') OR private.has_role('doctor')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>interval '31 days' THEN RAISE EXCEPTION 'Consulta como máximo 31 días'; END IF;
 RETURN QUERY SELECT a.doctor_id,concat_ws(' ',p.first_name,p.last_name),a.consulting_room_id,r.code,g.t,g.t+make_interval(mins=>a.slot_minutes),a.slot_minutes
 FROM public.doctor_consulting_rooms a JOIN public.staff s ON s.id=a.doctor_id
 JOIN public.profiles p ON p.id=s.profile_id JOIN public.consulting_rooms r ON r.id=a.consulting_room_id
 CROSS JOIN LATERAL generate_series(greatest(a.starts_at,a.starts_at+ceil(greatest(0,extract(epoch FROM greatest(p_from,now())-a.starts_at))/(a.slot_minutes*60))*make_interval(mins=>a.slot_minutes)),
  least(a.ends_at,p_until)-make_interval(mins=>a.slot_minutes),make_interval(mins=>a.slot_minutes))g(t)
 WHERE a.active AND (p_doctor IS NULL OR a.doctor_id=p_doctor) AND(p_room IS NULL OR a.consulting_room_id=p_room)
 AND(private.has_role('admin') OR private.has_role('recepcionista') OR a.doctor_id=private.my_staff_id())
 AND private.planning_valid_slot(a.doctor_id,a.consulting_room_id,g.t,g.t+make_interval(mins=>a.slot_minutes))
 AND NOT EXISTS(SELECT 1 FROM public.appointments b WHERE b.doctor_id=a.doctor_id AND b.status IN('programada','confirmada','en_atencion') AND tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(g.t,g.t+make_interval(mins=>a.slot_minutes),'[)'))
 ORDER BY g.t,r.code;
END $$;

REVOKE ALL ON FUNCTION private.planning_lock(),private.planning_medical_coverage(uuid,timestamptz,timestamptz),private.planning_valid_slot(uuid,uuid,timestamptz,timestamptz),private.assert_staff_planning(),private.planning_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_staff_planning(text,jsonb,uuid,text),public.read_staff_planning(timestamptz,timestamptz),public.get_medical_availability(timestamptz,timestamptz,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_staff_planning(text,jsonb,uuid,text),public.read_staff_planning(timestamptz,timestamptz),public.get_medical_availability(timestamptz,timestamptz,uuid,uuid) TO authenticated;
-- Existing appointment RPC already has restricted grants; reassert explicitly.
REVOKE ALL ON FUNCTION public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid) TO authenticated;
SELECT private.assert_staff_planning();
NOTIFY pgrst,'reload schema';
COMMIT;
