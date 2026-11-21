-- Farmacia: búsqueda mínima de pacientes, recetas y cambio de estado Pendiente/Entregada.
-- No expone el expediente clínico. El paciente sigue leyendo prescriptions.status con la RLS existente
-- (prescription_read → private.my_patient), por lo que el cambio es visible en su portal sin tocar iOS/Android.
ALTER TABLE public.prescriptions
 ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
 ADD COLUMN IF NOT EXISTS status_updated_by uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION public.pharmacy_search_patients(p_query text)
RETURNS TABLE(id uuid, full_name text, email text, dui text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE term text=lower(trim(coalesce(p_query,''))); digits text=regexp_replace(coalesce(p_query,''),'\D','','g');
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF length(term)<2 THEN RETURN; END IF;
 RETURN QUERY
 SELECT p.id, concat_ws(' ',p.first_name,p.last_name), p.email, p.dui, p.phone
 FROM public.patients p
 WHERE lower(concat_ws(' ',p.first_name,p.last_name)) LIKE '%'||replace(replace(term,'%','\%'),'_','\_')||'%'
    OR (p.email IS NOT NULL AND lower(p.email) LIKE '%'||replace(replace(term,'%','\%'),'_','\_')||'%')
    OR (length(digits)>=4 AND replace(coalesce(p.dui,''),'-','') LIKE digits||'%')
 ORDER BY p.last_name, p.first_name, p.id
 LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.pharmacy_patient_prescriptions(p_patient uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN coalesce((
  SELECT jsonb_agg(jsonb_build_object(
   'id',rx.id,'code',rx.prescription_code,'issued_at',rx.issued_at,'status',rx.status,'status_updated_at',rx.status_updated_at,
   'items',coalesce((SELECT jsonb_agg(jsonb_build_object('medication',concat_ws(' ',m.name,m.strength,m.presentation),
     'dose',i.dose,'dose_unit',i.dose_unit,'frequency_hours',i.frequency_hours,'route',i.route,'quantity',i.quantity,'observations',i.observations) ORDER BY m.name)
    FROM public.prescription_items i JOIN public.medications m ON m.id=i.medication_id WHERE i.prescription_id=rx.id),'[]'::jsonb))
   ORDER BY (rx.status IN('pendiente','parcial')) DESC, rx.issued_at DESC)
  FROM public.prescriptions rx
  JOIN public.clinical_encounters e ON e.id=rx.encounter_id
  JOIN public.medical_records r ON r.id=e.record_id
  WHERE r.patient_id=p_patient AND rx.status<>'anulada'),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.pharmacy_set_prescription_status(p_prescription uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.prescriptions%ROWTYPE;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN('pendiente','entregada') THEN RAISE EXCEPTION 'Estado no permitido: usa Pendiente o Entregada' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.prescriptions WHERE id=p_prescription FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Receta no encontrada' USING ERRCODE='P0002'; END IF;
 IF v.status='anulada' THEN RAISE EXCEPTION 'La receta está anulada y no puede cambiar de estado' USING ERRCODE='22023'; END IF;
 IF v.status<>p_status THEN
  UPDATE public.prescriptions SET status=p_status, status_updated_at=now(), status_updated_by=auth.uid() WHERE id=v.id RETURNING * INTO v;
 END IF;
 RETURN jsonb_build_object('id',v.id,'status',v.status,'status_updated_at',v.status_updated_at);
END $$;

REVOKE ALL ON FUNCTION public.pharmacy_search_patients(text),public.pharmacy_patient_prescriptions(uuid),public.pharmacy_set_prescription_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pharmacy_search_patients(text),public.pharmacy_patient_prescriptions(uuid),public.pharmacy_set_prescription_status(uuid,text) TO authenticated;
