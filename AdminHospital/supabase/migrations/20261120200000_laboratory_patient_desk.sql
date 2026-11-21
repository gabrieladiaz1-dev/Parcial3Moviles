-- Laboratorio: búsqueda por paciente (nombre, DUI o correo) y listado de sus órdenes con borrador.
-- Solo lectura. Los cambios de estado y el envío reutilizan start_laboratory_order y
-- complete_laboratory_exam(p_to_patient=true), que ya publican al portal del paciente.
CREATE OR REPLACE FUNCTION public.laboratory_search_patients(p_query text)
RETURNS TABLE(id uuid, full_name text, email text, dui text, phone text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE term text=lower(trim(coalesce(p_query,''))); digits text=regexp_replace(coalesce(p_query,''),'\D','','g');
 pat text;
BEGIN
 IF NOT private.lab_permission('any') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF length(term)<2 THEN RETURN; END IF;
 pat='%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%';
 RETURN QUERY
 SELECT p.id, concat_ws(' ',p.first_name,p.last_name), p.email, p.dui, p.phone
 FROM public.patients p
 WHERE lower(concat_ws(' ',p.first_name,p.last_name)) LIKE pat
    OR (p.email IS NOT NULL AND lower(p.email) LIKE pat)
    OR (length(digits)>=4 AND replace(coalesce(p.dui,''),'-','') LIKE digits||'%')
 ORDER BY p.last_name, p.first_name, p.id
 LIMIT 20;
END $$;

CREATE OR REPLACE FUNCTION public.laboratory_patient_orders(p_patient uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.lab_permission('any') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN coalesce((
  SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'order_code',o.order_code,'test_name',t.name,'status',o.status,'ordered_at',o.ordered_at,'reason',o.reason,
   'version',d.version,'workflow_stage',d.workflow_stage,'draft_summary',d.draft_summary,'draft_values',coalesce(d.draft_values,'{}'::jsonb),
   'has_required_parameters',EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(d.draft_schema,t.result_schema,'[]'::jsonb)) x WHERE (x->>'required')::boolean),
   'published_summary',r.summary,'published_at',r.published_at,'published_to_patient_at',r.published_to_patient_at)
   ORDER BY (o.status<>'completado') DESC, o.ordered_at DESC)
  FROM public.lab_orders o
  JOIN public.lab_test_types t ON t.id=o.test_type_id
  JOIN public.clinical_encounters e ON e.id=o.encounter_id
  JOIN public.medical_records mr ON mr.id=e.record_id
  LEFT JOIN public.lab_result_drafts d ON d.order_id=o.id
  LEFT JOIN public.lab_results r ON r.order_id=o.id
  WHERE mr.patient_id=p_patient),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.laboratory_search_patients(text),public.laboratory_patient_orders(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.laboratory_search_patients(text),public.laboratory_patient_orders(uuid) TO authenticated;
