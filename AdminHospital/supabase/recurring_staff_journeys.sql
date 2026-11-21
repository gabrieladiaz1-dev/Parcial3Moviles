-- PREPARED MIGRATION. Apply only after preflight and an authorized deployment.
-- One persistent version per definition; occurrences are computed, never materialized weekly.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regprocedure('public.read_staff_planning(timestamptz,timestamptz)') IS NULL
 OR to_regprocedure('private.planning_valid_slot(uuid,uuid,timestamptz,timestamptz)') IS NULL
 OR to_regprocedure('private.assert_staff_planning()') IS NULL
 OR to_regprocedure('public.get_medical_availability(timestamptz,timestamptz,uuid,uuid)') IS NULL
 OR to_regprocedure('public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid)') IS NULL
 OR to_regprocedure('private.planning_lock()') IS NULL OR to_regprocedure('private.planning_guard()') IS NULL
 THEN RAISE EXCEPTION 'Faltan contratos de planificación. No aplicar esta migración.'; END IF;
 IF strpos(pg_get_functiondef('public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure),'private.planning_valid_slot')=0 THEN RAISE EXCEPTION 'La programación de citas no usa el validador esperado. Revisar compatibilidad antes de aplicar.'; END IF;
 IF to_regclass('public.staff_recurring_journeys') IS NOT NULL THEN RAISE EXCEPTION 'Migración ya instalada; no volver a aplicar'; END IF;
END $$;

CREATE TABLE public.staff_recurring_journeys (
 id uuid PRIMARY KEY,
 staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
 staff_role text NOT NULL CHECK(staff_role IN('doctor','recepcionista')),
 weekdays smallint[] NOT NULL CHECK(cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays<@ARRAY[0,1,2,3,4,5,6]::smallint[]),
 start_time time NOT NULL, end_time time NOT NULL CHECK(start_time<>end_time),
 shift_type text NOT NULL CHECK(shift_type IN('ordinario','guardia')),
 breaks jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(breaks)='array'),
 consultations jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(consultations)='array'),
 consulting_room_id uuid REFERENCES public.consulting_rooms(id) ON DELETE RESTRICT,
 specialty_id bigint REFERENCES public.specialties(id) ON DELETE RESTRICT,
 valid_from date NOT NULL, valid_until date CHECK(valid_until>=valid_from),
 closed_on date CHECK(closed_on>=valid_from),
 active boolean NOT NULL DEFAULT true CHECK(active=(closed_on IS NULL)),
 effective_period daterange GENERATED ALWAYS AS (daterange(valid_from,least(valid_until+1,closed_on),'[)')) STORED,
 supersedes uuid REFERENCES public.staff_recurring_journeys(id) ON DELETE RESTRICT,
 request_values jsonb NOT NULL,
 last_change_key uuid, last_change_values jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES public.profiles(id),
 CHECK((staff_role='doctor' AND consulting_room_id IS NOT NULL AND specialty_id IS NOT NULL AND jsonb_array_length(consultations)>0)
 OR (staff_role='recepcionista' AND consulting_room_id IS NULL AND specialty_id IS NULL AND consultations='[]'::jsonb)),
 EXCLUDE USING gist(staff_id WITH =,effective_period WITH &&) DEFERRABLE INITIALLY DEFERRED,
 -- This is an exclusive room assignment throughout the validity period, including days off.
 EXCLUDE USING gist(consulting_room_id WITH =,effective_period WITH &&) WHERE(consulting_room_id IS NOT NULL) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.staff_recurring_journeys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_recurring_journeys FROM PUBLIC,anon,authenticated;
-- No existing RLS policies are changed. This new table is accessible only through guarded RPCs.

CREATE FUNCTION private.recurring_offset(p_time time,p_anchor time) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (extract(epoch FROM p_time)/60)::integer+CASE WHEN p_time<p_anchor THEN 1440 ELSE 0 END
$$;
CREATE FUNCTION private.recurring_instant(p_day date,p_time time,p_anchor time) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (p_day::timestamp+make_interval(mins=>private.recurring_offset(p_time,p_anchor))) AT TIME ZONE 'America/El_Salvador'
$$;
CREATE FUNCTION private.recurring_work(p_from timestamptz,p_until timestamptz,p_staff uuid DEFAULT NULL)
RETURNS TABLE(journey_id uuid,staff_id uuid,work_day date,starts_at timestamptz,ends_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT j.id,j.staff_id,d.day::date,
 private.recurring_instant(d.day::date,j.start_time,j.start_time),
 private.recurring_instant(d.day::date,j.end_time,j.start_time)
 FROM public.staff_recurring_journeys j
 CROSS JOIN generate_series(((p_from AT TIME ZONE 'America/El_Salvador')::date-1)::timestamp,
 (p_until AT TIME ZONE 'America/El_Salvador')::date::timestamp,interval '1 day')d(day)
 WHERE (p_staff IS NULL OR j.staff_id=p_staff) AND j.effective_period @> d.day::date
 AND extract(dow FROM d.day)::smallint=ANY(j.weekdays)
 AND private.recurring_instant(d.day::date,j.start_time,j.start_time)<p_until
 AND private.recurring_instant(d.day::date,j.end_time,j.start_time)>p_from
$$;
CREATE FUNCTION private.recurring_windows(p_from timestamptz,p_until timestamptz,p_staff uuid DEFAULT NULL)
RETURNS TABLE(journey_id uuid,staff_id uuid,room_id uuid,specialty_id bigint,starts_at timestamptz,ends_at timestamptz,slot_minutes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT j.id,w.staff_id,j.consulting_room_id,j.specialty_id,
 private.recurring_instant(w.work_day,(c->>'start_time')::time,j.start_time),
 private.recurring_instant(w.work_day,(c->>'end_time')::time,j.start_time),(c->>'slot_minutes')::integer
 FROM private.recurring_work(p_from,p_until,p_staff)w
 JOIN public.staff_recurring_journeys j ON j.id=w.journey_id
 CROSS JOIN LATERAL jsonb_array_elements(j.consultations)c
$$;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('private.planning_valid_slot(uuid,uuid,timestamptz,timestamptz)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION private.planning_valid_slot(','FUNCTION private.recurring_legacy_valid_slot(');
END $$;
CREATE OR REPLACE FUNCTION private.planning_valid_slot(p_doctor uuid,p_room uuid,p_start timestamptz,p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(private.recurring_legacy_valid_slot(p_doctor,p_room,p_start,p_end),false) OR (
 p_end>p_start
 AND EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles r ON r.user_id=s.profile_id AND r.role='doctor' AND r.active WHERE s.id=p_doctor AND s.active AND s.category='doctor')
 AND EXISTS(SELECT 1 FROM public.consulting_rooms WHERE id=p_room AND active)
 AND EXISTS(SELECT 1 FROM private.recurring_windows(p_start,p_end,p_doctor)w WHERE w.room_id=p_room AND w.starts_at<=p_start AND w.ends_at>=p_end
  AND extract(epoch FROM p_end-p_start)=w.slot_minutes*60
  AND mod(extract(epoch FROM p_start-w.starts_at),w.slot_minutes*60)=0
  AND EXISTS(SELECT 1 FROM public.doctor_specialties ds JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active WHERE ds.doctor_id=p_doctor AND ds.specialty_id=w.specialty_id))
 AND NOT EXISTS(SELECT 1 FROM public.staff_absences a WHERE a.staff_id=p_doctor AND a.active AND tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(p_start,p_end,'[)'))
 AND NOT EXISTS(SELECT 1 FROM private.recurring_work(p_start,p_end,p_doctor)w JOIN public.staff_recurring_journeys j ON j.id=w.journey_id
  CROSS JOIN LATERAL jsonb_array_elements(j.breaks)b
  WHERE tstzrange(private.recurring_instant(w.work_day,(b->>'start_time')::time,j.start_time),private.recurring_instant(w.work_day,(b->>'end_time')::time,j.start_time),'[)')&&tstzrange(p_start,p_end,'[)'))
 AND NOT EXISTS(SELECT 1 FROM public.doctor_consulting_rooms a WHERE a.active AND a.doctor_id<>p_doctor AND a.consulting_room_id=p_room AND tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(p_start,p_end,'[)'))
 )
$$;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('private.assert_staff_planning()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION private.assert_staff_planning(','FUNCTION private.recurring_legacy_assert(');
END $$;
CREATE OR REPLACE FUNCTION private.assert_staff_planning() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.recurring_legacy_assert();
 IF EXISTS(SELECT 1 FROM public.staff_recurring_journeys j JOIN public.consulting_rooms r ON r.id=j.consulting_room_id
  WHERE NOT r.active AND NOT isempty(j.effective_period) AND (upper_inf(j.effective_period) OR upper(j.effective_period)>(now() AT TIME ZONE 'America/El_Salvador')::date))
 THEN RAISE EXCEPTION 'El consultorio tiene una jornada fija vigente. Cambia la asignación antes de desactivarlo.' USING ERRCODE='23P01'; END IF;
 -- Date boundaries must also respect overnight work from the preceding version.
 IF EXISTS(SELECT 1 FROM public.staff_recurring_journeys marker
  CROSS JOIN LATERAL private.recurring_work(marker.valid_from::timestamp AT TIME ZONE 'America/El_Salvador',(marker.valid_from+1)::timestamp AT TIME ZONE 'America/El_Salvador',marker.staff_id)a
  CROSS JOIN LATERAL private.recurring_work(marker.valid_from::timestamp AT TIME ZONE 'America/El_Salvador',(marker.valid_from+1)::timestamp AT TIME ZONE 'America/El_Salvador',marker.staff_id)b
  WHERE a.journey_id<b.journey_id AND a.ends_at>now() AND tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(b.starts_at,b.ends_at,'[)'))
 THEN RAISE EXCEPTION 'El cambio se superpone con otra versión de la jornada de este empleado en esa fecha. Elige una fecha efectiva igual o posterior al inicio de la jornada que editas.' USING ERRCODE='23P01'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_recurring_journeys j
  CROSS JOIN LATERAL private.recurring_work(j.valid_from::timestamp AT TIME ZONE 'America/El_Salvador',(j.valid_from+1)::timestamp AT TIME ZONE 'America/El_Salvador')w
  JOIN public.staff_recurring_journeys previous ON previous.id=w.journey_id
  WHERE j.consulting_room_id=previous.consulting_room_id AND j.staff_id<>previous.staff_id AND NOT isempty(j.effective_period)
  AND w.ends_at>now() AND w.starts_at<j.valid_from::timestamp AT TIME ZONE 'America/El_Salvador')
 THEN RAISE EXCEPTION 'El consultorio todavía está asignado a la jornada nocturna anterior. Elige una fecha posterior.' USING ERRCODE='23P01'; END IF;
 -- Prevent direct legacy writes from bypassing the recurring reservation.
 IF EXISTS(SELECT 1 FROM public.doctor_consulting_rooms a JOIN public.staff_recurring_journeys j ON j.consulting_room_id=a.consulting_room_id AND j.staff_id<>a.doctor_id
  WHERE a.active AND a.ends_at>now() AND j.effective_period&&daterange((a.starts_at AT TIME ZONE 'America/El_Salvador')::date,((a.ends_at-interval '1 microsecond') AT TIME ZONE 'America/El_Salvador')::date+1,'[)'))
 THEN RAISE EXCEPTION 'El consultorio está reservado de forma fija para otro doctor' USING ERRCODE='23P01'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_shifts s CROSS JOIN LATERAL private.recurring_work(greatest(s.starts_at,now()),s.ends_at,s.staff_id)w
  WHERE s.status<>'cancelado' AND s.ends_at>now() AND tstzrange(s.starts_at,s.ends_at,'[)')&&tstzrange(w.starts_at,w.ends_at,'[)'))
 THEN RAISE EXCEPTION 'La jornada recurrente coincide con una jornada por fecha existente. Ajusta su vigencia o revisa esa programación.' USING ERRCODE='23P01'; END IF;
 IF EXISTS(SELECT 1 FROM public.appointments a JOIN public.staff_recurring_journeys j ON j.consulting_room_id=a.consulting_room_id AND j.staff_id<>a.doctor_id
  WHERE a.status IN('programada','confirmada','en_atencion') AND a.ends_at>now()
  AND j.effective_period&&daterange((a.starts_at AT TIME ZONE 'America/El_Salvador')::date,((a.ends_at-interval '1 microsecond') AT TIME ZONE 'America/El_Salvador')::date+1,'[)'))
 THEN RAISE EXCEPTION 'El cambio de consultorio entra en conflicto con citas existentes. Reprograma las citas primero.' USING ERRCODE='23P01'; END IF;
END $$;
CREATE TRIGGER recurring_journey_lock BEFORE INSERT OR UPDATE OR DELETE ON public.staff_recurring_journeys
FOR EACH STATEMENT EXECUTE FUNCTION private.planning_lock();
CREATE CONSTRAINT TRIGGER recurring_journey_guard AFTER INSERT OR UPDATE OR DELETE ON public.staff_recurring_journeys
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.planning_guard();

CREATE FUNCTION public.save_recurring_journey(p_values jsonb,p_id uuid DEFAULT NULL,p_version text DEFAULT NULL,p_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.staff_recurring_journeys%ROWTYPE; duplicate public.staff_recurring_journeys%ROWTYPE;
 employee uuid=(p_values->>'staff_id')::uuid; v_role text; days smallint[]; work_start time; work_end time;
 effective date=(p_values->>'valid_from')::date; final_day date=nullif(p_values->>'valid_until','')::date;
 pauses jsonb=coalesce(p_values->'breaks','[]'); care jsonb=coalesce(p_values->'consultations','[]');
 room uuid=nullif(p_values->>'room_id','')::uuid; specialty bigint=nullif(p_values->>'specialty_id','')::bigint;
 enabled boolean=coalesce((p_values->>'active')::boolean,true); item jsonb; prior jsonb;
 a integer; b integer; base integer; finish integer; today date=(now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede asignar jornadas' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR employee IS NULL OR effective IS NULL OR effective<today OR (final_day IS NOT NULL AND final_day<effective) THEN RAISE EXCEPTION 'Indica empleado y vigencia válida, desde hoy o una fecha futura' USING ERRCODE='22023'; END IF;
 SELECT * INTO duplicate FROM public.staff_recurring_journeys WHERE id=p_key;
 IF FOUND THEN
  IF duplicate.request_values IS DISTINCT FROM p_values THEN RAISE EXCEPTION 'Esta operación ya se usó para otros datos' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',duplicate.id);
 END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR old.staff_id<>employee THEN RAISE EXCEPTION 'La jornada no corresponde al empleado' USING ERRCODE='22023'; END IF;
  IF old.last_change_key=p_key AND old.last_change_values=p_values THEN RETURN jsonb_build_object('id',old.id); END IF;
  -- xmin is a system column, read separately (not part of the row type).
  IF p_version IS DISTINCT FROM (SELECT xmin::text FROM public.staff_recurring_journeys WHERE id=p_id) OR old.closed_on IS NOT NULL THEN RAISE EXCEPTION 'La jornada cambió. Actualiza antes de continuar' USING ERRCODE='40001'; END IF;
  IF effective<old.valid_from OR effective<=today THEN RAISE EXCEPTION 'Para conservar el historial, el cambio debe empezar mañana o después, sin preceder a la jornada original' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT enabled AND p_id IS NULL THEN RAISE EXCEPTION 'Selecciona la jornada a desactivar' USING ERRCODE='22023'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
 IF enabled THEN
  SELECT s.category INTO v_role FROM public.staff s WHERE s.id=employee AND s.active;
  IF v_role IS NULL OR v_role NOT IN('doctor','recepcionista') OR NOT EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles u ON u.user_id=s.profile_id WHERE s.id=employee AND u.role::text=v_role AND u.active) THEN RAISE EXCEPTION 'Selecciona un empleado activo con el cargo correspondiente' USING ERRCODE='42501'; END IF;
  SELECT array_agg(DISTINCT v::smallint ORDER BY v::smallint) INTO days FROM jsonb_array_elements_text(p_values->'weekdays')v;
  work_start=(p_values->>'start_time')::time; work_end=(p_values->>'end_time')::time;
  IF days IS NULL OR cardinality(days) NOT BETWEEN 1 AND 7 OR NOT days<@ARRAY[0,1,2,3,4,5,6]::smallint[] OR work_start IS NULL OR work_end IS NULL OR work_start=work_end OR extract(second FROM work_start)<>0 OR extract(second FROM work_end)<>0 OR p_values->>'shift_type' NOT IN('ordinario','guardia') THEN RAISE EXCEPTION 'Comprueba días laborales, entrada, salida y tipo de jornada' USING ERRCODE='22023'; END IF;
  base=private.recurring_offset(work_start,work_start); finish=private.recurring_offset(work_end,work_start);
  IF jsonb_typeof(pauses)<>'array' OR jsonb_array_length(pauses)>16 OR jsonb_typeof(care)<>'array' OR jsonb_array_length(care)>8 THEN RAISE EXCEPTION 'Comprueba los periodos de atención y descansos' USING ERRCODE='22023'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(pauses) LOOP
   a=private.recurring_offset((item->>'start_time')::time,work_start); b=private.recurring_offset((item->>'end_time')::time,work_start);
   IF a IS NULL OR b IS NULL OR a<base OR b>finish OR b<=a OR nullif(trim(item->>'reason'),'') IS NULL OR length(item->>'reason')>450 THEN RAISE EXCEPTION 'Cada descanso debe estar dentro de la jornada y tener descripción' USING ERRCODE='22023'; END IF;
   FOR prior IN SELECT value FROM jsonb_array_elements(pauses) LOOP
    IF prior IS DISTINCT FROM item AND int4range(a,b,'[)')&&int4range(private.recurring_offset((prior->>'start_time')::time,work_start),private.recurring_offset((prior->>'end_time')::time,work_start),'[)') THEN RAISE EXCEPTION 'Los descansos no pueden superponerse' USING ERRCODE='22023'; END IF;
   END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(pauses))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(pauses)) THEN RAISE EXCEPTION 'Hay descansos duplicados' USING ERRCODE='22023'; END IF;
  IF v_role='recepcionista' AND (room IS NOT NULL OR specialty IS NOT NULL OR care<>'[]'::jsonb) THEN RAISE EXCEPTION 'Recepción no utiliza consultorio ni atención médica' USING ERRCODE='22023'; END IF;
  IF v_role='doctor' THEN
   IF room IS NULL OR NOT EXISTS(SELECT 1 FROM public.consulting_rooms WHERE id=room AND active) OR specialty IS NULL OR NOT EXISTS(SELECT 1 FROM public.doctor_specialties ds JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active WHERE ds.doctor_id=employee AND ds.specialty_id=specialty) OR jsonb_array_length(care)=0 THEN RAISE EXCEPTION 'Selecciona consultorio activo, especialidad del doctor y horario de atención' USING ERRCODE='22023'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(care) LOOP
    a=private.recurring_offset((item->>'start_time')::time,work_start); b=private.recurring_offset((item->>'end_time')::time,work_start);
    IF a IS NULL OR b IS NULL OR a<base OR b>finish OR b<=a OR (item->>'slot_minutes')::integer NOT BETWEEN 5 AND 180 OR item->>'slot_minutes' IS NULL THEN RAISE EXCEPTION 'La atención debe estar dentro de la jornada; citas entre 5 y 180 minutos' USING ERRCODE='22023'; END IF;
    FOR prior IN SELECT value FROM jsonb_array_elements(care) LOOP
     IF prior IS DISTINCT FROM item AND int4range(a,b,'[)')&&int4range(private.recurring_offset((prior->>'start_time')::time,work_start),private.recurring_offset((prior->>'end_time')::time,work_start),'[)') THEN RAISE EXCEPTION 'Los periodos de atención no pueden superponerse' USING ERRCODE='22023'; END IF;
    END LOOP;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(care))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(care)) THEN RAISE EXCEPTION 'Hay periodos de atención duplicados' USING ERRCODE='22023'; END IF;
  END IF;
 END IF;
 IF p_id IS NOT NULL THEN
  UPDATE public.staff_recurring_journeys SET closed_on=effective,active=false,last_change_key=p_key,last_change_values=p_values WHERE id=p_id;
 END IF;
 IF enabled THEN
  INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,valid_from,valid_until,supersedes,request_values,created_by)
  VALUES(p_key,employee,v_role,days,work_start,work_end,p_values->>'shift_type',pauses,care,room,specialty,effective,final_day,p_id,p_values,auth.uid());
 END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),CASE WHEN enabled THEN 'jornada_recurrente_guardada' ELSE 'jornada_recurrente_cerrada' END,'staff_recurring_journeys',coalesce(p_key,p_id)::text,jsonb_build_object('previous_id',p_id,'effective_from',effective));
 PERFORM private.assert_staff_planning();
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN jsonb_build_object('id',CASE WHEN enabled THEN p_key ELSE p_id END);
END $$;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.get_medical_availability(timestamptz,timestamptz,uuid,uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.get_medical_availability(','FUNCTION private.recurring_legacy_availability(');
END $$;
CREATE OR REPLACE FUNCTION public.get_medical_availability(p_from timestamptz,p_until timestamptz,p_doctor uuid DEFAULT NULL,p_room uuid DEFAULT NULL)
RETURNS TABLE(doctor_id uuid,doctor_name text,consulting_room_id uuid,room_code text,starts_at timestamptz,ends_at timestamptz,slot_minutes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista') OR private.has_role('doctor')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>interval '31 days' THEN RAISE EXCEPTION 'Consulta como máximo 31 días' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT DISTINCT q.* FROM (
  SELECT * FROM private.recurring_legacy_availability(p_from,p_until,p_doctor,p_room)
  UNION ALL
  SELECT w.staff_id,concat_ws(' ',p.first_name,p.last_name),w.room_id,r.code,t.slot,t.slot+make_interval(mins=>w.slot_minutes),w.slot_minutes
  FROM private.recurring_windows(p_from,p_until,p_doctor)w JOIN public.staff s ON s.id=w.staff_id JOIN public.profiles p ON p.id=s.profile_id JOIN public.consulting_rooms r ON r.id=w.room_id
  CROSS JOIN LATERAL generate_series(w.starts_at,w.ends_at-make_interval(mins=>w.slot_minutes),make_interval(mins=>w.slot_minutes))t(slot)
  WHERE (p_room IS NULL OR w.room_id=p_room) AND t.slot>=greatest(p_from,now()) AND t.slot+make_interval(mins=>w.slot_minutes)<=p_until
  AND (private.has_role('admin') OR private.has_role('recepcionista') OR w.staff_id=private.my_staff_id())
  AND private.planning_valid_slot(w.staff_id,w.room_id,t.slot,t.slot+make_interval(mins=>w.slot_minutes))
  AND NOT EXISTS(SELECT 1 FROM public.appointments a WHERE a.status IN('programada','confirmada','en_atencion') AND (a.doctor_id=w.staff_id OR a.consulting_room_id=w.room_id) AND tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(t.slot,t.slot+make_interval(mins=>w.slot_minutes),'[)'))
 )q ORDER BY q.starts_at,q.room_code;
END $$;

DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('public.read_staff_planning(timestamptz,timestamptz)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.read_staff_planning(','FUNCTION private.recurring_legacy_read(');
END $$;
CREATE OR REPLACE FUNCTION public.read_staff_planning(p_from timestamptz,p_until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; shifts jsonb='[]'; pauses jsonb='[]'; care jsonb='[]'; w record; j public.staff_recurring_journeys%ROWTYPE; b jsonb; i integer; v text;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>interval '32 days' THEN RAISE EXCEPTION 'Rango de lectura inválido' USING ERRCODE='22023'; END IF;
 result=private.recurring_legacy_read(p_from,p_until);
 FOR w IN SELECT * FROM private.recurring_work(p_from,p_until) LOOP
  SELECT * INTO j FROM public.staff_recurring_journeys WHERE id=w.journey_id;
  SELECT xmin::text INTO v FROM public.staff_recurring_journeys WHERE id=j.id;
  shifts=shifts||jsonb_build_array(jsonb_build_object('id',md5(j.id::text||w.work_day::text||'shift')::uuid,'staff_id',w.staff_id,'starts_at',w.starts_at,'ends_at',w.ends_at,'shift_type',j.shift_type,'status','programado','version',v,'recurring_id',j.id));
  i=0;
  FOR b IN SELECT value FROM jsonb_array_elements(j.breaks) LOOP
   pauses=pauses||jsonb_build_array(jsonb_build_object('id',md5(j.id::text||w.work_day::text||'break'||i)::uuid,'staff_id',w.staff_id,'starts_at',private.recurring_instant(w.work_day,(b->>'start_time')::time,j.start_time),'ends_at',private.recurring_instant(w.work_day,(b->>'end_time')::time,j.start_time),'reason','Descanso: '||(b->>'reason'),'active',true,'version',v,'recurring_id',j.id)); i=i+1;
  END LOOP;
  i=0;
  FOR b IN SELECT value FROM jsonb_array_elements(j.consultations) LOOP
   care=care||jsonb_build_array(jsonb_build_object('id',md5(j.id::text||w.work_day::text||'care'||i)::uuid,'doctor_id',w.staff_id,'starts_at',private.recurring_instant(w.work_day,(b->>'start_time')::time,j.start_time),'ends_at',private.recurring_instant(w.work_day,(b->>'end_time')::time,j.start_time),'consulting_room_id',j.consulting_room_id,'slot_minutes',(b->>'slot_minutes')::integer,'active',true,'version',v,'recurring_id',j.id)); i=i+1;
  END LOOP;
 END LOOP;
 RETURN result||jsonb_build_object('recurring_ready',true,
  'recurring_journeys',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT r.*,r.xmin::text version FROM public.staff_recurring_journeys r ORDER BY valid_from,created_at)x),
  'doctor_specialties',(SELECT coalesce(jsonb_agg(jsonb_build_object('doctor_id',ds.doctor_id,'specialty_id',sp.id,'name',sp.name)),'[]') FROM public.doctor_specialties ds JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active),
  'shifts',coalesce(result->'shifts','[]')||shifts,'saved_shifts',coalesce(result->'saved_shifts',result->'shifts','[]')||shifts,
  'absences',coalesce(result->'absences','[]')||pauses,'saved_absences',coalesce(result->'saved_absences',result->'absences','[]')||pauses,
  'consultations',coalesce(result->'consultations','[]')||care,'saved_consultations',coalesce(result->'saved_consultations',result->'consultations','[]')||care);
END $$;

REVOKE ALL ON FUNCTION private.recurring_offset(time,time),private.recurring_instant(date,time,time),private.recurring_work(timestamptz,timestamptz,uuid),private.recurring_windows(timestamptz,timestamptz,uuid),private.recurring_legacy_valid_slot(uuid,uuid,timestamptz,timestamptz),private.planning_valid_slot(uuid,uuid,timestamptz,timestamptz),private.recurring_legacy_assert(),private.assert_staff_planning(),private.recurring_legacy_read(timestamptz,timestamptz),private.recurring_legacy_availability(timestamptz,timestamptz,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_recurring_journey(jsonb,uuid,text,uuid),public.read_staff_planning(timestamptz,timestamptz),public.get_medical_availability(timestamptz,timestamptz,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_recurring_journey(jsonb,uuid,text,uuid),public.read_staff_planning(timestamptz,timestamptz),public.get_medical_availability(timestamptz,timestamptz,uuid,uuid) TO authenticated;
SELECT private.assert_staff_planning();
NOTIFY pgrst,'reload schema';
COMMIT;
