-- Physical reception reuses patients, records, attention requests, scheduling and beds.
-- No Auth accounts, clinical encounters, diagnoses or changes to clinical-write-integrity.
CREATE OR REPLACE FUNCTION public.create_walkin_patient(p_first text,p_last text,p_dui text,p_phone text,p_birth date,p_city text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; existing public.patients; document text=nullif(trim(p_dui),'');
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_first),'') IS NULL OR nullif(trim(p_last),'') IS NULL OR length(trim(p_first))>100 OR length(trim(p_last))>100
 OR (p_birth IS NOT NULL AND (p_birth>current_date OR p_birth<(current_date-interval '120 years')::date))
 OR coalesce(length(p_city),0)>120 OR (nullif(trim(p_phone),'') IS NOT NULL AND trim(p_phone)!~'^[0-9]{4}-[0-9]{4}$') THEN
  RAISE EXCEPTION 'Revisa nombres, nacimiento, teléfono (0000-0000) y ciudad' USING ERRCODE='22023'; END IF;
 IF document IS NOT NULL THEN
  IF document!~'^[0-9]{8}-?[0-9]$' THEN RAISE EXCEPTION 'DUI inválido: 00000000-0' USING ERRCODE='22023'; END IF;
  document=replace(document,'-',''); document=left(document,8)||'-'||right(document,1);
  PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||document,0));
  SELECT * INTO existing FROM public.patients WHERE dui=document FOR UPDATE;
  IF FOUND THEN
   IF lower(trim(existing.first_name)) IS DISTINCT FROM lower(trim(p_first)) OR lower(trim(existing.last_name)) IS DISTINCT FROM lower(trim(p_last)) OR existing.birth_date IS DISTINCT FROM p_birth THEN
    RAISE EXCEPTION 'Ya existe un paciente con este DUI. Consulta y verifica su identidad; no crees otro expediente.' USING ERRCODE='23505'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=existing.id) THEN RAISE EXCEPTION 'El paciente ya existe sin expediente. Requiere revisión administrativa.'; END IF;
   RETURN existing.id;
  END IF;
 END IF;
 INSERT INTO public.patients(first_name,last_name,dui,phone,birth_date,city,registration_source,created_by)
 VALUES(trim(p_first),trim(p_last),document,nullif(trim(p_phone),''),p_birth,nullif(trim(p_city),''),'presencial',auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.medical_records(patient_id,opened_by) VALUES(v_id,auth.uid());
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id) VALUES(auth.uid(),'registro_presencial','patients',v_id::text);
 RETURN v_id;
END $$;

CREATE FUNCTION public.reception_walkin_attention(p_patient uuid,p_key uuid,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE patient public.patients; r public.appointment_requests; appointment uuid; admission uuid;
 doctor uuid; room uuid; specialty bigint; starts timestamptz; ends timestamptz; mode text; priority text; reason text; symptoms text; kind public.room_kind;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR p_values->>'identity_confirmed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirma la identidad del paciente' USING ERRCODE='22023'; END IF;
 mode=p_values->>'mode'; priority=p_values->>'priority'; reason=trim(p_values->>'reason'); symptoms=nullif(trim(p_values->>'symptoms'),'');
 doctor=(p_values->>'doctor_id')::uuid; room=(p_values->>'room_id')::uuid; specialty=(p_values->>'specialty_id')::bigint;
 starts=(p_values->>'starts_at')::timestamptz; ends=(p_values->>'ends_at')::timestamptz;
 IF mode IS NULL OR mode NOT IN ('scheduled','immediate','admission') OR priority IS NULL OR priority NOT IN ('normal','urgente')
 OR nullif(reason,'') IS NULL OR length(reason)>2000 OR coalesce(length(symptoms),0)>1000 OR (mode<>'scheduled' AND symptoms IS NULL)
 OR doctor IS NULL OR room IS NULL OR specialty IS NULL OR starts IS NULL OR ends IS NULL THEN RAISE EXCEPTION 'Completa motivo, síntomas, prioridad y horario disponible' USING ERRCODE='22023'; END IF;
 -- Same lock order as scheduling/personnel, then patient. Retry compares the complete payload.
 PERFORM pg_advisory_xact_lock(726391054201::bigint);
 SELECT * INTO patient FROM public.patients WHERE id=p_patient FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=p_patient) THEN RAISE EXCEPTION 'Verifica primero el expediente'; END IF;
 SELECT * INTO r FROM public.appointment_requests WHERE id=p_key FOR UPDATE;
 IF FOUND THEN
  IF r.patient_id IS DISTINCT FROM p_patient OR r.requester_id IS NOT NULL OR r.applicant_data->'walkin' IS DISTINCT FROM p_values THEN RAISE EXCEPTION 'Este envío ya existe con otros datos. Actualiza antes de continuar.'; END IF;
  SELECT id INTO appointment FROM public.appointments WHERE request_id=r.id;
  SELECT id INTO admission FROM public.hospital_admissions WHERE patient_id=p_patient AND request_key=p_key;
  IF appointment IS NULL THEN RAISE EXCEPTION 'Envío incompleto: requiere revisión'; END IF;
  RETURN jsonb_build_object('appointment_id',appointment,'admission_id',admission);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.specialties WHERE id=specialty AND active) OR NOT EXISTS(SELECT 1 FROM public.staff s JOIN public.user_roles u ON u.user_id=s.profile_id AND u.role='doctor' AND u.active JOIN public.doctor_specialties d ON d.doctor_id=s.id WHERE s.id=doctor AND s.active AND s.category='doctor' AND d.specialty_id=specialty) THEN RAISE EXCEPTION 'Selecciona un médico activo de la especialidad'; END IF;
 IF mode IN ('immediate','admission') AND (starts<=now() OR starts>now()+interval '2 hours' OR (starts AT TIME ZONE 'America/El_Salvador')::date<>(now() AT TIME ZONE 'America/El_Salvador')::date) THEN RAISE EXCEPTION 'No hay atención próxima en ese horario. Consulta disponibilidad actual u ofrece una cita programada.'; END IF;
 IF mode='admission' THEN
  kind=(p_values->>'kind')::public.room_kind;
  IF kind IS NULL OR p_values->>'medical_indication_confirmed' IS DISTINCT FROM 'true' OR coalesce(length(p_values->>'instructions'),0)>10000 THEN RAISE EXCEPTION 'Confirma la indicación médica recibida y la categoría de hospitalización'; END IF;
 END IF;
 INSERT INTO public.appointment_requests(id,patient_id,specialty_id,preferred_period,reason,other_symptoms,applicant_data,status,reviewed_by)
 VALUES(p_key,p_patient,specialty,'indiferente',reason,symptoms,jsonb_build_object('first_name',patient.first_name,'last_name',patient.last_name,'dui',patient.dui,'birth_date',patient.birth_date,'phone',patient.phone,'walkin',p_values),'en_revision',auth.uid());
 appointment=public.schedule_appointment(p_patient,doctor,room,starts,ends,p_key);
 IF mode='admission' THEN
  -- Reception records a received indication, never impersonates a physician or signs a clinical encounter.
  INSERT INTO public.hospital_admissions(patient_id,ordered_by,requested_kind,medical_reason,clinical_instructions,priority,request_key,reviewed_at,reviewed_by)
  VALUES(p_patient,doctor,kind,reason,nullif(trim(p_values->>'instructions'),''),priority,p_key,now(),auth.uid()) RETURNING id INTO admission;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'indicacion_presencial_recibida','hospital_admissions',admission::text,jsonb_build_object('doctor_id',doctor,'appointment_id',appointment,'source','presencial'));
 END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'atencion_presencial','appointments',appointment::text,jsonb_build_object('mode',mode,'request_id',p_key,'priority',priority));
 RETURN jsonb_build_object('appointment_id',appointment,'admission_id',admission);
END $$;
REVOKE ALL ON FUNCTION public.create_walkin_patient(text,text,text,text,date,text),public.reception_walkin_attention(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_walkin_patient(text,text,text,text,date,text),public.reception_walkin_attention(uuid,uuid,jsonb) TO authenticated;
