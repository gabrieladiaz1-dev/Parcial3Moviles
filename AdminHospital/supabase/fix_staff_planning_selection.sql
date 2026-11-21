BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION public.save_staff_planning(p_kind text, p_values jsonb, p_id uuid DEFAULT NULL::uuid, p_version text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
 v_staff uuid; v_start timestamptz; v_end timestamptz; v_day date; v_dates date[];
 v_room uuid; v_id uuid; v_existing text; v_minutes integer; v_segment timestamptz;
 v_boundary timestamptz; v_active boolean; v_row record; v_role text;
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
  SELECT s.category INTO v_role FROM public.staff s WHERE s.id=v_staff;
  IF v_role NOT IN ('doctor','recepcionista') OR v_role IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles u ON u.user_id=s.profile_id
     WHERE s.id=v_staff AND u.role::text=v_role AND (u.active OR NOT v_active)) THEN
    RAISE EXCEPTION 'El empleado no tiene el rol hospitalario requerido';
  END IF;
  IF p_values ? 'staff_role' AND p_values->>'staff_role' IS DISTINCT FROM v_role THEN
    RAISE EXCEPTION 'El rol seleccionado no corresponde al empleado';
  END IF;
  IF p_kind='consultation' AND v_role<>'doctor' THEN RAISE EXCEPTION 'Solo doctores pueden tener consulta médica'; END IF;
  IF v_role='recepcionista' AND (nullif(p_values->>'room_id','') IS NOT NULL OR p_values ? 'slot_minutes') THEN
    RAISE EXCEPTION 'Los turnos de recepción no admiten consultorio ni duración de citas';
  END IF;
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
   IF v_end<=v_start OR v_end-v_start>interval '24 hours' OR (p_id IS NULL AND v_start<now() AND NOT coalesce((p_values->>'allow_past')::boolean,false)) THEN RAISE EXCEPTION 'Horario inválido o fecha pasada'; END IF;
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
 IF NOT coalesce((p_values->>'defer_validation')::boolean,false) THEN SET CONSTRAINTS ALL IMMEDIATE; END IF;
 RETURN jsonb_build_object('id',v_id,'count',coalesce(cardinality(v_dates),1));
END $function$
;
CREATE OR REPLACE FUNCTION public.read_staff_planning(p_from timestamp with time zone, p_until timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v jsonb;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración'; END IF;
 IF p_until<=p_from OR p_until-p_from>interval '32 days' THEN RAISE EXCEPTION 'Rango de lectura inválido'; END IF;
 SELECT jsonb_build_object('ready',true,
  'staff',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.id,s.profile_id,s.employee_code,s.category,s.active,p.first_name,p.last_name,(SELECT coalesce(jsonb_agg(u.role::text),'[]') FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.active) roles FROM public.staff s LEFT JOIN public.profiles p ON p.id=s.profile_id ORDER BY s.employee_code)x),
  'saved_shifts',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.*,s.xmin::text version FROM public.staff_shifts s ORDER BY starts_at)x),
  'saved_consultations',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.*,s.xmin::text version FROM public.doctor_consulting_rooms s ORDER BY starts_at)x),
  'saved_absences',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.*,s.xmin::text version FROM public.staff_absences s ORDER BY starts_at)x),
  'rooms',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT r.*,r.xmin::text version FROM public.consulting_rooms r ORDER BY code)x),
  'floors',(SELECT coalesce(jsonb_agg(f),'[]') FROM public.hospital_floors f),
  'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT s.*,s.xmin::text version FROM public.staff_shifts s WHERE s.starts_at<p_until AND s.ends_at>p_from ORDER BY starts_at)x),
  'absences',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT a.*,a.xmin::text version FROM public.staff_absences a WHERE a.starts_at<p_until AND a.ends_at>p_from ORDER BY starts_at)x),
  'consultations',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM(SELECT a.*,a.xmin::text version FROM public.doctor_consulting_rooms a WHERE a.starts_at<p_until AND a.ends_at>p_from ORDER BY starts_at)x)
 ) INTO v;
 RETURN v;
END $function$
;

CREATE OR REPLACE FUNCTION public.save_staff_planning_set(p_role text,p_kind text,p_values jsonb,p_originals jsonb DEFAULT '[]')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE employee uuid:=(p_values->>'staff_id')::uuid; enabled boolean:=coalesce((p_values->>'active')::boolean,true);
 item jsonb; block jsonb; old_employee uuid; old_version text; result jsonb; last_result jsonb;
 period_start timestamp; period_end timestamp; work_start timestamp; work_end timestamp; dates jsonb; moved_dates jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede configurar horarios'; END IF;
 IF p_role NOT IN('doctor','recepcionista') OR p_kind NOT IN('shift','absence','consultation') THEN RAISE EXCEPTION 'Tipo de programación inválido'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles r ON r.user_id=s.profile_id
  WHERE s.id=employee AND s.category=p_role AND r.role::text=p_role AND (r.active OR NOT enabled) AND (s.active OR NOT enabled)) THEN
  RAISE EXCEPTION 'El rol real del empleado no corresponde a esta sección'; END IF;
 IF p_role='recepcionista' AND (p_kind='consultation' OR jsonb_array_length(coalesce(p_values->'consultations','[]'))>0 OR p_values ? 'room_id' OR p_values ? 'slot_minutes') THEN
  RAISE EXCEPTION 'Recepción no admite horarios médicos ni consultorios'; END IF;
 IF jsonb_array_length(p_originals)>1000 THEN RAISE EXCEPTION 'Demasiados registros para editar'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
 -- Verify every version before changing anything; retain all original records as inactive history.
 FOR item IN SELECT value FROM jsonb_array_elements(p_originals) LOOP
  old_employee:=NULL; old_version:=NULL;
  CASE item->>'kind'
   WHEN 'shift' THEN SELECT staff_id,xmin::text INTO old_employee,old_version FROM public.staff_shifts WHERE id=(item->>'id')::uuid FOR UPDATE;
   WHEN 'absence' THEN SELECT staff_id,xmin::text INTO old_employee,old_version FROM public.staff_absences WHERE id=(item->>'id')::uuid FOR UPDATE;
   WHEN 'consultation' THEN
    IF p_role<>'doctor' THEN RAISE EXCEPTION 'El registro médico no corresponde a recepción'; END IF;
    SELECT doctor_id,xmin::text INTO old_employee,old_version FROM public.doctor_consulting_rooms WHERE id=(item->>'id')::uuid FOR UPDATE;
   ELSE RAISE EXCEPTION 'Registro original inválido';
  END CASE;
  IF old_employee IS DISTINCT FROM employee OR old_version IS DISTINCT FROM item->>'version' THEN RAISE EXCEPTION 'El horario cambió. Actualiza antes de editar'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_originals) LOOP
  CASE item->>'kind'
   WHEN 'shift' THEN UPDATE public.staff_shifts SET status='cancelado' WHERE id=(item->>'id')::uuid;
   WHEN 'absence' THEN UPDATE public.staff_absences SET active=false WHERE id=(item->>'id')::uuid;
   WHEN 'consultation' THEN
    UPDATE public.doctor_consulting_rooms SET active=false WHERE id=(item->>'id')::uuid;
    UPDATE public.doctor_schedules SET active=false WHERE consulting_assignment_id=(item->>'id')::uuid AND active;
  END CASE;
 END LOOP;
 IF enabled THEN
  p_values:=p_values||jsonb_build_object('allow_past',jsonb_array_length(p_originals)>0);
  dates:=p_values->'dates';
  result:=public.save_staff_planning(p_kind,p_values||jsonb_build_object('staff_role',p_role,'defer_validation',true));
  IF p_kind='shift' THEN
   work_start:=date '2000-01-01'+(p_values->>'start_time')::time;
   work_end:=date '2000-01-01'+(p_values->>'end_time')::time;
   IF work_end<work_start THEN work_end:=work_end+interval '1 day'; END IF;
   IF jsonb_array_length(coalesce(p_values->'consultations','[]'))>4 OR jsonb_array_length(coalesce(p_values->'breaks','[]'))>4 THEN RAISE EXCEPTION 'Máximo cuatro periodos de atención y cuatro descansos por jornada'; END IF;
   FOR block IN SELECT value FROM jsonb_array_elements(coalesce(p_values->'consultations','[]')) UNION ALL
    SELECT value||'{"is_break":true}'::jsonb FROM jsonb_array_elements(coalesce(p_values->'breaks','[]')) LOOP
    period_start:=date '2000-01-01'+(block->>'start_time')::time;
    IF work_end::date>work_start::date AND period_start<work_start THEN period_start:=period_start+interval '1 day'; END IF;
    period_end:=period_start::date+(block->>'end_time')::time;
    IF period_end<period_start THEN period_end:=period_end+interval '1 day'; END IF;
    IF period_start<work_start OR period_end>work_end OR period_end<=period_start THEN RAISE EXCEPTION 'La atención y los descansos deben quedar dentro de la jornada laboral'; END IF;
    moved_dates:=dates;
    IF period_start::date>work_start::date THEN SELECT jsonb_agg((value#>>'{}')::date+1) INTO moved_dates FROM jsonb_array_elements(dates); END IF;
    IF coalesce((block->>'is_break')::boolean,false) THEN
     last_result:=public.save_staff_planning('absence',block||jsonb_build_object('staff_id',employee,'staff_role',p_role,'dates',moved_dates,'reason','Descanso: '||coalesce(nullif(trim(block->>'reason'),''),'Descanso laboral'),'active',true,'defer_validation',true,'allow_past',jsonb_array_length(p_originals)>0));
    ELSE
     last_result:=public.save_staff_planning('consultation',block||jsonb_build_object('staff_id',employee,'staff_role',p_role,'dates',moved_dates,'active',true,'defer_validation',true,'allow_past',jsonb_array_length(p_originals)>0));
    END IF;
   END LOOP;
  END IF;
 END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN coalesce(result,jsonb_build_object('count',jsonb_array_length(p_originals)));
END $$;

CREATE OR REPLACE FUNCTION public.delete_staff_consulting_room(p_id uuid,p_version text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v text;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede eliminar consultorios'; END IF;
 SELECT xmin::text INTO v FROM public.consulting_rooms WHERE id=p_id FOR UPDATE;
 IF v IS NULL OR v IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'El consultorio cambió. Actualiza antes de eliminar'; END IF;
 IF EXISTS(SELECT 1 FROM public.doctor_consulting_rooms WHERE consulting_room_id=p_id) OR EXISTS(SELECT 1 FROM public.appointments WHERE consulting_room_id=p_id) THEN
  RAISE EXCEPTION 'El consultorio tiene asignaciones o historial. Desactívalo para conservar los datos'; END IF;
 DELETE FROM public.consulting_rooms WHERE id=p_id;
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;
REVOKE ALL ON FUNCTION public.save_staff_planning_set(text,text,jsonb,jsonb),public.delete_staff_consulting_room(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_staff_planning_set(text,text,jsonb,jsonb),public.delete_staff_consulting_room(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

