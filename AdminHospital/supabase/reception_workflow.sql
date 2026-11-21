-- Additive reception extension; existing iOS RPC signatures remain unchanged.
ALTER TABLE public.appointment_requests ADD COLUMN IF NOT EXISTS closure_reason text;

CREATE OR REPLACE FUNCTION public.close_attention_request(p_request uuid, p_status public.request_state, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('rechazada','cancelada') OR nullif(trim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Indica un motivo de hasta 2000 caracteres'; END IF;
 PERFORM public.review_attention_request(p_request,p_status);
 UPDATE public.appointment_requests SET closure_reason=trim(p_reason) WHERE id=p_request;
END $$;

CREATE OR REPLACE FUNCTION public.create_attention_patient(p_request uuid, p_identity_confirmed boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_requests%ROWTYPE; v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.appointment_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.requester_id IS NULL OR r.status NOT IN ('pendiente','en_revision') OR p_identity_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Verifica la identidad de una solicitud abierta'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=r.requester_id FOR UPDATE;
 SELECT id INTO v_id FROM public.patients WHERE profile_id=r.requester_id;
 IF v_id IS NULL AND EXISTS(SELECT 1 FROM public.patients WHERE dui=r.applicant_data->>'dui') THEN RAISE EXCEPTION 'Ya existe un expediente con este DUI. Búscalo y verifica su identidad.'; END IF;
 IF v_id IS NULL THEN
  v_id=public.create_walkin_patient(r.applicant_data->>'first_name',r.applicant_data->>'last_name',r.applicant_data->>'dui',r.applicant_data->>'phone',(r.applicant_data->>'birth_date')::date,NULL);
 END IF;
 PERFORM public.link_attention_patient(p_request,v_id,true);
 RETURN v_id;
END $$;

-- Preserve scheduling validations, lock order, history and atomic request update.
CREATE OR REPLACE FUNCTION public.schedule_appointment(p_patient uuid,p_doctor uuid,p_room uuid,p_start timestamptz,p_end timestamptz,p_request uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 INSERT INTO public.appointments(request_id,patient_id,doctor_id,consulting_room_id,starts_at,ends_at,created_by)
 VALUES(p_request,p_patient,p_doctor,p_room,p_start,p_end,auth.uid()) RETURNING id INTO v_id;
 IF p_request IS NOT NULL THEN UPDATE public.appointment_requests SET status='agendada',reviewed_by=auth.uid() WHERE id=p_request; END IF;
 INSERT INTO public.appointment_status_history(appointment_id,new_status,actor_id) VALUES(v_id,'programada',auth.uid());
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_attention_patient(uuid,boolean),public.close_attention_request(uuid,public.request_state,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_attention_patient(uuid,boolean),public.close_attention_request(uuid,public.request_state,text) TO authenticated;
