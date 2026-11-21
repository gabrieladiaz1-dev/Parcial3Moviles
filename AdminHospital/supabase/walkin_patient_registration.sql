-- Keep existing signatures, UUIDs, unique constraints and RLS policies.
CREATE OR REPLACE FUNCTION public.create_walkin_patient(p_first text,p_last text,p_dui text,p_phone text,p_birth date,p_city text,p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE patient_id uuid; document text=replace(trim(p_dui),'-',''); contact text=nullif(lower(trim(p_email)),'');
 today date=(now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_first),'') IS NULL OR length(trim(p_first))>100 THEN RAISE EXCEPTION 'Escribe los nombres del paciente' USING ERRCODE='22023',HINT='first'; END IF;
 IF nullif(trim(p_last),'') IS NULL OR length(trim(p_last))>100 THEN RAISE EXCEPTION 'Escribe los apellidos del paciente' USING ERRCODE='22023',HINT='last'; END IF;
 IF document IS NULL OR document !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'DUI inválido: 00000000-0' USING ERRCODE='22023',HINT='dui'; END IF;
 IF p_birth IS NULL OR p_birth>today OR p_birth<(today-interval '120 years')::date THEN RAISE EXCEPTION 'Indica una fecha de nacimiento válida, no futura' USING ERRCODE='22023',HINT='birth'; END IF;
 IF p_phone IS NULL OR trim(p_phone)!~'^[2567][0-9]{3}-[0-9]{4}$' THEN RAISE EXCEPTION 'Indica un teléfono salvadoreño de 8 dígitos' USING ERRCODE='22023',HINT='phone'; END IF;
 IF contact IS NOT NULL AND (length(contact)>254 OR contact !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'Correo inválido. Usa nombre@dominio.com' USING ERRCODE='22023',HINT='email'; END IF;
 IF coalesce(length(trim(p_city)),0)>120 THEN RAISE EXCEPTION 'La ciudad admite hasta 120 caracteres' USING ERRCODE='22023',HINT='city'; END IF;
 document=left(document,8)||'-'||right(document,1);
 PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||document,0));
 -- The existing six-argument function serializes duplicate DUI, verifies identity,
 -- and creates patients + medical_records + audit atomically. Never calls Auth.
 patient_id=public.create_walkin_patient(p_first,p_last,document,p_phone,p_birth,p_city);
 -- Do not overwrite existing contact data, even on a retried registration.
 IF EXISTS(SELECT 1 FROM public.patients WHERE id=patient_id AND email IS NOT NULL AND email IS DISTINCT FROM contact) THEN
  RAISE EXCEPTION 'El paciente ya está registrado. Recupera su expediente sin sobrescribir sus datos' USING ERRCODE='23505'; END IF;
 UPDATE public.patients SET email=contact WHERE id=patient_id AND email IS NULL AND created_by=auth.uid() AND created_at=now() AND profile_id IS NULL;
 RETURN patient_id;
END $$;

CREATE OR REPLACE FUNCTION public.register_patient(p_dui text,p_phone text DEFAULT NULL,p_city text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; profile public.profiles%ROWTYPE; patient public.patients%ROWTYPE;
 document text=replace(trim(p_dui),'-',''); today date=(now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('paciente') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 -- A verified Auth account is mandatory. Contact email in patients never grants access.
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL AND (banned_until IS NULL OR banned_until<=now())) THEN
  RAISE EXCEPTION 'Verifica tu correo antes de registrar o vincular tu expediente' USING ERRCODE='42501'; END IF;
 IF document IS NULL OR document!~'^[0-9]{9}$' THEN RAISE EXCEPTION 'DUI inválido: 00000000-0' USING ERRCODE='22023'; END IF;
 document=left(document,8)||'-'||right(document,1);
 -- Same locking order for every registration: DUI, then profile, then patient.
 PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||document,0));
 SELECT * INTO profile FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR nullif(trim(profile.first_name),'') IS NULL OR nullif(trim(profile.last_name),'') IS NULL
  OR profile.birth_date IS NULL OR profile.birth_date>today THEN RAISE EXCEPTION 'Completa nombres, apellidos y fecha de nacimiento en tu perfil' USING ERRCODE='22023'; END IF;
 SELECT id INTO v_id FROM public.patients WHERE profile_id=auth.uid();
 IF FOUND THEN
  IF EXISTS(SELECT 1 FROM public.patients WHERE id=v_id AND dui=document) THEN RETURN v_id; END IF;
  RAISE EXCEPTION 'Tu cuenta ya tiene un paciente vinculado. Acude a recepción para verificar tu identidad' USING ERRCODE='23505';
 END IF;
 SELECT * INTO patient FROM public.patients WHERE dui=document FOR UPDATE;
 IF FOUND THEN
  IF patient.profile_id IS NOT NULL OR patient.registration_source<>'presencial' THEN
   RAISE EXCEPTION 'No se pudo vincular el expediente. Acude a recepción para verificar tu identidad' USING ERRCODE='23505'; END IF;
  -- Full names (case/whitespace normalized) AND exact birth date are all required.
  -- Partial names, phone, contact email and knowing only a DUI never authorize ownership.
  IF lower(regexp_replace(trim(patient.first_name),'\s+',' ','g')) IS DISTINCT FROM lower(regexp_replace(trim(profile.first_name),'\s+',' ','g'))
   OR lower(regexp_replace(trim(patient.last_name),'\s+',' ','g')) IS DISTINCT FROM lower(regexp_replace(trim(profile.last_name),'\s+',' ','g'))
   OR patient.birth_date IS NULL OR patient.birth_date IS DISTINCT FROM profile.birth_date
   OR NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=patient.id)
  THEN RAISE EXCEPTION 'Los datos no coinciden. Acude a recepción para verificar tu identidad; no se vinculó ningún expediente' USING ERRCODE='22023'; END IF;
  UPDATE public.patients SET profile_id=auth.uid() WHERE id=patient.id AND profile_id IS NULL;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id) VALUES(auth.uid(),'vinculacion_presencial_ios','patients',patient.id::text);
  RETURN patient.id;
 END IF;
 IF coalesce(length(p_phone),0)>30 OR coalesce(length(p_city),0)>120 THEN RAISE EXCEPTION 'Revisa teléfono y ciudad' USING ERRCODE='22023'; END IF;
 INSERT INTO public.patients(profile_id,first_name,last_name,dui,phone,birth_date,city,registration_source)
 VALUES(auth.uid(),profile.first_name,profile.last_name,document,coalesce(p_phone,profile.phone),profile.birth_date,coalesce(p_city,profile.city),'ios') RETURNING id INTO v_id;
 INSERT INTO public.medical_records(patient_id) VALUES(v_id);
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.register_patient(text,text,text),public.create_walkin_patient(text,text,text,text,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_patient(text,text,text),public.create_walkin_patient(text,text,text,text,date,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
