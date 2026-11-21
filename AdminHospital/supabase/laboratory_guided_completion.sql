-- Keep the existing order/result/record relations; enrich the protected detail only.
DO $$
DECLARE source text; changed text;
BEGIN
 source=pg_get_functiondef('public.laboratory_order_detail(uuid)'::regprocedure);
 changed=replace(source,'''patient_name'',concat_ws('' '',p.first_name,p.last_name),''record_code'',m.record_code,',
  '''patient_name'',concat_ws('' '',p.first_name,p.last_name),''patient_first_name'',p.first_name,''patient_last_name'',p.last_name,''patient_dui'',p.dui,''patient_phone'',coalesce(nullif(p.phone,''''),(SELECT pp.phone FROM public.profiles pp WHERE pp.id=p.profile_id)),''patient_email'',(SELECT u.email FROM auth.users u WHERE u.id=p.profile_id),''record_code'',m.record_code,');
 IF changed=source THEN RAISE EXCEPTION 'Inspect laboratory detail before enriching identity'; END IF;
 changed=replace(changed,'''validator_name'',(SELECT concat_ws('' '',first_name,last_name) FROM public.profiles WHERE id=coalesce(d.draft_validated_by,r.validated_by)),',
  '''validator_name'',(SELECT concat_ws('' '',first_name,last_name) FROM public.profiles WHERE id=r.validated_by),''draft_validator_name'',(SELECT concat_ws('' '',first_name,last_name) FROM public.profiles WHERE id=d.draft_validated_by),');
 changed=replace(changed,'''action'',h.action,''at'',h.occurred_at,','''action'',h.action,''status'',h.metadata->>''to'',''at'',h.occurred_at,');
 EXECUTE changed;
END $$;

CREATE FUNCTION private.audit_laboratory_order_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'estado_laboratorio','lab_orders',NEW.id::text,jsonb_build_object('from',CASE WHEN TG_OP='UPDATE' THEN OLD.status END,'to',NEW.status,'order_code',NEW.order_code));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.audit_laboratory_order_state() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER laboratory_state_history AFTER INSERT OR UPDATE OF status ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION private.audit_laboratory_order_state();

CREATE FUNCTION public.complete_laboratory_exam(p_order uuid,p_version integer,p_summary text,p_values jsonb,p_to_patient boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.lab_result_drafts; r public.lab_results; changed boolean;
BEGIN
 IF NOT private.lab_permission('publish') THEN RAISE EXCEPTION 'Completar requiere autorización clínica para publicar resultados' USING ERRCODE='42501'; END IF;
 IF p_to_patient IS NULL OR p_version IS NULL THEN RAISE EXCEPTION 'Confirma la publicación y actualiza la solicitud'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 SELECT * INTO d FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Marca primero la solicitud como En proceso'; END IF;
 SELECT * INTO r FROM public.lab_results WHERE order_id=p_order FOR UPDATE;
 changed=d.draft_summary IS DISTINCT FROM p_summary OR d.draft_values IS DISTINCT FROM p_values;
 IF d.workflow_stage='published' THEN
  IF NOT changed AND p_version<=d.version AND p_to_patient=(r.published_to_patient_at IS NOT NULL) THEN RETURN r.id; END IF;
  RAISE EXCEPTION 'Esta versión ya fue publicada. Actualiza o prepara una corrección trazable.';
 END IF;
 IF d.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Los resultados cambiaron. Actualiza antes de completar.'; END IF;
 IF (changed OR d.workflow_stage='draft') AND NOT private.lab_permission('process') THEN RAISE EXCEPTION 'Preparar o cambiar los resultados requiere autorización de procesamiento' USING ERRCODE='42501'; END IF;
 IF (changed OR d.workflow_stage IN ('draft','review')) AND NOT private.lab_permission('validate') THEN RAISE EXCEPTION 'Estos resultados requieren validación por personal clínicamente autorizado' USING ERRCODE='42501'; END IF;
 PERFORM private.lab_check_payload(d.draft_schema,p_values,p_summary,true);
 IF changed THEN
  PERFORM public.save_laboratory_draft(p_order,d.version,p_summary,p_values);
  SELECT * INTO d FROM public.lab_result_drafts WHERE order_id=p_order;
 END IF;
 IF d.workflow_stage='draft' THEN
  PERFORM public.submit_laboratory_validation(p_order,d.version);
  SELECT * INTO d FROM public.lab_result_drafts WHERE order_id=p_order;
 END IF;
 IF d.workflow_stage='review' THEN
  PERFORM public.validate_laboratory_result(p_order,d.version);
  SELECT * INTO d FROM public.lab_result_drafts WHERE order_id=p_order;
 END IF;
 IF d.workflow_stage<>'validated' THEN RAISE EXCEPTION 'No se pudo completar la validación'; END IF;
 -- Existing publication writes result, state, audit and notifications in this transaction.
 RETURN public.publish_laboratory_order(p_order,d.version,p_to_patient);
END $$;
REVOKE ALL ON FUNCTION public.complete_laboratory_exam(uuid,integer,text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_laboratory_exam(uuid,integer,text,jsonb,boolean) TO authenticated;
