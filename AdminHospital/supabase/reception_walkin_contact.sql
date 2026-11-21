-- Patient contact email is independent of Auth identity and never grants ownership.
ALTER TABLE public.patients ADD COLUMN email text
 CHECK(email IS NULL OR (length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));

-- Preserve the six-argument contract used by iOS reception linking and other callers.
-- Seven explicit arguments select this compatible extension, without default ambiguity.
CREATE FUNCTION public.create_walkin_patient(p_first text,p_last text,p_dui text,p_phone text,p_birth date,p_city text,p_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE patient_id uuid; prior_id uuid; document text=replace(trim(p_dui),'-',''); contact text=nullif(lower(trim(p_email)),'');
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF contact IS NOT NULL AND (length(contact)>254 OR contact !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'Correo inválido. Usa nombre@dominio.com' USING ERRCODE='22023'; END IF;
 IF document IS NULL OR document !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'DUI inválido: 00000000-0' USING ERRCODE='22023'; END IF;
 document=left(document,8)||'-'||right(document,1);
 PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||document,0));
 SELECT id INTO prior_id FROM public.patients WHERE dui=document FOR UPDATE;
 patient_id=public.create_walkin_patient(p_first,p_last,document,p_phone,p_birth,p_city);
 IF prior_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.patients p WHERE p.id=prior_id AND (p.email IS DISTINCT FROM contact OR p.phone IS DISTINCT FROM nullif(trim(p_phone),'') OR p.city IS DISTINCT FROM nullif(trim(p_city),''))) THEN
   RAISE EXCEPTION 'El expediente ya existe. Recupéralo sin sobrescribir sus datos.' USING ERRCODE='23505';
  END IF;
 ELSE
  UPDATE public.patients SET email=contact WHERE id=patient_id;
 END IF;
 RETURN patient_id;
END $$;
REVOKE ALL ON FUNCTION public.create_walkin_patient(text,text,text,text,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_walkin_patient(text,text,text,text,date,text,text) TO authenticated;

-- A receptionist checkbox is not authenticated medical authorization.
-- Only physician-authenticated admission RPCs may originate hospital admissions.
DO $$
DECLARE source text; changed text;
BEGIN
 source=pg_get_functiondef('public.reception_walkin_attention(uuid,uuid,jsonb)'::regprocedure);
 changed=replace(source,'mode=p_values->>''mode'';','mode=p_values->>''mode''; IF mode=''admission'' THEN RAISE EXCEPTION ''El ingreso requiere una solicitud emitida por el médico desde su cuenta autenticada. Continúa desde Hospitalización cuando esté autorizada.'' USING ERRCODE=''42501''; END IF;');
 IF changed=source THEN RAISE EXCEPTION 'Revisar contrato de atención presencial antes de bloquear ingresos no autenticados'; END IF;
 EXECUTE changed;
END $$;
