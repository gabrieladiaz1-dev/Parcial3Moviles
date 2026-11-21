-- Preserve the legacy primary specialty while storing every specialty selected for a recurring journey.
ALTER TABLE public.staff_recurring_journeys ADD COLUMN IF NOT EXISTS specialty_ids bigint[] NOT NULL DEFAULT ARRAY[]::bigint[];
ALTER TABLE public.staff_recurring_journeys ADD CONSTRAINT staff_recurring_journeys_specialty_ids_check CHECK ((staff_role='doctor' AND specialty_id IS NOT NULL AND cardinality(specialty_ids)>0 AND specialty_id=ANY(specialty_ids)) OR (staff_role='recepcionista' AND specialty_id IS NULL AND cardinality(specialty_ids)=0)) NOT VALID;
UPDATE public.staff_recurring_journeys SET specialty_ids=ARRAY[specialty_id] WHERE specialty_id IS NOT NULL AND cardinality(specialty_ids)=0;

CREATE OR REPLACE FUNCTION private.save_journey_validated(p_values jsonb, p_id uuid DEFAULT NULL::uuid, p_version text DEFAULT NULL::text, p_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE old public.staff_recurring_journeys%ROWTYPE; duplicate public.staff_recurring_journeys%ROWTYPE;
 employee uuid=(p_values->>'staff_id')::uuid; v_role text; days smallint[]; work_start time; work_end time;
 effective date=(p_values->>'valid_from')::date; final_day date=nullif(p_values->>'valid_until','')::date;
 pauses jsonb=coalesce(p_values->'breaks','[]'); care jsonb=coalesce(p_values->'consultations','[]');
 room uuid=nullif(p_values->>'room_id','')::uuid; specialty bigint=nullif(p_values->>'specialty_id','')::bigint;
 specialty_list bigint[];
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
  IF p_values ? 'specialty_ids' THEN
   IF jsonb_typeof(p_values->'specialty_ids') <> 'array' THEN RAISE EXCEPTION 'Selecciona especialidades válidas' USING ERRCODE='22023'; END IF;
   SELECT array_agg(value::bigint ORDER BY ord) INTO specialty_list FROM jsonb_array_elements_text(p_values->'specialty_ids') WITH ORDINALITY AS selected(value,ord);
  ELSE
   specialty_list=CASE WHEN specialty IS NULL THEN ARRAY[]::bigint[] ELSE ARRAY[specialty] END;
  END IF;
  specialty_list=coalesce(specialty_list,ARRAY[]::bigint[]);
  IF v_role='recepcionista' AND (room IS NOT NULL OR specialty IS NOT NULL OR cardinality(specialty_list)>0 OR care<>'[]'::jsonb) THEN RAISE EXCEPTION 'Recepción no utiliza consultorio ni atención médica' USING ERRCODE='22023'; END IF;
  IF v_role='doctor' THEN
   IF room IS NULL OR NOT EXISTS(SELECT 1 FROM public.consulting_rooms WHERE id=room AND active) OR specialty IS NULL OR cardinality(specialty_list)=0 OR NOT specialty=ANY(specialty_list) OR cardinality(specialty_list)<>cardinality(ARRAY(SELECT DISTINCT unnest(specialty_list))) OR EXISTS(SELECT 1 FROM unnest(specialty_list) selected_id WHERE selected_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.doctor_specialties ds JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active WHERE ds.doctor_id=employee AND ds.specialty_id=selected_id)) OR jsonb_array_length(care)=0 THEN RAISE EXCEPTION 'Selecciona consultorio activo, especialidad del doctor y horario de atención' USING ERRCODE='22023'; END IF;
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
  INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,specialty_ids,valid_from,valid_until,supersedes,request_values,created_by)
  VALUES(p_key,employee,v_role,days,work_start,work_end,p_values->>'shift_type',pauses,care,room,specialty,specialty_list,effective,final_day,p_id,p_values,auth.uid());
 END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),CASE WHEN enabled THEN 'jornada_recurrente_guardada' ELSE 'jornada_recurrente_cerrada' END,'staff_recurring_journeys',coalesce(p_key,p_id)::text,jsonb_build_object('previous_id',p_id,'effective_from',effective));
 PERFORM private.assert_staff_planning();
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN jsonb_build_object('id',CASE WHEN enabled THEN p_key ELSE p_id END);
END $function$
;

CREATE OR REPLACE FUNCTION public.save_recurring_journey_day(p_values jsonb, p_id uuid, p_version text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE old public.staff_recurring_journeys%ROWTYPE; duplicate public.staff_recurring_journeys%ROWTYPE;
 day date=(p_values->>'valid_from')::date; enabled boolean=coalesce((p_values->>'active')::boolean,true);
 payload jsonb=p_values||jsonb_build_object('_single_id',p_id); result jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede editar jornadas' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_key IS NULL OR day IS NULL OR day<(now() AT TIME ZONE 'America/El_Salvador')::date THEN
  RAISE EXCEPTION 'Selecciona una fecha de hoy o posterior' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;
 IF old.last_change_key=p_key AND old.last_change_values=payload THEN
  RETURN jsonb_build_object('id',CASE WHEN enabled THEN p_key ELSE p_id END);
 END IF;
 IF old.id IS NULL OR old.staff_id IS DISTINCT FROM (p_values->>'staff_id')::uuid OR old.closed_on IS NOT NULL
 OR p_version IS DISTINCT FROM (SELECT xmin::text FROM public.staff_recurring_journeys WHERE id=p_id) THEN
  RAISE EXCEPTION 'La jornada cambió. Cierra el editor y vuelve a abrir la fecha actualizada.' USING ERRCODE='40001'; END IF;
 IF NOT (old.effective_period @> day) OR NOT (extract(dow FROM day)::smallint=ANY(old.weekdays)) THEN
  RAISE EXCEPTION 'La fecha no pertenece a esta jornada' USING ERRCODE='22023'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
 UPDATE public.staff_recurring_journeys SET closed_on=day,active=false,last_change_key=p_key,last_change_values=payload WHERE id=p_id;
 -- Resume every original weekday after this occurrence; no rule covers the replaced day.
 IF old.valid_until IS NULL OR old.valid_until>day THEN
  INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,specialty_ids,valid_from,valid_until,supersedes,request_values,created_by)
  VALUES(md5(p_key::text||':resume')::uuid,old.staff_id,old.staff_role,old.weekdays,old.start_time,old.end_time,old.shift_type,old.breaks,old.consultations,old.consulting_room_id,old.specialty_id,old.specialty_ids,day+1,old.valid_until,old.id,jsonb_build_object('preserved_from',old.id),auth.uid());
 END IF;
 IF enabled THEN
  result=private.save_journey_validated(payload||jsonb_build_object('weekdays',jsonb_build_array(extract(dow FROM day)::integer),'valid_until',day),NULL,NULL,p_key);
  UPDATE public.staff_recurring_journeys SET supersedes=p_id WHERE id=p_key;
 ELSE result=jsonb_build_object('id',p_id); END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 VALUES(auth.uid(),CASE WHEN enabled THEN 'jornada_fecha_editada' ELSE 'jornada_fecha_desactivada' END,'staff_recurring_journeys',p_id::text,jsonb_build_object('date',day,'operation',p_key));
 PERFORM private.assert_staff_planning();
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN result;
END $function$
;

CREATE OR REPLACE FUNCTION public.save_recurring_journey_scope(p_values jsonb, p_id uuid, p_version text, p_key uuid, p_weekday integer DEFAULT NULL::integer, p_originals jsonb DEFAULT '[]'::jsonb, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE old public.staff_recurring_journeys%ROWTYPE; item public.staff_recurring_journeys%ROWTYPE;
 effective date=(p_values->>'valid_from')::date; employee uuid=(p_values->>'staff_id')::uuid;
 remaining smallint[]; remainder_id uuid; result jsonb; original_ids uuid[];
 payload jsonb=p_values||jsonb_build_object('_scope_id',p_id,'_scope_weekday',p_weekday,'_scope_originals',p_originals);
 today date=(now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede editar jornadas' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_id IS NULL OR employee IS NULL OR effective IS NULL OR effective<today
  OR coalesce(p_values->>'active','') NOT IN ('true','false') OR nullif(p_values->>'valid_until','') IS NOT NULL
  OR jsonb_typeof(p_originals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_originals)>100
  OR (p_weekday IS NOT NULL AND p_weekday NOT BETWEEN 0 AND 6)
 THEN RAISE EXCEPTION 'Indica una jornada recurrente y una fecha efectiva de hoy o posterior, sin fecha final' USING ERRCODE='22023'; END IF;
 SELECT * INTO item FROM public.staff_recurring_journeys WHERE id=p_key;
 IF FOUND THEN
  IF item.request_values IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Esta operación ya se utilizó con otros datos' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',item.id,'preview',p_preview);
 END IF;
 SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;
 IF old.last_change_key=p_key AND old.last_change_values=payload THEN RETURN jsonb_build_object('id',p_id); END IF;
 IF NOT FOUND OR old.staff_id<>employee OR old.closed_on IS NOT NULL OR NOT old.active
  OR p_version IS DISTINCT FROM (SELECT xmin::text FROM public.staff_recurring_journeys WHERE id=p_id)
 THEN RAISE EXCEPTION 'La jornada cambió. Actualiza antes de editar' USING ERRCODE='40001'; END IF;
 IF (old.valid_until IS NOT NULL AND effective>old.valid_until) THEN
  RAISE EXCEPTION 'La fecha efectiva debe estar dentro de la vigencia de la jornada elegida' USING ERRCODE='22023'; END IF;
 IF p_weekday IS NOT NULL AND (p_values->'weekdays' IS DISTINCT FROM jsonb_build_array(p_weekday)) THEN
  RAISE EXCEPTION 'Editar día solo permite modificar el día de la semana seleccionado' USING ERRCODE='22023'; END IF;
 -- All modifications below, including preview, are one transaction/subtransaction.
 BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  IF p_weekday IS NOT NULL THEN
   IF p_weekday NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'Día de la semana inválido' USING ERRCODE='22023'; END IF;
   UPDATE public.staff_recurring_journeys SET closed_on=greatest(effective,valid_from),active=false,last_change_key=p_key,last_change_values=payload WHERE id=p_id;
   SELECT array_agg(d ORDER BY d) INTO remaining FROM unnest(old.weekdays)d WHERE d<>p_weekday;
   IF cardinality(remaining)>0 THEN
    remainder_id=md5(p_key::text||':remaining')::uuid;
    INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,specialty_ids,valid_from,valid_until,supersedes,request_values,created_by)
    VALUES(remainder_id,old.staff_id,old.staff_role,remaining,old.start_time,old.end_time,old.shift_type,old.breaks,old.consultations,old.consulting_room_id,old.specialty_id,old.specialty_ids,greatest(effective,old.valid_from),old.valid_until,old.id,
     jsonb_build_object('preserved_from',old.id,'operation',p_key),auth.uid());
   END IF;
  ELSE
   SELECT array_agg(j.id ORDER BY j.id) INTO original_ids FROM public.staff_recurring_journeys j
    WHERE j.staff_id=employee AND j.active AND j.closed_on IS NULL AND (j.valid_until IS NULL OR j.valid_until>=effective);
   IF cardinality(original_ids) IS DISTINCT FROM jsonb_array_length(p_originals)
    OR EXISTS(SELECT 1 FROM public.staff_recurring_journeys j WHERE j.id=ANY(original_ids)
     AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_originals)x
       WHERE (x->>'id')::uuid=j.id AND x->>'version'=j.xmin::text)))
   THEN RAISE EXCEPTION 'La jornada completa cambió o tiene una vigencia posterior. Actualiza y revisa la fecha efectiva' USING ERRCODE='40001'; END IF;
   PERFORM 1 FROM public.staff_recurring_journeys WHERE id=ANY(original_ids) ORDER BY id FOR UPDATE;
   UPDATE public.staff_recurring_journeys SET closed_on=greatest(effective,valid_from),active=false,last_change_key=p_key,last_change_values=payload WHERE id=ANY(original_ids);
  END IF;
  -- Reuse the deployed validator and final-state checks; never validate an intermediate gap.
  IF p_values->>'active'='false' THEN result=jsonb_build_object('id',p_id);
 ELSE result=private.save_journey_validated(payload,NULL,NULL,p_key); END IF;
  UPDATE public.staff_recurring_journeys SET supersedes=p_id WHERE id=p_key;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),CASE WHEN p_weekday IS NULL THEN 'jornada_completa_editada' ELSE 'dia_recurrente_editado' END,
   'staff_recurring_journeys',p_key::text,jsonb_build_object('weekday',p_weekday,'previous_id',p_id,'effective_from',effective));
  PERFORM private.assert_staff_planning();
  SET CONSTRAINTS ALL IMMEDIATE;
  IF p_preview THEN RAISE EXCEPTION 'Preview rollback' USING ERRCODE='PZ001'; END IF;
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('preview',true,'valid',true);
 END;
 RETURN result;
END $function$
;
-- Bookings from a request must use a specialty selected for that recurring journey.
CREATE OR REPLACE FUNCTION public.schedule_appointment(p_patient uuid, p_doctor uuid, p_room uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_request uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; r public.appointment_requests%ROWTYPE;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_request IS NOT NULL THEN
  SELECT * INTO r FROM public.appointment_requests WHERE id=p_request FOR UPDATE;
  IF NOT FOUND OR r.patient_id IS DISTINCT FROM p_patient THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
  SELECT id INTO v_id FROM public.appointments WHERE request_id=p_request AND patient_id=p_patient AND doctor_id=p_doctor AND consulting_room_id=p_room AND starts_at=p_start AND ends_at=p_end AND status IN ('programada','confirmada','en_atencion');
  IF v_id IS NOT NULL AND r.status='agendada' THEN RETURN v_id; END IF;
  IF r.status NOT IN ('pendiente','en_revision') OR NOT EXISTS(SELECT 1 FROM public.doctor_specialties WHERE doctor_id=p_doctor AND specialty_id=r.specialty_id) THEN RAISE EXCEPTION 'La solicitud no está abierta o el médico no atiende la especialidad solicitada'; END IF;
 END IF;
 IF p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=p_patient) THEN RAISE EXCEPTION 'Verifica el expediente antes de programar'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start<=now() OR private.planning_valid_slot(p_doctor,p_room,p_start,p_end) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Cita fuera de disponibilidad, descanso o duración configurada'; END IF;
 IF p_request IS NOT NULL AND EXISTS(SELECT 1 FROM private.recurring_windows(p_start,p_end,p_doctor) w WHERE w.room_id=p_room AND w.starts_at<=p_start AND w.ends_at>=p_end) AND NOT EXISTS(SELECT 1 FROM private.recurring_windows(p_start,p_end,p_doctor) w JOIN public.staff_recurring_journeys j ON j.id=w.journey_id WHERE w.room_id=p_room AND w.starts_at<=p_start AND w.ends_at>=p_end AND r.specialty_id=ANY(j.specialty_ids)) THEN RAISE EXCEPTION 'La especialidad solicitada no está habilitada en esta jornada' USING ERRCODE='22023'; END IF;
 INSERT INTO public.appointments(request_id,patient_id,doctor_id,consulting_room_id,starts_at,ends_at,created_by)
 VALUES(p_request,p_patient,p_doctor,p_room,p_start,p_end,auth.uid()) RETURNING id INTO v_id;
 IF p_request IS NOT NULL THEN UPDATE public.appointment_requests SET status='agendada',reviewed_by=auth.uid() WHERE id=p_request; END IF;
 INSERT INTO public.appointment_status_history(appointment_id,new_status,actor_id) VALUES(v_id,'programada',auth.uid());
 RETURN v_id;
END $function$

