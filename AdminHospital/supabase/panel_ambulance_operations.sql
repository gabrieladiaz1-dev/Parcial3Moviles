-- Reuse the shared transport tables; expand the former single-unit restriction.
ALTER TABLE public.ambulances DROP CONSTRAINT ambulances_id_check;
CREATE SEQUENCE public.ambulance_panel_id_seq AS smallint;
SELECT setval('public.ambulance_panel_id_seq',greatest(coalesce((SELECT max(id) FROM public.ambulances),0),1),(SELECT count(*)>0 FROM public.ambulances));
ALTER TABLE public.ambulances ALTER COLUMN id SET DEFAULT nextval('public.ambulance_panel_id_seq');
ALTER SEQUENCE public.ambulance_panel_id_seq OWNED BY public.ambulances.id;
ALTER TABLE public.ambulances ADD COLUMN plate text;
ALTER TABLE public.ambulances ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.ambulances ADD COLUMN operational_notes text;
CREATE UNIQUE INDEX ambulance_plate_unique ON public.ambulances(lower(plate)) WHERE plate IS NOT NULL;
ALTER TABLE public.staff ADD COLUMN ambulance_driver_authorized boolean NOT NULL DEFAULT false;
ALTER TABLE public.ambulance_requests ADD COLUMN destination text;
ALTER TABLE public.ambulance_requests ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgente'));
ALTER TABLE public.ambulance_requests ADD COLUMN request_key uuid;
ALTER TABLE public.ambulance_requests ADD COLUMN decision_reason text;
CREATE UNIQUE INDEX ambulance_request_retry ON public.ambulance_requests(requester_id,request_key) WHERE request_key IS NOT NULL;
ALTER TABLE public.ambulance_dispatches ADD COLUMN departed_at timestamptz;
ALTER TABLE public.ambulance_dispatches ADD COLUMN arrived_at timestamptz;
ALTER TABLE public.ambulance_dispatches ADD COLUMN controls_checked_at timestamptz;
ALTER TABLE public.ambulance_dispatches ADD COLUMN completed_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.ambulance_dispatches ADD COLUMN completion_notes text;
CREATE UNIQUE INDEX one_active_transport_per_driver ON public.ambulance_dispatches(assigned_staff_id) WHERE completed_at IS NULL AND assigned_staff_id IS NOT NULL;

CREATE FUNCTION private.panel_fleet_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'actualizar_ambulancia','ambulances',NEW.id::text,jsonb_build_object('previous',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,'current',to_jsonb(NEW)));
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.ambulance_status_history(ambulance_id,old_status,new_status,actor_id) VALUES(NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.status END,NEW.status,auth.uid());
  IF NEW.status='en_mantenimiento' THEN PERFORM private.emit_panel_notice('ambulancia','Ambulancia en mantenimiento','Revisa el estado operativo de la unidad '||NEW.code||'.','ambulances',NEW.id::text,'unit:'||NEW.id::text||':'||pg_current_xact_id()::text,true); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.panel_fleet_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER panel_fleet_audit AFTER INSERT OR UPDATE ON public.ambulances FOR EACH ROW EXECUTE FUNCTION private.panel_fleet_audit();

CREATE FUNCTION private.panel_transport_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.emergency_logs(request_id,event_type,description,actor_id) VALUES(NEW.id,NEW.status::text,NEW.decision_reason,auth.uid());
  IF NEW.status='pendiente' THEN PERFORM private.emit_panel_notice('ambulancia','Nueva solicitud de traslado','Hay un traslado pendiente de revisión y asignación.','ambulance_requests',NEW.id::text,'transport:'||NEW.id::text||':pending');
  ELSIF NEW.status IN ('finalizada','rechazada','cancelada') THEN PERFORM private.emit_panel_notice('ambulancia','Solicitud de traslado actualizada','Consulta el resultado y el historial del servicio.','ambulance_requests',NEW.id::text,'transport:'||NEW.id::text||':'||NEW.status::text); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.panel_transport_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER panel_transport_audit AFTER INSERT OR UPDATE OF status ON public.ambulance_requests FOR EACH ROW EXECUTE FUNCTION private.panel_transport_audit();

CREATE FUNCTION public.save_panel_ambulance(p_code text,p_plate text,p_status public.ambulance_state,p_active boolean,p_notes text DEFAULT NULL,p_id smallint DEFAULT NULL) RETURNS smallint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v smallint; a public.ambulances;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede registrar o editar unidades' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 IF nullif(trim(p_code),'') IS NULL OR length(p_code)>50 OR coalesce(length(p_plate),0)>30 OR coalesce(length(p_notes),0)>2000 OR p_status IS NULL OR p_status='en_servicio' OR p_active IS NULL THEN RAISE EXCEPTION 'Revisa código, placa y estado operativo'; END IF;
 IF (NOT p_active OR p_status='en_mantenimiento') AND nullif(trim(p_notes),'') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de mantenimiento o desactivación'; END IF;
 IF p_id IS NULL THEN INSERT INTO public.ambulances(code,plate,status,active,operational_notes) VALUES(trim(p_code),nullif(trim(p_plate),''),p_status,p_active,nullif(trim(p_notes),'')) RETURNING id INTO v;
 ELSE
  SELECT * INTO a FROM public.ambulances WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unidad inexistente'; END IF;
  IF a.status='en_servicio' OR EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE ambulance_id=p_id AND completed_at IS NULL) THEN RAISE EXCEPTION 'No se puede modificar una unidad con un servicio activo'; END IF;
  UPDATE public.ambulances SET code=trim(p_code),plate=nullif(trim(p_plate),''),status=p_status,active=p_active,operational_notes=nullif(trim(p_notes),'') WHERE id=p_id RETURNING id INTO v;
 END IF;
 RETURN v;
END $$;

CREATE FUNCTION public.authorize_panel_driver(p_staff uuid,p_authorized boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede autorizar conductores' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 IF p_authorized IS NULL THEN RAISE EXCEPTION 'Indica la autorización'; END IF;
 PERFORM 1 FROM public.staff s WHERE s.id=p_staff AND s.active AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=s.profile_id AND r.active AND r.role::text=s.category) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona personal activo con rol autorizado'; END IF;
 IF EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE assigned_staff_id=p_staff AND completed_at IS NULL) THEN RAISE EXCEPTION 'Este conductor tiene un servicio activo'; END IF;
 UPDATE public.staff SET ambulance_driver_authorized=p_authorized WHERE id=p_staff;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'autorizar_conductor','staff',p_staff::text,jsonb_build_object('authorized',p_authorized));
END $$;

CREATE FUNCTION public.request_medical_transport(p_patient uuid,p_contact text,p_phone text,p_origin text,p_destination text,p_reason text,p_priority text,p_key uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ambulance_requests; v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista') OR (private.has_role('doctor') AND private.treats_patient(p_patient))) THEN RAISE EXCEPTION 'No autorizado para solicitar este traslado' USING ERRCODE='42501'; END IF;
 IF private.has_role('doctor') AND NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN PERFORM private.native_doctor_id(); END IF;
 IF p_key IS NULL OR p_patient IS NULL OR nullif(trim(p_contact),'') IS NULL OR nullif(trim(p_phone),'') IS NULL OR nullif(trim(p_origin),'') IS NULL OR nullif(trim(p_destination),'') IS NULL OR nullif(trim(p_reason),'') IS NULL OR p_priority IS NULL OR p_priority NOT IN ('normal','urgente') OR length(p_contact)>200 OR length(p_phone)>50 OR length(p_origin)>1000 OR length(p_destination)>1000 OR length(p_reason)>4000 THEN RAISE EXCEPTION 'Completa paciente, contacto, origen, destino, motivo y prioridad'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=p_patient) THEN RAISE EXCEPTION 'El paciente debe tener un expediente válido'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 SELECT * INTO r FROM public.ambulance_requests WHERE requester_id=auth.uid() AND request_key=p_key;
 IF FOUND THEN
  IF r.patient_id IS DISTINCT FROM p_patient OR r.contact_name IS DISTINCT FROM trim(p_contact) OR r.contact_phone IS DISTINCT FROM trim(p_phone) OR r.pickup_location IS DISTINCT FROM trim(p_origin) OR r.destination IS DISTINCT FROM trim(p_destination) OR r.reason IS DISTINCT FROM trim(p_reason) OR r.priority IS DISTINCT FROM p_priority THEN RAISE EXCEPTION 'La solicitud cambió; actualiza antes de reenviar'; END IF;
  RETURN r.id;
 END IF;
 INSERT INTO public.ambulance_requests(patient_id,requester_id,contact_name,contact_phone,pickup_location,destination,reason,priority,request_key)
 VALUES(p_patient,auth.uid(),trim(p_contact),trim(p_phone),trim(p_origin),trim(p_destination),trim(p_reason),p_priority,p_key) RETURNING id INTO v;
 RETURN v;
END $$;

CREATE FUNCTION public.review_medical_transport(p_request uuid,p_action text,p_destination text DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ambulance_requests;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO r FROM public.ambulance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('pendiente','autorizada') THEN RAISE EXCEPTION 'La solicitud ya no está pendiente'; END IF;
 IF p_action='autorizar' THEN
  IF nullif(trim(coalesce(p_destination,r.destination)),'') IS NULL OR length(coalesce(p_destination,r.destination))>1000 THEN RAISE EXCEPTION 'Confirma el destino del traslado'; END IF;
  UPDATE public.ambulance_requests SET destination=trim(coalesce(p_destination,r.destination)),status='autorizada' WHERE id=r.id;
 ELSIF p_action IN ('rechazar','cancelar') AND nullif(trim(p_reason),'') IS NOT NULL AND length(p_reason)<=2000 THEN
  UPDATE public.ambulance_requests SET status=CASE p_action WHEN 'rechazar' THEN 'rechazada'::public.dispatch_state ELSE 'cancelada'::public.dispatch_state END,decision_reason=trim(p_reason) WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Indica una acción y el motivo correspondiente'; END IF;
END $$;

CREATE FUNCTION public.assign_medical_transport(p_request uuid,p_ambulance smallint,p_staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ambulance_requests; a public.ambulances; v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO r FROM public.ambulance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 SELECT id INTO v FROM public.ambulance_dispatches WHERE request_id=p_request AND ambulance_id=p_ambulance AND assigned_staff_id=p_staff AND completed_at IS NULL;
 IF v IS NOT NULL AND r.status='despachada' THEN RETURN v; END IF;
 IF r.status NOT IN ('pendiente','autorizada') OR nullif(trim(r.destination),'') IS NULL THEN RAISE EXCEPTION 'La solicitud debe estar pendiente y tener destino confirmado'; END IF;
 IF r.patient_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=r.patient_id) THEN RAISE EXCEPTION 'Falta un expediente válido'; END IF;
 SELECT * INTO a FROM public.ambulances WHERE id=p_ambulance FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR a.status<>'disponible' OR EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE ambulance_id=p_ambulance AND completed_at IS NULL) THEN RAISE EXCEPTION 'La ambulancia ya no está disponible'; END IF;
 PERFORM 1 FROM public.staff s WHERE s.id=p_staff AND s.active AND s.ambulance_driver_authorized AND EXISTS(SELECT 1 FROM public.user_roles x WHERE x.user_id=s.profile_id AND x.active AND x.role::text=s.category) FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE assigned_staff_id=p_staff AND completed_at IS NULL) THEN RAISE EXCEPTION 'Selecciona un conductor autorizado y disponible'; END IF;
 INSERT INTO public.ambulance_dispatches(request_id,ambulance_id,assigned_staff_id) VALUES(r.id,a.id,p_staff) RETURNING id INTO v;
 UPDATE public.ambulances SET status='en_servicio' WHERE id=a.id;
 UPDATE public.ambulance_requests SET status='despachada' WHERE id=r.id;
 RETURN v;
END $$;

-- Preserve the legacy signature, now selecting a real available unit.
CREATE OR REPLACE FUNCTION public.dispatch_ambulance(p_request uuid,p_staff uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v smallint;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT ambulance_id INTO v FROM public.ambulance_dispatches WHERE request_id=p_request AND completed_at IS NULL;
 IF v IS NULL THEN SELECT id INTO v FROM public.ambulances WHERE active AND status='disponible' ORDER BY id LIMIT 1; END IF;
 RETURN public.assign_medical_transport(p_request,v,p_staff);
END $$;

CREATE FUNCTION private.transport_operator(p_dispatch uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND (private.has_role('admin') OR private.has_role('recepcionista') OR EXISTS(SELECT 1 FROM public.ambulance_dispatches d JOIN public.staff s ON s.id=d.assigned_staff_id JOIN public.user_roles r ON r.user_id=s.profile_id AND r.active AND r.role::text=s.category WHERE d.id=p_dispatch AND s.profile_id=auth.uid() AND s.active AND s.ambulance_driver_authorized))
$$;
REVOKE ALL ON FUNCTION private.transport_operator(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.progress_medical_transport(p_dispatch uuid,p_event text,p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.ambulance_dispatches;
BEGIN
 IF NOT private.transport_operator(p_dispatch) THEN RAISE EXCEPTION 'No autorizado para operar este servicio' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO d FROM public.ambulance_dispatches WHERE id=p_dispatch FOR UPDATE;
 IF NOT FOUND OR d.completed_at IS NOT NULL THEN RAISE EXCEPTION 'El servicio no está activo'; END IF;
 IF coalesce(length(p_notes),0)>2000 THEN RAISE EXCEPTION 'Las notas son demasiado extensas'; END IF;
 IF p_event='salida' THEN
  IF d.departed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.ambulance_dispatches SET departed_at=now() WHERE id=d.id;
 ELSIF p_event='llegada' THEN
  IF d.departed_at IS NULL THEN RAISE EXCEPTION 'Registra primero la salida'; END IF;
  IF d.arrived_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.ambulance_dispatches SET arrived_at=now() WHERE id=d.id;
 ELSE RAISE EXCEPTION 'Selecciona salida o llegada'; END IF;
 INSERT INTO public.emergency_logs(request_id,event_type,description,actor_id) VALUES(d.request_id,p_event,nullif(trim(p_notes),''),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.complete_dispatch(p_dispatch uuid,p_maintenance boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.ambulance_dispatches;
BEGIN
 IF NOT private.transport_operator(p_dispatch) THEN RAISE EXCEPTION 'No autorizado para finalizar este servicio' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO d FROM public.ambulance_dispatches WHERE id=p_dispatch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Servicio inexistente'; END IF;
 IF d.completed_at IS NOT NULL THEN RETURN; END IF;
 IF d.arrived_at IS NULL OR d.controls_checked_at IS NULL OR p_maintenance IS NULL THEN RAISE EXCEPTION 'Registra llegada y confirma los controles operativos antes de finalizar'; END IF;
 UPDATE public.ambulance_dispatches SET completed_at=now(),completed_by=auth.uid() WHERE id=d.id;
 UPDATE public.ambulance_requests SET status='finalizada' WHERE id=d.request_id;
 UPDATE public.ambulances SET status=CASE WHEN p_maintenance THEN 'en_mantenimiento'::public.ambulance_state ELSE 'disponible'::public.ambulance_state END,operational_notes=CASE WHEN p_maintenance THEN d.completion_notes ELSE operational_notes END WHERE id=d.ambulance_id;
END $$;

CREATE FUNCTION public.finish_medical_transport(p_dispatch uuid,p_controls_confirmed boolean,p_maintenance boolean,p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.ambulance_dispatches;
BEGIN
 IF NOT private.transport_operator(p_dispatch) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_controls_confirmed IS DISTINCT FROM true OR p_maintenance IS NULL OR coalesce(length(p_notes),0)>2000 OR (p_maintenance AND nullif(trim(p_notes),'') IS NULL) THEN RAISE EXCEPTION 'Confirma los controles y el motivo si requiere mantenimiento'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO d FROM public.ambulance_dispatches WHERE id=p_dispatch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Servicio inexistente'; END IF;
 IF d.completed_at IS NOT NULL THEN RETURN; END IF;
 IF d.arrived_at IS NULL THEN RAISE EXCEPTION 'Registra primero la llegada'; END IF;
 UPDATE public.ambulance_dispatches SET controls_checked_at=now(),completion_notes=nullif(trim(p_notes),'') WHERE id=d.id;
 PERFORM public.complete_dispatch(d.id,p_maintenance);
END $$;

CREATE FUNCTION public.panel_transport_data(p_offset integer DEFAULT 0,p_status text DEFAULT NULL,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR (p_status IS NOT NULL AND p_status NOT IN ('pendiente','autorizada','despachada','finalizada','rechazada','cancelada')) THEN RAISE EXCEPTION 'Filtro inválido'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.requested_at DESC,x.id),'[]') INTO result FROM (
 SELECT r.*,concat_ws(' ',p.first_name,p.last_name) patient_name,(SELECT record_code FROM public.medical_records WHERE patient_id=r.patient_id) record_number,concat_ws(' ',u.first_name,u.last_name) requester_name,
 (SELECT to_jsonb(d)||jsonb_build_object('unit_code',a.code,'driver_name',concat_ws(' ',dp.first_name,dp.last_name)) FROM public.ambulance_dispatches d JOIN public.ambulances a ON a.id=d.ambulance_id LEFT JOIN public.staff s ON s.id=d.assigned_staff_id LEFT JOIN public.profiles dp ON dp.id=s.profile_id WHERE d.request_id=r.id) dispatch,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('event',l.event_type,'description',l.description,'at',l.occurred_at,'actor',concat_ws(' ',lp.first_name,lp.last_name)) ORDER BY l.occurred_at,l.id),'[]') FROM public.emergency_logs l LEFT JOIN public.profiles lp ON lp.id=l.actor_id WHERE l.request_id=r.id) history
 FROM public.ambulance_requests r LEFT JOIN public.patients p ON p.id=r.patient_id LEFT JOIN public.profiles u ON u.id=r.requester_id
 WHERE (p_request IS NULL OR r.id=p_request) AND (p_request IS NOT NULL OR p_status IS NULL OR r.status::text=p_status)
 ORDER BY r.requested_at DESC,r.id LIMIT 25 OFFSET CASE WHEN p_request IS NULL THEN p_offset ELSE 0 END)x;
 RETURN jsonb_build_object('is_admin',private.has_role('admin'),'items',result,
 'total',(SELECT count(*) FROM public.ambulance_requests WHERE (p_request IS NULL OR id=p_request) AND (p_request IS NOT NULL OR p_status IS NULL OR status::text=p_status)),
 'units',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.code),'[]') FROM public.ambulances a),
 'crew',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name),'[]') FROM (SELECT s.id,s.employee_code,s.category,s.active,s.ambulance_driver_authorized,concat_ws(' ',p.first_name,p.last_name) name,EXISTS(SELECT 1 FROM public.ambulance_dispatches d WHERE d.assigned_staff_id=s.id AND d.completed_at IS NULL) busy FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id WHERE EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=s.profile_id AND r.active AND r.role::text=s.category))x),
 'unit_history',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.changed_at DESC),'[]') FROM (SELECT h.*,a.code FROM public.ambulance_status_history h JOIN public.ambulances a ON a.id=h.ambulance_id ORDER BY h.changed_at DESC,h.id DESC LIMIT 50)x));
END $$;

REVOKE ALL ON FUNCTION public.save_panel_ambulance(text,text,public.ambulance_state,boolean,text,smallint),public.authorize_panel_driver(uuid,boolean),public.request_medical_transport(uuid,text,text,text,text,text,text,uuid),public.review_medical_transport(uuid,text,text,text),public.assign_medical_transport(uuid,smallint,uuid),public.progress_medical_transport(uuid,text,text),public.finish_medical_transport(uuid,boolean,boolean,text),public.panel_transport_data(integer,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_panel_ambulance(text,text,public.ambulance_state,boolean,text,smallint),public.authorize_panel_driver(uuid,boolean),public.request_medical_transport(uuid,text,text,text,text,text,text,uuid),public.review_medical_transport(uuid,text,text,text),public.assign_medical_transport(uuid,smallint,uuid),public.progress_medical_transport(uuid,text,text),public.finish_medical_transport(uuid,boolean,boolean,text),public.panel_transport_data(integer,text,uuid) TO authenticated;
