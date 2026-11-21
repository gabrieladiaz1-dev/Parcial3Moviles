CREATE FUNCTION public.laboratory_panel(p_offset integer DEFAULT 0,p_status text DEFAULT NULL,p_query text DEFAULT '',p_from date DEFAULT NULL,p_until date DEFAULT NULL,p_test bigint DEFAULT NULL,p_doctor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rows jsonb; total bigint;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.lab_permission('any')) THEN RAISE EXCEPTION 'No autorizado para consultar laboratorio' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR length(p_query)>150 OR (p_status IS NOT NULL AND p_status NOT IN ('pendiente','en_proceso','completado')) OR p_from>p_until THEN RAISE EXCEPTION 'Revisa los filtros del laboratorio'; END IF;
 WITH permitted AS MATERIALIZED (
  SELECT o.id,o.order_code,o.encounter_id,o.test_type_id,t.name test_name,o.status::text status,o.ordered_at,
   concat_ws(' ',p.first_name,p.last_name) patient_name,m.record_code,concat_ws(' ',dp.first_name,dp.last_name) doctor_name,
   d.workflow_stage,d.version,r.published_at,r.published_to_patient_at,r.published_revision
  FROM public.lab_orders o JOIN public.lab_test_types t ON t.id=o.test_type_id JOIN public.clinical_encounters e ON e.id=o.encounter_id
  JOIN public.medical_records m ON m.id=e.record_id JOIN public.patients p ON p.id=m.patient_id
  JOIN public.staff s ON s.id=e.doctor_id JOIN public.profiles dp ON dp.id=s.profile_id
  LEFT JOIN public.lab_results r ON r.order_id=o.id LEFT JOIN public.lab_result_drafts d ON d.order_id=o.id
  WHERE (p_status IS NULL OR o.status::text=p_status) AND (p_test IS NULL OR o.test_type_id=p_test) AND (p_doctor IS NULL OR e.doctor_id=p_doctor)
   AND (p_from IS NULL OR o.ordered_at>=p_from::timestamp AT TIME ZONE 'America/El_Salvador')
   AND (p_until IS NULL OR o.ordered_at<(p_until+1)::timestamp AT TIME ZONE 'America/El_Salvador')
   AND (nullif(trim(p_query),'') IS NULL OR concat_ws(' ',p.first_name,p.last_name,m.record_code,o.order_code) ILIKE '%'||trim(p_query)||'%')
 ), page AS (SELECT * FROM permitted ORDER BY CASE status WHEN 'pendiente' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END,ordered_at,id LIMIT 25 OFFSET p_offset)
 SELECT (SELECT count(*) FROM permitted),coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY CASE status WHEN 'pendiente' THEN 0 WHEN 'en_proceso' THEN 1 ELSE 2 END,ordered_at,id) FROM page p),'[]') INTO total,rows;
 RETURN jsonb_build_object('access',public.my_laboratory_access(),'items',rows,'total',total,'has_more',p_offset+25<total,
 'counts',jsonb_build_object('pendiente',(SELECT count(*) FROM public.lab_orders WHERE status='pendiente'),'en_proceso',(SELECT count(*) FROM public.lab_orders WHERE status='en_proceso'),'completado',(SELECT count(*) FROM public.lab_orders WHERE status='completado')),
 'tests',(SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('version',t.xmin::text) ORDER BY t.name),'[]') FROM public.lab_test_types t),
 'doctors',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name),'[]') FROM (SELECT s.id,concat_ws(' ',p.first_name,p.last_name) name FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id WHERE s.category='doctor')x),
 'staff',CASE WHEN private.has_role('admin') THEN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name),'[]') FROM (SELECT s.id,s.active,s.employee_code,s.category,concat_ws(' ',p.first_name,p.last_name) name,coalesce(a.can_process,false) can_process,coalesce(a.can_validate,false) can_validate,coalesce(a.can_publish,false) can_publish,coalesce(a.active,false) laboratory_active FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id LEFT JOIN public.laboratory_authorizations a ON a.staff_id=s.id WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=s.profile_id AND r.active AND r.role::text=s.category))x) ELSE '[]'::jsonb END);
END $$;

CREATE FUNCTION public.laboratory_order_detail(p_order uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; clinical boolean=private.lab_permission('any');
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR clinical) THEN RAISE EXCEPTION 'No autorizado para consultar esta orden' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(o)||jsonb_build_object('patient_name',concat_ws(' ',p.first_name,p.last_name),'record_code',m.record_code,
 'doctor_name',concat_ws(' ',dp.first_name,dp.last_name),'test_name',t.name,'encounter_started_at',e.started_at,
 'draft',CASE WHEN clinical THEN to_jsonb(d) ELSE jsonb_build_object('workflow_stage',d.workflow_stage,'version',d.version,'draft_validated_at',d.draft_validated_at) END,
 'result',CASE WHEN clinical THEN to_jsonb(r) ELSE jsonb_build_object('published_at',r.published_at,'validated_at',r.validated_at,'published_to_patient_at',r.published_to_patient_at,'published_revision',r.published_revision) END,
 'validator_name',(SELECT concat_ws(' ',first_name,last_name) FROM public.profiles WHERE id=coalesce(d.draft_validated_by,r.validated_by)),
 'publisher_name',(SELECT concat_ws(' ',first_name,last_name) FROM public.profiles WHERE id=r.published_by),
 'consultation_orders',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'order_code',x.order_code,'test_name',tt.name,'status',x.status) ORDER BY x.ordered_at,x.id),'[]') FROM public.lab_orders x JOIN public.lab_test_types tt ON tt.id=x.test_type_id WHERE x.encounter_id=o.encounter_id),
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('action',h.action,'at',h.occurred_at,'actor',concat_ws(' ',hp.first_name,hp.last_name),'stage',h.metadata->'current'->>'workflow_stage','revision',h.metadata->'current'->>'published_revision','reason',h.metadata->'current'->>'correction_reason','summary',CASE WHEN clinical AND h.action='resultado_laboratorio' AND h.metadata->'current'->>'published_at' IS NOT NULL THEN h.metadata->'current'->>'summary' END) ORDER BY h.occurred_at,h.id),'[]') FROM public.audit_logs h LEFT JOIN public.profiles hp ON hp.id=h.actor_id WHERE h.entity_type='lab_orders' AND h.entity_id=o.id::text))
 INTO result FROM public.lab_orders o JOIN public.lab_test_types t ON t.id=o.test_type_id JOIN public.clinical_encounters e ON e.id=o.encounter_id
 JOIN public.medical_records m ON m.id=e.record_id JOIN public.patients p ON p.id=m.patient_id
 JOIN public.staff s ON s.id=e.doctor_id JOIN public.profiles dp ON dp.id=s.profile_id
 LEFT JOIN public.lab_results r ON r.order_id=o.id LEFT JOIN public.lab_result_drafts d ON d.order_id=o.id WHERE o.id=p_order;
 IF result IS NULL THEN RAISE EXCEPTION 'La orden no está disponible'; END IF;
 RETURN result||jsonb_build_object('access',public.my_laboratory_access());
END $$;
REVOKE ALL ON FUNCTION public.laboratory_panel(integer,text,text,date,date,bigint,uuid),public.laboratory_order_detail(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.laboratory_panel(integer,text,text,date,date,bigint,uuid),public.laboratory_order_detail(uuid) TO authenticated;

-- Preserve both native doctor RPC signatures and JSON keys, excluding drafts from their privileged joins.
DO $$
DECLARE f record; source text; changed text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('doctor_native_workspace','doctor_native_patient_labs') LOOP
  source=pg_get_functiondef(f.oid);
  changed=replace(source,'LEFT JOIN public.lab_results r ON r.order_id=o.id','LEFT JOIN public.lab_results r ON r.order_id=o.id AND r.published_at IS NOT NULL AND r.validated_at IS NOT NULL AND r.validated_by IS NOT NULL');
  changed=replace(changed,'LEFT JOIN public.lab_results lr ON lr.order_id=o.id','LEFT JOIN public.lab_results lr ON lr.order_id=o.id AND lr.published_at IS NOT NULL AND lr.validated_at IS NOT NULL AND lr.validated_by IS NOT NULL');
  IF changed=source THEN RAISE EXCEPTION 'Inspect the native lab join before deploying: %',f.proname; END IF;
  EXECUTE changed;
 END LOOP;
END $$;

ALTER TABLE public.panel_preferences ADD COLUMN laboratory boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.my_panel_preferences(p_values jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista') OR private.lab_permission('any')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_values IS NOT NULL THEN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('attention','admissions','ambulance','laboratory','poll_seconds')) THEN RAISE EXCEPTION 'Preferencias inválidas'; END IF;
  INSERT INTO public.panel_preferences(user_id,attention,admissions,ambulance,laboratory,poll_seconds)
  VALUES(auth.uid(),(p_values->>'attention')::boolean,(p_values->>'admissions')::boolean,(p_values->>'ambulance')::boolean,coalesce((p_values->>'laboratory')::boolean,(SELECT laboratory FROM public.panel_preferences WHERE user_id=auth.uid()),true),(p_values->>'poll_seconds')::integer)
  ON CONFLICT(user_id) DO UPDATE SET attention=excluded.attention,admissions=excluded.admissions,ambulance=excluded.ambulance,laboratory=excluded.laboratory,poll_seconds=excluded.poll_seconds;
 END IF;
 RETURN coalesce((SELECT to_jsonb(p)-'user_id' FROM public.panel_preferences p WHERE user_id=auth.uid()),'{"attention":true,"admissions":true,"ambulance":true,"laboratory":true,"poll_seconds":60}'::jsonb);
END $$;
-- Authorized laboratory staff need their own profile/menu and own notifications, not reception privileges.
DO $$
DECLARE f record; source text; changed text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('my_panel_profile','save_my_panel_profile','my_panel_notifications','read_panel_notification','panel_institution') LOOP
  source=pg_get_functiondef(f.oid);
  changed=replace(source,'NOT(private.has_role(''admin'') OR private.has_role(''recepcionista''))','NOT(private.has_role(''admin'') OR private.has_role(''recepcionista'') OR private.lab_permission(''any''))');
  IF changed=source THEN RAISE EXCEPTION 'Inspect panel authorization before deployment: %',f.proname; END IF;
  EXECUTE changed;
 END LOOP;
END $$;
CREATE POLICY panel_preferences_laboratory_read ON public.panel_preferences FOR SELECT TO authenticated USING(user_id=auth.uid() AND private.lab_permission('any'));

CREATE FUNCTION private.laboratory_notifications() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE patient_user uuid; doctor_user uuid; revision integer;
BEGIN
 IF TG_TABLE_NAME='lab_orders' THEN
  INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key)
  SELECT DISTINCT s.profile_id,'Nueva orden de laboratorio','Hay un examen pendiente de procesamiento.','laboratorio','lab_orders',NEW.id::text,'lab:'||NEW.id::text||':new'
  FROM public.laboratory_authorizations a JOIN public.staff s ON s.id=a.staff_id LEFT JOIN public.panel_preferences pref ON pref.user_id=s.profile_id
  WHERE a.active AND s.active AND (a.can_process OR a.can_validate OR a.can_publish) AND coalesce(pref.laboratory,true) AND s.profile_id IS DISTINCT FROM auth.uid()
  AND EXISTS(SELECT 1 FROM public.user_roles x WHERE x.user_id=s.profile_id AND x.active AND x.role::text=s.category)
  ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 ELSE
  IF NEW.published_at IS NULL OR NEW.validated_by IS NULL OR NEW.validated_at IS NULL THEN RETURN NEW; END IF;
  revision=NEW.published_revision;
  SELECT s.profile_id,p.profile_id INTO doctor_user,patient_user FROM public.lab_orders o JOIN public.clinical_encounters e ON e.id=o.encounter_id JOIN public.staff s ON s.id=e.doctor_id JOIN public.medical_records m ON m.id=e.record_id JOIN public.patients p ON p.id=m.patient_id WHERE o.id=NEW.order_id;
  IF TG_OP='INSERT' OR NEW.published_revision IS DISTINCT FROM OLD.published_revision THEN
   INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key)
   SELECT doctor_user,'Resultados de laboratorio disponibles','Una orden tiene resultados validados y publicados.','laboratorio','lab_orders',NEW.order_id::text,'lab:'||NEW.order_id::text||':'||revision||':doctor'
   WHERE doctor_user IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=doctor_user AND role='doctor' AND active)
   ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
  IF NEW.published_to_patient_at IS NOT NULL AND (TG_OP='INSERT' OR NEW.published_revision IS DISTINCT FROM OLD.published_revision OR OLD.published_to_patient_at IS NULL) THEN
   INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key)
   SELECT patient_user,'Resultados de laboratorio disponibles','Ya puedes consultar los resultados autorizados en Laboratorios.','laboratorio','lab_orders',NEW.order_id::text,'lab:'||NEW.order_id::text||':'||revision||':patient'
   WHERE patient_user IS NOT NULL AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=patient_user AND role='paciente' AND active)
   ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.laboratory_notifications() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER laboratory_new_order_notice AFTER INSERT ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION private.laboratory_notifications();
CREATE TRIGGER laboratory_published_notice AFTER INSERT OR UPDATE ON public.lab_results FOR EACH ROW EXECUTE FUNCTION private.laboratory_notifications();
