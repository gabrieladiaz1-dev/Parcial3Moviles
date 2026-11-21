-- PREPARED ONLY. Additive RPCs; no tables, migrations of data, RLS or iOS contracts changed.
-- Requires reception_workflow.sql, reception_walkin_contact.sql and staff planning contracts.
BEGIN;

CREATE OR REPLACE FUNCTION public.reception_specialty_doctors(p_specialty bigint,p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from timestamptz=p_day::timestamp AT TIME ZONE 'America/El_Salvador';
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_day IS NULL OR p_specialty IS NULL THEN RAISE EXCEPTION 'Selecciona especialidad y fecha' USING ERRCODE='22023'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',s.id,'name',concat_ws(' ',p.first_name,p.last_name),'specialty',sp.name,
 'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at) ORDER BY a.starts_at),'[]'::jsonb) FROM public.staff_shifts a WHERE a.staff_id=s.id AND a.status<>'cancelado' AND a.starts_at<v_from+interval '7 days' AND a.ends_at>v_from),
 'consultations',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'room_code',r.code,'slot_minutes',a.slot_minutes) ORDER BY a.starts_at),'[]'::jsonb) FROM public.doctor_consulting_rooms a JOIN public.consulting_rooms r ON r.id=a.consulting_room_id AND r.active WHERE a.doctor_id=s.id AND a.active AND a.starts_at<v_from+interval '7 days' AND a.ends_at>v_from),
 'breaks',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at) ORDER BY a.starts_at),'[]'::jsonb) FROM public.staff_absences a WHERE a.staff_id=s.id AND a.active AND a.starts_at<v_from+interval '7 days' AND a.ends_at>v_from)
 ) ORDER BY p.last_name,p.first_name,s.id),'[]'::jsonb)
 FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id
 JOIN public.doctor_specialties ds ON ds.doctor_id=s.id AND ds.specialty_id=p_specialty
 JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active
 WHERE s.active AND s.category='doctor' AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.role='doctor' AND u.active));
END $$;

CREATE OR REPLACE FUNCTION public.reception_prepare_record(p_values jsonb,p_identity_confirmed boolean,p_patient uuid DEFAULT NULL,p_request uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_requests%ROWTYPE; p public.patients%ROWTYPE;
 v_id uuid; v_code text; v_values jsonb=coalesce(p_values,'{}'::jsonb); k text;
 v_first text; v_last text; v_dui text; v_birth date; v_phone text; v_email text; v_city text;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_identity_confirmed IS DISTINCT FROM true OR jsonb_typeof(v_values)<>'object' THEN RAISE EXCEPTION 'Verifica la identidad con el documento del paciente' USING ERRCODE='22023'; END IF;
 -- Same order as scheduling and walk-in calls; atomic retry and duplicate protection.
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF p_request IS NOT NULL THEN
  SELECT * INTO r FROM public.appointment_requests WHERE id=p_request FOR UPDATE;
  IF NOT FOUND OR r.requester_id IS NULL OR r.status NOT IN ('pendiente','en_revision') THEN RAISE EXCEPTION 'La solicitud no está abierta' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=r.requester_id FOR UPDATE;
  -- Source identity/contact are immutable here. Only missing fields can be completed.
  FOREACH k IN ARRAY ARRAY['first_name','last_name','dui','birth_date','phone','email','city'] LOOP
   IF nullif(trim(r.applicant_data->>k),'') IS NOT NULL AND nullif(trim(v_values->>k),'') IS DISTINCT FROM nullif(trim(r.applicant_data->>k),'') THEN
    -- Existing patient fields can differ from stale request contact; linking RPC verifies identity.
    IF p_patient IS NULL THEN RAISE EXCEPTION 'Los datos existentes de la solicitud no deben sobrescribirse' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
 END IF;
 v_first=nullif(trim(v_values->>'first_name'),''); v_last=nullif(trim(v_values->>'last_name'),'');
 v_dui=replace(trim(v_values->>'dui'),'-',''); v_birth=nullif(v_values->>'birth_date','')::date;
 v_phone=nullif(trim(v_values->>'phone'),''); v_email=nullif(lower(trim(v_values->>'email')),''); v_city=nullif(trim(v_values->>'city'),'');
 IF v_first IS NULL OR v_last IS NULL OR length(v_first)>150 OR length(v_last)>150 OR v_dui IS NULL OR v_dui!~'^[0-9]{9}$' OR v_birth IS NULL OR v_birth>(now() AT TIME ZONE 'America/El_Salvador')::date OR v_birth<date '1900-01-01' THEN RAISE EXCEPTION 'Comprueba nombres, DUI y fecha de nacimiento' USING ERRCODE='22023'; END IF;
 IF v_email IS NOT NULL AND (length(v_email)>254 OR v_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'Comprueba el correo de contacto' USING ERRCODE='22023'; END IF;
 v_dui=left(v_dui,8)||'-'||right(v_dui,1);
 IF p_request IS NOT NULL THEN
  IF (nullif(trim(r.applicant_data->>'dui'),'') IS NOT NULL AND replace(trim(r.applicant_data->>'dui'),'-','')<>replace(v_dui,'-',''))
   OR (nullif(r.applicant_data->>'birth_date','') IS NOT NULL AND (r.applicant_data->>'birth_date')::date IS DISTINCT FROM v_birth)
   OR (nullif(trim(r.applicant_data->>'first_name'),'') IS NOT NULL AND lower(trim(r.applicant_data->>'first_name'))<>lower(v_first))
   OR (nullif(trim(r.applicant_data->>'last_name'),'') IS NOT NULL AND lower(trim(r.applicant_data->>'last_name'))<>lower(v_last))
  THEN RAISE EXCEPTION 'La identidad del documento no coincide con la solicitud. Solicita revisión; no se vincularán cuentas.' USING ERRCODE='22023'; END IF;
  IF p_patient IS NULL AND r.patient_id IS NOT NULL THEN RAISE EXCEPTION 'La solicitud ya tiene paciente. Recupera su registro existente.' USING ERRCODE='23505'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||v_dui,0));
 IF p_patient IS NOT NULL THEN
  SELECT * INTO p FROM public.patients WHERE id=p_patient FOR UPDATE;
  IF NOT FOUND OR p.dui IS DISTINCT FROM v_dui OR lower(trim(p.first_name))<>lower(v_first) OR lower(trim(p.last_name))<>lower(v_last) OR (p.birth_date IS NOT NULL AND p.birth_date IS DISTINCT FROM v_birth) THEN RAISE EXCEPTION 'La identidad no coincide con el paciente seleccionado' USING ERRCODE='22023'; END IF;
  IF p_request IS NOT NULL AND ((p.profile_id IS NOT NULL AND p.profile_id IS DISTINCT FROM r.requester_id) OR (r.patient_id IS NOT NULL AND r.patient_id IS DISTINCT FROM p.id)) THEN RAISE EXCEPTION 'Este paciente corresponde a otra cuenta o solicitud. Solicita revisión.' USING ERRCODE='42501'; END IF;
  v_id=p.id;
  -- Preserve existing data; this RPC is not a patient editing endpoint.
  IF p.birth_date IS NULL THEN UPDATE public.patients SET birth_date=v_birth WHERE id=v_id; END IF;
  INSERT INTO public.medical_records(patient_id,opened_by) VALUES(v_id,auth.uid()) ON CONFLICT(patient_id) DO NOTHING;
 ELSE
  IF EXISTS(SELECT 1 FROM public.patients WHERE dui=v_dui OR (p_request IS NOT NULL AND profile_id=r.requester_id)) THEN RAISE EXCEPTION 'Ya existe un paciente. Búscalo y verifica su identidad antes de continuar.' USING ERRCODE='23505'; END IF;
  v_id=public.create_walkin_patient(v_first,v_last,v_dui,v_phone,v_birth,v_city,v_email);
 END IF;
 IF p_request IS NOT NULL THEN
  -- Fill only absent applicant fields, then use the established ownership verification contract.
  FOREACH k IN ARRAY ARRAY['first_name','last_name','dui','birth_date','phone','email','city'] LOOP
   IF nullif(trim(r.applicant_data->>k),'') IS NULL AND nullif(trim(v_values->>k),'') IS NOT NULL THEN r.applicant_data=jsonb_set(coalesce(r.applicant_data,'{}'::jsonb),ARRAY[k],v_values->k); END IF;
  END LOOP;
  UPDATE public.appointment_requests SET applicant_data=r.applicant_data WHERE id=p_request;
  PERFORM public.link_attention_patient(p_request,v_id,true);
 END IF;
 SELECT * INTO p FROM public.patients WHERE id=v_id;
 SELECT record_code INTO STRICT v_code FROM public.medical_records WHERE patient_id=v_id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'expediente_verificado_recepcion','medical_records',v_code,jsonb_build_object('patient_id',v_id,'request_id',p_request));
 RETURN jsonb_build_object('patient',jsonb_build_object('id',p.id,'profile_id',p.profile_id,'first_name',p.first_name,'last_name',p.last_name,'patient_code',p.patient_code,'dui',p.dui,'birth_date',p.birth_date,'phone',p.phone,'email',p.email,'city',p.city),'record_code',v_code);
END $$;
REVOKE ALL ON FUNCTION public.reception_specialty_doctors(bigint,date),public.reception_prepare_record(jsonb,boolean,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reception_specialty_doctors(bigint,date),public.reception_prepare_record(jsonb,boolean,uuid,uuid) TO authenticated;
COMMIT;
