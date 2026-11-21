-- Extend the existing one-exam-per-order native iOS contract. No clinical seeds.
CREATE TABLE public.laboratory_authorizations (
 staff_id uuid PRIMARY KEY REFERENCES public.staff(id), can_process boolean NOT NULL DEFAULT false,
 can_validate boolean NOT NULL DEFAULT false, can_publish boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true, authorized_by uuid NOT NULL REFERENCES public.profiles(id), authorized_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.laboratory_authorizations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.laboratory_authorizations TO authenticated;
CREATE POLICY laboratory_authorization_read ON public.laboratory_authorizations FOR SELECT TO authenticated USING(private.has_role('admin') OR EXISTS(SELECT 1 FROM public.staff s WHERE s.id=staff_id AND s.profile_id=auth.uid()));

CREATE FUNCTION private.lab_permission(p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.laboratory_authorizations a JOIN public.staff s ON s.id=a.staff_id
 WHERE s.profile_id=auth.uid() AND s.active AND a.active AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=s.profile_id AND r.active AND r.role::text=s.category)
 AND CASE p_permission WHEN 'process' THEN a.can_process WHEN 'validate' THEN a.can_validate WHEN 'publish' THEN a.can_publish WHEN 'any' THEN a.can_process OR a.can_validate OR a.can_publish ELSE false END)
$$;
REVOKE ALL ON FUNCTION private.lab_permission(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.lab_permission(text) TO authenticated;
CREATE FUNCTION public.my_laboratory_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('can_view',private.has_role('admin') OR private.lab_permission('any'),'can_manage',private.has_role('admin'),
 'can_process',private.lab_permission('process'),'can_validate',private.lab_permission('validate'),'can_publish',private.lab_permission('publish'))
$$;

ALTER TABLE public.lab_test_types ADD COLUMN result_schema jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.lab_test_types ADD COLUMN schema_validated_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.lab_test_types ADD COLUMN schema_validated_at timestamptz;
ALTER TABLE public.lab_results ADD COLUMN result_values jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.lab_results ADD COLUMN parameter_schema jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.lab_results ADD COLUMN validated_at timestamptz;
ALTER TABLE public.lab_results ADD COLUMN published_at timestamptz;
ALTER TABLE public.lab_results ADD COLUMN published_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.lab_results ADD COLUMN published_revision integer NOT NULL DEFAULT 0;
CREATE TABLE public.lab_result_drafts (
 id uuid PRIMARY KEY REFERENCES public.lab_results(id),order_id uuid NOT NULL UNIQUE REFERENCES public.lab_orders(id),
 draft_summary text NOT NULL DEFAULT '',draft_values jsonb NOT NULL DEFAULT '{}',draft_schema jsonb NOT NULL DEFAULT '[]',
 workflow_stage text NOT NULL DEFAULT 'draft' CHECK(workflow_stage IN ('draft','review','validated','published')),
 draft_validated_by uuid REFERENCES public.profiles(id),draft_validated_at timestamptz,prepared_by uuid REFERENCES public.profiles(id),
 version integer NOT NULL DEFAULT 0,correction_reason text,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lab_result_drafts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.lab_result_drafts TO authenticated;
CREATE POLICY laboratory_draft_read ON public.lab_result_drafts FOR SELECT TO authenticated USING(private.lab_permission('any'));
-- Preserve publication metadata of any legitimate legacy result without changing content.
UPDATE public.lab_results SET published_at=completed_at,validated_at=completed_at,published_by=validated_by,
 published_revision=1
WHERE completed_at IS NOT NULL AND validated_by IS NOT NULL;
INSERT INTO public.lab_result_drafts(id,order_id,draft_summary,workflow_stage)
 SELECT id,order_id,summary,CASE WHEN published_at IS NOT NULL THEN 'published' ELSE 'draft' END FROM public.lab_results;

CREATE FUNCTION public.authorize_laboratory_staff(p_staff uuid,p_process boolean,p_validate boolean,p_publish boolean,p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede autorizar personal de laboratorio' USING ERRCODE='42501'; END IF;
 IF p_process IS NULL OR p_validate IS NULL OR p_publish IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'Completa las autorizaciones'; END IF;
 PERFORM 1 FROM public.staff s WHERE s.id=p_staff AND s.active AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=s.profile_id AND r.active AND r.role::text=s.category) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona personal activo con rol vigente'; END IF;
 INSERT INTO public.laboratory_authorizations(staff_id,can_process,can_validate,can_publish,active,authorized_by) VALUES(p_staff,p_process,p_validate,p_publish,p_active,auth.uid())
 ON CONFLICT(staff_id) DO UPDATE SET can_process=excluded.can_process,can_validate=excluded.can_validate,can_publish=excluded.can_publish,active=excluded.active,authorized_by=auth.uid(),authorized_at=now();
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'autorizar_laboratorio','staff',p_staff::text,jsonb_build_object('process',p_process,'validate',p_validate,'publish',p_publish,'active',p_active));
END $$;

CREATE FUNCTION private.validate_lab_schema(p_schema jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p jsonb; seen text[]='{}';
BEGIN
 IF jsonb_typeof(p_schema) IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema)>50 THEN RAISE EXCEPTION 'Define hasta 50 parámetros'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(p_schema) LOOP
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'key','') !~ '^[a-z][a-z0-9_]{0,39}$' OR p->>'key'=ANY(seen) OR nullif(trim(p->>'label'),'') IS NULL OR length(p->>'label')>120 OR p->>'type' IS NULL OR p->>'type' NOT IN ('number','qualitative','text') OR jsonb_typeof(p->'required') IS DISTINCT FROM 'boolean' OR coalesce(length(p->>'unit'),0)>50 OR coalesce(length(p->>'reference'),0)>500 THEN RAISE EXCEPTION 'Revisa identificador, nombre, tipo y obligatoriedad de cada parámetro'; END IF;
  seen=array_append(seen,p->>'key');
  IF p->>'type'='qualitative' AND (jsonb_typeof(p->'choices') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'choices')=0 OR jsonb_array_length(p->'choices')>30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'choices') x WHERE jsonb_typeof(x)<>'string' OR nullif(trim(x#>>'{}'),'') IS NULL OR length(x#>>'{}')>100)) THEN RAISE EXCEPTION 'Define las opciones cualitativas del parámetro'; END IF;
  IF coalesce(p->>'low','')<>'' OR coalesce(p->>'high','')<>'' THEN
   IF p->>'type'<>'number' OR p->>'range_scope' IS DISTINCT FROM 'all_patients' THEN RAISE EXCEPTION 'Solo se calculan alertas para rangos numéricos validados de aplicación general'; END IF;
   IF (nullif(p->>'low','') IS NOT NULL AND p->>'low' !~ '^-?[0-9]+(\.[0-9]+)?$') OR (nullif(p->>'high','') IS NOT NULL AND p->>'high' !~ '^-?[0-9]+(\.[0-9]+)?$') OR (nullif(p->>'low','')::numeric>nullif(p->>'high','')::numeric) THEN RAISE EXCEPTION 'Revisa los límites de referencia'; END IF;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.validate_lab_schema(jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.configure_laboratory_test(p_test bigint,p_schema jsonb,p_version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF NOT private.lab_permission('validate') THEN RAISE EXCEPTION 'Se requiere autorización clínica para definir parámetros y referencias' USING ERRCODE='42501'; END IF;
 PERFORM private.validate_lab_schema(p_schema);
 SELECT xmin::text INTO v FROM public.lab_test_types WHERE id=p_test FOR UPDATE;
 IF NOT FOUND OR v IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'El examen cambió. Actualiza antes de guardar.'; END IF;
 UPDATE public.lab_test_types SET result_schema=p_schema,schema_validated_by=auth.uid(),schema_validated_at=now() WHERE id=p_test;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'validar_parametros_laboratorio','lab_test_types',p_test::text,jsonb_build_object('schema',p_schema));
END $$;

CREATE FUNCTION private.protect_laboratory_schema() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.result_schema<>'[]'::jsonb) OR (TG_OP='UPDATE' AND (NEW.result_schema IS DISTINCT FROM OLD.result_schema OR NEW.schema_validated_by IS DISTINCT FROM OLD.schema_validated_by OR NEW.schema_validated_at IS DISTINCT FROM OLD.schema_validated_at)) THEN
  IF NOT private.lab_permission('validate') THEN RAISE EXCEPTION 'Los parámetros y referencias requieren validación clínica' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_laboratory_schema() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER laboratory_schema_guard BEFORE INSERT OR UPDATE ON public.lab_test_types FOR EACH ROW EXECUTE FUNCTION private.protect_laboratory_schema();

CREATE FUNCTION private.lab_check_payload(p_schema jsonb,p_values jsonb,p_summary text,p_complete boolean) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p jsonb; v text; entry jsonb;
BEGIN
 IF p_summary IS NULL OR length(p_summary)>15000 OR jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR octet_length(p_values::text)>100000 THEN RAISE EXCEPTION 'Revisa el contenido de resultados'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_schema) s WHERE s->>'key'=k)) THEN RAISE EXCEPTION 'Los valores no corresponden a los parámetros del examen'; END IF;
 IF p_complete AND jsonb_array_length(p_schema)=0 AND nullif(trim(p_summary),'') IS NULL THEN RAISE EXCEPTION 'Completa el resultado descriptivo del examen'; END IF;
 IF p_complete AND nullif(trim(p_summary),'') IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_values) e WHERE nullif(trim(e.value->>'value'),'') IS NOT NULL) THEN RAISE EXCEPTION 'Completa al menos un resultado antes de enviar a validación'; END IF;
 FOR p IN SELECT value FROM jsonb_array_elements(p_schema) LOOP
  entry=p_values->(p->>'key');
  IF entry IS NOT NULL AND (jsonb_typeof(entry)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN ('value','observation')) OR (entry ? 'value' AND jsonb_typeof(entry->'value') NOT IN ('string','null')) OR (entry ? 'observation' AND jsonb_typeof(entry->'observation') NOT IN ('string','null'))) THEN RAISE EXCEPTION 'El formato de un resultado no es válido'; END IF;
  v=nullif(trim(entry->>'value'),'');
  IF coalesce(length(v),0)>3000 OR coalesce(length(entry->>'observation'),0)>2000 THEN RAISE EXCEPTION 'El valor u observación es demasiado extenso'; END IF;
  IF p_complete AND (p->>'required')::boolean AND v IS NULL THEN RAISE EXCEPTION 'Falta el resultado requerido: %',p->>'label'; END IF;
  IF v IS NOT NULL AND p->>'type'='number' AND v !~ '^-?[0-9]+(\.[0-9]+)?$' THEN RAISE EXCEPTION 'Escribe un valor numérico válido para %',p->>'label'; END IF;
  IF v IS NOT NULL AND p->>'type'='qualitative' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'choices') c WHERE c=v) THEN RAISE EXCEPTION 'Selecciona una opción válida para %',p->>'label'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.lab_check_payload(jsonb,jsonb,text,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.lab_render_summary(p_schema jsonb,p_values jsonb,p_summary text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT concat_ws(E'\n',nullif(trim(p_summary),''),(SELECT string_agg((p->>'label')||': '||coalesce(nullif(trim(p_values->(p->>'key')->>'value'),''),'No informado')||coalesce(' '||nullif(p->>'unit',''),'')||coalesce(' · Referencia: '||nullif(p->>'reference',''),'')||coalesce(' · Observación: '||nullif(p_values->(p->>'key')->>'observation',''),''),E'\n' ORDER BY n) FROM jsonb_array_elements(p_schema) WITH ORDINALITY x(p,n)))
$$;
REVOKE ALL ON FUNCTION private.lab_render_summary(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.lab_result_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),CASE WHEN TG_TABLE_NAME='lab_results' THEN 'resultado_laboratorio' ELSE 'borrador_laboratorio' END,'lab_orders',NEW.order_id::text,jsonb_build_object('previous',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,'current',to_jsonb(NEW)));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.lab_result_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER laboratory_result_audit AFTER INSERT OR UPDATE ON public.lab_results FOR EACH ROW EXECUTE FUNCTION private.lab_result_audit();
CREATE TRIGGER laboratory_draft_audit AFTER INSERT OR UPDATE ON public.lab_result_drafts FOR EACH ROW EXECUTE FUNCTION private.lab_result_audit();

CREATE FUNCTION public.start_laboratory_order(p_order uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.lab_orders; schema jsonb;
BEGIN
 IF NOT private.lab_permission('process') THEN RAISE EXCEPTION 'No tienes autorización para procesar órdenes' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.status='completado' THEN RAISE EXCEPTION 'La orden no está pendiente de procesamiento'; END IF;
 SELECT result_schema INTO schema FROM public.lab_test_types WHERE id=o.test_type_id;
 INSERT INTO public.lab_results(order_id,summary) VALUES(o.id,'') ON CONFLICT(order_id) DO NOTHING;
 INSERT INTO public.lab_result_drafts(id,order_id,draft_schema,prepared_by) SELECT id,order_id,schema,auth.uid() FROM public.lab_results WHERE order_id=o.id ON CONFLICT(order_id) DO NOTHING;
 UPDATE public.lab_orders SET status='en_proceso' WHERE id=o.id;
END $$;

CREATE FUNCTION public.save_laboratory_draft(p_order uuid,p_version integer,p_summary text,p_values jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_result_drafts;
BEGIN
 IF NOT private.lab_permission('process') THEN RAISE EXCEPTION 'No tienes autorización para registrar resultados' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR r.workflow_stage NOT IN ('draft','review','validated') THEN RAISE EXCEPTION 'Inicia el procesamiento o abre una corrección autorizada'; END IF;
 IF p_version IS DISTINCT FROM r.version THEN RAISE EXCEPTION 'Los resultados cambiaron. Actualiza antes de guardar.'; END IF;
 PERFORM private.lab_check_payload(r.draft_schema,p_values,p_summary,false);
 UPDATE public.lab_result_drafts SET draft_summary=p_summary,draft_values=p_values,workflow_stage='draft',draft_validated_by=NULL,draft_validated_at=NULL,prepared_by=auth.uid(),version=version+1,updated_at=now() WHERE id=r.id;
END $$;

CREATE FUNCTION public.submit_laboratory_validation(p_order uuid,p_version integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_result_drafts;
BEGIN
 IF NOT private.lab_permission('process') THEN RAISE EXCEPTION 'No tienes autorización para enviar resultados a validación' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR r.workflow_stage<>'draft' OR r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Actualiza el borrador antes de enviarlo'; END IF;
 PERFORM private.lab_check_payload(r.draft_schema,r.draft_values,r.draft_summary,true);
 UPDATE public.lab_result_drafts SET workflow_stage='review',version=version+1,updated_at=now() WHERE id=r.id;
END $$;

CREATE FUNCTION public.validate_laboratory_result(p_order uuid,p_version integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_result_drafts;
BEGIN
 IF NOT private.lab_permission('validate') THEN RAISE EXCEPTION 'Se requiere autorización clínica para validar resultados' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR r.workflow_stage<>'review' OR r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Los resultados deben estar completos y enviados a validación'; END IF;
 PERFORM private.lab_check_payload(r.draft_schema,r.draft_values,r.draft_summary,true);
 UPDATE public.lab_result_drafts SET workflow_stage='validated',draft_validated_by=auth.uid(),draft_validated_at=now(),version=version+1,updated_at=now() WHERE id=r.id;
END $$;

CREATE OR REPLACE FUNCTION public.publish_lab_result(p_order uuid,p_summary text,p_to_patient boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_result_drafts; published public.lab_results; expected text;
BEGIN
 IF NOT private.lab_permission('publish') THEN RAISE EXCEPTION 'Se requiere autorización clínica para publicar resultados' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR p_to_patient IS NULL THEN RAISE EXCEPTION 'No hay resultados para publicar'; END IF;
 SELECT * INTO published FROM public.lab_results WHERE order_id=p_order FOR UPDATE;
 IF r.workflow_stage='published' AND published.summary IS NOT DISTINCT FROM p_summary AND (NOT p_to_patient OR published.published_to_patient_at IS NOT NULL) THEN RETURN r.id; END IF;
 IF r.workflow_stage<>'validated' OR r.draft_validated_by IS NULL OR r.draft_validated_at IS NULL THEN RAISE EXCEPTION 'Los resultados deben estar validados antes de publicar'; END IF;
 PERFORM private.lab_check_payload(r.draft_schema,r.draft_values,r.draft_summary,true);
 expected=private.lab_render_summary(r.draft_schema,r.draft_values,r.draft_summary);
 IF p_summary IS DISTINCT FROM expected THEN RAISE EXCEPTION 'La publicación debe corresponder exactamente a los resultados validados'; END IF;
 UPDATE public.lab_results SET summary=expected,result_values=r.draft_values,parameter_schema=r.draft_schema,validated_by=r.draft_validated_by,validated_at=r.draft_validated_at,completed_at=now(),published_at=now(),published_by=auth.uid(),published_to_patient_at=CASE WHEN p_to_patient THEN now() END,published_revision=published_revision+1 WHERE id=r.id;
 UPDATE public.lab_result_drafts SET workflow_stage='published',version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.lab_orders SET status='completado' WHERE id=p_order;
 INSERT INTO public.lab_delivery_events(order_id,sender_id,delivery_type) VALUES(p_order,auth.uid(),CASE WHEN p_to_patient THEN 'a_paciente' ELSE 'a_recepcion' END);
 RETURN r.id;
END $$;

CREATE FUNCTION public.publish_laboratory_order(p_order uuid,p_version integer,p_to_patient boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_result_drafts;
BEGIN
 IF NOT private.lab_permission('publish') THEN RAISE EXCEPTION 'No tienes autorización para publicar resultados' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resultado inexistente'; END IF;
 IF r.workflow_stage='published' AND r.version=p_version+1 AND p_to_patient IS NOT NULL AND (NOT p_to_patient OR EXISTS(SELECT 1 FROM public.lab_results WHERE id=r.id AND published_to_patient_at IS NOT NULL)) THEN RETURN r.id; END IF;
 IF r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'La validación cambió. Actualiza antes de publicar.'; END IF;
 RETURN public.publish_lab_result(p_order,private.lab_render_summary(r.draft_schema,r.draft_values,r.draft_summary),p_to_patient);
END $$;

CREATE FUNCTION public.correct_laboratory_result(p_order uuid,p_version integer,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_result_drafts;
BEGIN
 IF NOT private.lab_permission('process') THEN RAISE EXCEPTION 'No tienes autorización para preparar correcciones' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_reason),'') IS NULL OR length(p_reason)>2000 THEN RAISE EXCEPTION 'Indica el motivo de la corrección'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_result_drafts WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR r.workflow_stage<>'published' OR r.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'Solo se corrige una versión publicada y actualizada'; END IF;
 UPDATE public.lab_result_drafts SET workflow_stage='draft',draft_validated_by=NULL,draft_validated_at=NULL,correction_reason=trim(p_reason),version=version+1,updated_at=now() WHERE id=r.id;
 UPDATE public.lab_orders SET status='en_proceso' WHERE id=p_order;
END $$;

CREATE OR REPLACE FUNCTION public.reception_release_lab(p_order uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.lab_results;
BEGIN
 IF NOT private.lab_permission('publish') THEN RAISE EXCEPTION 'La publicación al paciente requiere autorización de laboratorio' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 SELECT * INTO r FROM public.lab_results WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR r.published_at IS NULL OR r.validated_by IS NULL OR r.validated_at IS NULL THEN RAISE EXCEPTION 'El resultado no está validado y publicado'; END IF;
 IF r.published_to_patient_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.lab_results SET published_to_patient_at=now() WHERE id=r.id;
 UPDATE public.lab_result_drafts SET version=version+1 WHERE id=r.id;
 INSERT INTO public.lab_delivery_events(order_id,sender_id,delivery_type) VALUES(p_order,auth.uid(),'a_paciente');
END $$;

DROP POLICY labresult_read ON public.lab_results;
CREATE POLICY labresult_read ON public.lab_results FOR SELECT TO authenticated USING(private.lab_permission('any') OR (published_at IS NOT NULL AND validated_by IS NOT NULL AND validated_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.lab_orders o WHERE o.id=order_id AND (private.treats_patient(private.encounter_patient(o.encounter_id)) OR (published_to_patient_at IS NOT NULL AND private.my_patient(private.encounter_patient(o.encounter_id)))))));
DROP POLICY labfile_read ON public.lab_result_files;
CREATE POLICY labfile_read ON public.lab_result_files FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.lab_results r WHERE r.id=result_id AND (private.lab_permission('any') OR (r.published_at IS NOT NULL AND r.validated_by IS NOT NULL AND r.validated_at IS NOT NULL))));
CREATE POLICY laborder_laboratory_read ON public.lab_orders FOR SELECT TO authenticated USING(private.lab_permission('any'));

-- Drafts stay in their own protected extension, so existing iOS SELECT * remains safe.

REVOKE ALL ON FUNCTION public.my_laboratory_access(),public.authorize_laboratory_staff(uuid,boolean,boolean,boolean,boolean),public.configure_laboratory_test(bigint,jsonb,text),public.start_laboratory_order(uuid),public.save_laboratory_draft(uuid,integer,text,jsonb),public.submit_laboratory_validation(uuid,integer),public.validate_laboratory_result(uuid,integer),public.publish_laboratory_order(uuid,integer,boolean),public.correct_laboratory_result(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_laboratory_access(),public.authorize_laboratory_staff(uuid,boolean,boolean,boolean,boolean),public.configure_laboratory_test(bigint,jsonb,text),public.start_laboratory_order(uuid),public.save_laboratory_draft(uuid,integer,text,jsonb),public.submit_laboratory_validation(uuid,integer),public.validate_laboratory_result(uuid,integer),public.publish_laboratory_order(uuid,integer,boolean),public.correct_laboratory_result(uuid,integer,text) TO authenticated;
