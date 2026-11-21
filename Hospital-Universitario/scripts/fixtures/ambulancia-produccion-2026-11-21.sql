-- Copia de SOLO LECTURA del módulo de ambulancia desplegado en Hospital Móviles (consultado el 21 nov 2026 con
-- pg_get_functiondef, information_schema, pg_indexes y pg_policies). Sirve para probar supabase/ambulancia-paciente.sql
-- en un PostgreSQL desechable (scripts/test-ambulance-sql.mjs). No contiene datos de pacientes ni secretos.
-- Simplificaciones explícitas: auth.uid() lee request.jwt.claim.sub; private.treats_patient es un stub (false) porque las
-- pruebas no cubren solicitudes de médicos; las tablas auxiliares solo tienen las columnas que usan las funciones.
CREATE SCHEMA private; CREATE SCHEMA auth;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth, private TO authenticated;
GRANT USAGE ON SCHEMA public, auth TO anon;
CREATE PUBLICATION supabase_realtime;

CREATE TYPE hospital_role AS ENUM ('admin','doctor','recepcionista','enfermera','paciente');
CREATE TYPE ambulance_state AS ENUM ('disponible','en_servicio','en_mantenimiento');
CREATE TYPE dispatch_state AS ENUM ('pendiente','autorizada','despachada','finalizada','rechazada','cancelada');

CREATE TABLE profiles(id uuid PRIMARY KEY, first_name text, last_name text, phone text);
CREATE TABLE user_roles(user_id uuid REFERENCES profiles(id), role hospital_role, active boolean NOT NULL DEFAULT true);
CREATE TABLE patients(id uuid PRIMARY KEY, profile_id uuid REFERENCES profiles(id), first_name text, last_name text);
CREATE TABLE medical_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patients(id), record_code text);
CREATE TABLE staff(id uuid PRIMARY KEY, profile_id uuid REFERENCES profiles(id));
CREATE TABLE panel_preferences(user_id uuid PRIMARY KEY, attention boolean NOT NULL DEFAULT true, admissions boolean NOT NULL DEFAULT true,
  ambulance boolean NOT NULL DEFAULT true, laboratory boolean NOT NULL DEFAULT true, poll_seconds integer NOT NULL DEFAULT 60);
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES profiles(id), title text NOT NULL,
  body text NOT NULL, kind text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), entity_type text, entity_id text, event_key text);
CREATE UNIQUE INDEX notification_event_once ON notifications(recipient_id, event_key) WHERE event_key IS NOT NULL;
CREATE TABLE audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid, action text, entity_type text, entity_id text,
  metadata jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE emergency_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, request_id uuid NOT NULL, event_type text NOT NULL,
  description text, actor_id uuid, occurred_at timestamptz NOT NULL DEFAULT now());

CREATE SEQUENCE ambulance_panel_id_seq AS smallint;
CREATE TABLE ambulances(id smallint PRIMARY KEY DEFAULT nextval('ambulance_panel_id_seq'::regclass), code text NOT NULL UNIQUE,
  status ambulance_state NOT NULL DEFAULT 'disponible'::ambulance_state, plate text, active boolean NOT NULL DEFAULT true, operational_notes text);
CREATE UNIQUE INDEX ambulance_plate_unique ON ambulances USING btree (lower(plate)) WHERE (plate IS NOT NULL);
CREATE TABLE ambulance_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patients(id), requester_id uuid REFERENCES profiles(id),
  contact_name text NOT NULL, contact_phone text NOT NULL, pickup_location text NOT NULL, reason text NOT NULL,
  status dispatch_state NOT NULL DEFAULT 'pendiente'::dispatch_state, requested_at timestamptz NOT NULL DEFAULT now(), destination text,
  priority text NOT NULL DEFAULT 'normal'::text CHECK ((priority = ANY (ARRAY['normal'::text, 'urgente'::text]))), request_key uuid, decision_reason text);
CREATE INDEX ambulance_requests_status_idx ON ambulance_requests USING btree (status, requested_at);
CREATE UNIQUE INDEX ambulance_request_retry ON ambulance_requests USING btree (requester_id, request_key) WHERE (request_key IS NOT NULL);
CREATE TABLE ambulance_dispatches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE REFERENCES ambulance_requests(id),
  ambulance_id smallint NOT NULL REFERENCES ambulances(id), assigned_staff_id uuid REFERENCES staff(id), dispatched_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz, departed_at timestamptz, arrived_at timestamptz, controls_checked_at timestamptz, completed_by uuid REFERENCES profiles(id), completion_notes text);
CREATE UNIQUE INDEX only_one_active_dispatch ON ambulance_dispatches USING btree (ambulance_id) WHERE (completed_at IS NULL);
CREATE UNIQUE INDEX one_active_transport_per_driver ON ambulance_dispatches USING btree (assigned_staff_id) WHERE ((completed_at IS NULL) AND (assigned_staff_id IS NOT NULL));
CREATE TABLE ambulance_status_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ambulance_id smallint NOT NULL REFERENCES ambulances(id),
  old_status ambulance_state, new_status ambulance_state NOT NULL, actor_id uuid REFERENCES profiles(id), changed_at timestamptz NOT NULL DEFAULT now());

-- Funciones auxiliares (definición de producción).
CREATE OR REPLACE FUNCTION private.has_role(p_role hospital_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role=p_role AND active) $function$;
CREATE OR REPLACE FUNCTION private.my_patient(p_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT EXISTS(SELECT 1 FROM public.patients WHERE id=p_id AND profile_id=(SELECT auth.uid())) $function$;
CREATE OR REPLACE FUNCTION private.treats_patient(p_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT false $function$; -- stub de prueba (ver cabecera)
CREATE OR REPLACE FUNCTION private.transport_operator(p_dispatch uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT auth.uid() IS NOT NULL AND private.has_role('admin')
$function$;
CREATE OR REPLACE FUNCTION private.emit_panel_notice(p_kind text, p_title text, p_body text, p_entity text, p_id text, p_key text, p_admin_only boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key)
 SELECT DISTINCT r.user_id,p_title,p_body,p_kind,p_entity,p_id,p_key FROM public.user_roles r
 LEFT JOIN public.panel_preferences pref ON pref.user_id=r.user_id
 WHERE r.active AND (r.role='admin' OR (NOT p_admin_only AND r.role='recepcionista'))
 AND r.user_id IS DISTINCT FROM auth.uid()
 AND CASE p_kind WHEN 'atencion' THEN coalesce(pref.attention,true) WHEN 'hospitalizacion' THEN coalesce(pref.admissions,true) WHEN 'ambulancia' THEN coalesce(pref.ambulance,true) ELSE false END
 ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
END $function$;
CREATE OR REPLACE FUNCTION private.panel_transport_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.emergency_logs(request_id,event_type,description,actor_id) VALUES(NEW.id,NEW.status::text,NEW.decision_reason,auth.uid());
  IF NEW.status='pendiente' THEN PERFORM private.emit_panel_notice('ambulancia','Nueva solicitud de traslado','Hay un traslado pendiente de revisión y asignación.','ambulance_requests',NEW.id::text,'transport:'||NEW.id::text||':pending');
  ELSIF NEW.status IN ('finalizada','rechazada','cancelada') THEN PERFORM private.emit_panel_notice('ambulancia','Solicitud de traslado actualizada','Consulta el resultado y el historial del servicio.','ambulance_requests',NEW.id::text,'transport:'||NEW.id::text||':'||NEW.status::text); END IF;
 END IF;
 RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION private.panel_fleet_audit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'actualizar_ambulancia','ambulances',NEW.id::text,jsonb_build_object('previous',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,'current',to_jsonb(NEW)));
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.ambulance_status_history(ambulance_id,old_status,new_status,actor_id) VALUES(NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.status END,NEW.status,auth.uid());
  IF NEW.status='en_mantenimiento' THEN PERFORM private.emit_panel_notice('ambulancia','Ambulancia en mantenimiento','Revisa el estado operativo de la unidad '||NEW.code||'.','ambulances',NEW.id::text,'unit:'||NEW.id::text||':'||pg_current_xact_id()::text,true); END IF;
 END IF;
 RETURN NEW;
END $function$;
CREATE TRIGGER panel_fleet_audit AFTER INSERT OR UPDATE ON public.ambulances FOR EACH ROW EXECUTE FUNCTION private.panel_fleet_audit();
CREATE TRIGGER panel_transport_audit AFTER INSERT OR UPDATE OF status ON public.ambulance_requests FOR EACH ROW EXECUTE FUNCTION private.panel_transport_audit();

-- RPC administrativas (definición de producción).
CREATE OR REPLACE FUNCTION public.assign_medical_transport(p_request uuid, p_ambulance smallint, p_staff uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r public.ambulance_requests; a public.ambulances; v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO r FROM public.ambulance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 SELECT id INTO v FROM public.ambulance_dispatches WHERE request_id=p_request AND ambulance_id=p_ambulance AND assigned_staff_id IS NULL AND completed_at IS NULL;
 IF v IS NOT NULL AND r.status='despachada' THEN RETURN v; END IF;
 IF r.status NOT IN ('pendiente','autorizada') OR nullif(trim(r.destination),'') IS NULL THEN RAISE EXCEPTION 'La solicitud debe estar pendiente y tener destino confirmado'; END IF;
 IF r.patient_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=r.patient_id) THEN RAISE EXCEPTION 'Falta un expediente válido'; END IF;
 SELECT * INTO a FROM public.ambulances WHERE id=p_ambulance FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR a.status<>'disponible' OR EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE ambulance_id=p_ambulance AND completed_at IS NULL) THEN RAISE EXCEPTION 'La ambulancia ya no está disponible'; END IF;
 IF p_staff IS NOT NULL THEN RAISE EXCEPTION 'La asignacion de personal no forma parte de este proceso'; END IF;
 INSERT INTO public.ambulance_dispatches(request_id,ambulance_id,assigned_staff_id) VALUES(r.id,a.id,p_staff) RETURNING id INTO v;
 UPDATE public.ambulances SET status='en_servicio' WHERE id=a.id;
 UPDATE public.ambulance_requests SET status='despachada' WHERE id=r.id;
 RETURN v;
END $function$;
CREATE OR REPLACE FUNCTION public.dispatch_ambulance(p_request uuid, p_staff uuid DEFAULT NULL::uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v smallint;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT ambulance_id INTO v FROM public.ambulance_dispatches WHERE request_id=p_request AND completed_at IS NULL;
 IF v IS NULL THEN SELECT id INTO v FROM public.ambulances WHERE active AND status='disponible' ORDER BY id LIMIT 1; END IF;
 RETURN public.assign_medical_transport(p_request,v,p_staff);
END $function$;
CREATE OR REPLACE FUNCTION public.review_medical_transport(p_request uuid, p_action text, p_destination text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE r public.ambulance_requests;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO r FROM public.ambulance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('pendiente','autorizada') THEN RAISE EXCEPTION 'La solicitud ya no está pendiente'; END IF;
 IF p_action='autorizar' THEN
  IF nullif(trim(coalesce(p_destination,r.destination)),'') IS NULL OR length(coalesce(p_destination,r.destination))>1000 THEN RAISE EXCEPTION 'Confirma el destino del traslado'; END IF;
  UPDATE public.ambulance_requests SET destination=trim(coalesce(p_destination,r.destination)),status='autorizada' WHERE id=r.id;
 ELSIF p_action IN ('rechazar','cancelar') AND nullif(trim(p_reason),'') IS NOT NULL AND length(p_reason)<=2000 THEN
  UPDATE public.ambulance_requests SET status=CASE p_action WHEN 'rechazar' THEN 'rechazada'::public.dispatch_state ELSE 'cancelada'::public.dispatch_state END,decision_reason=trim(p_reason) WHERE id=r.id;
 ELSE RAISE EXCEPTION 'Indica una acción y el motivo correspondiente'; END IF;
END $function$;
CREATE OR REPLACE FUNCTION public.progress_medical_transport(p_dispatch uuid, p_event text, p_notes text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION public.complete_dispatch(p_dispatch uuid, p_maintenance boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION public.finish_medical_transport(p_dispatch uuid, p_controls_confirmed boolean, p_maintenance boolean, p_notes text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
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
END $function$;
CREATE OR REPLACE FUNCTION public.save_panel_ambulance(p_code text, p_plate text, p_status ambulance_state, p_active boolean, p_notes text DEFAULT NULL::text, p_id smallint DEFAULT NULL::smallint)
 RETURNS smallint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
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
END $function$;

-- RLS y permisos (producción).
ALTER TABLE ambulances ENABLE ROW LEVEL SECURITY; ALTER TABLE ambulance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ambulance_dispatches ENABLE ROW LEVEL SECURITY; ALTER TABLE ambulance_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY; ALTER TABLE emergency_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ambulance_read ON ambulances FOR SELECT TO authenticated USING (true);
CREATE POLICY ambulance_history_read ON ambulance_status_history FOR SELECT TO authenticated USING (private.has_role('admin'::hospital_role));
CREATE POLICY ambreq_insert ON ambulance_requests FOR INSERT TO authenticated WITH CHECK (((status = 'pendiente'::dispatch_state) AND (requester_id = auth.uid()) AND ((private.has_role('paciente'::hospital_role) AND (patient_id IS NOT NULL) AND private.my_patient(patient_id)) OR private.has_role('recepcionista'::hospital_role) OR private.has_role('admin'::hospital_role) OR (private.has_role('doctor'::hospital_role) AND (patient_id IS NOT NULL) AND private.treats_patient(patient_id)))));
CREATE POLICY ambreq_read ON ambulance_requests FOR SELECT TO authenticated USING (((requester_id = auth.uid()) OR ((patient_id IS NOT NULL) AND private.my_patient(patient_id)) OR private.has_role('recepcionista'::hospital_role) OR private.has_role('admin'::hospital_role) OR ((patient_id IS NOT NULL) AND private.treats_patient(patient_id))));
CREATE POLICY dispatch_read ON ambulance_dispatches FOR SELECT TO authenticated USING ((private.has_role('admin'::hospital_role) OR private.has_role('recepcionista'::hospital_role) OR (EXISTS ( SELECT 1 FROM ambulance_requests r WHERE ((r.id = ambulance_dispatches.request_id) AND ((r.requester_id = auth.uid()) OR ((r.patient_id IS NOT NULL) AND private.my_patient(r.patient_id))))))));
CREATE POLICY notification_read ON notifications FOR SELECT TO authenticated USING (recipient_id = auth.uid());
CREATE POLICY emergency_read ON emergency_logs FOR SELECT TO authenticated USING (private.has_role('admin'::hospital_role));
GRANT SELECT ON ambulances, ambulance_dispatches, ambulance_status_history, notifications, emergency_logs TO authenticated;
GRANT SELECT, INSERT ON ambulance_requests TO authenticated;
REVOKE ALL ON FUNCTION private.emit_panel_notice(text,text,text,text,text,text,boolean), private.panel_transport_audit(), private.panel_fleet_audit(),
  private.transport_operator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_medical_transport(uuid,smallint,uuid), public.dispatch_ambulance(uuid,uuid), public.review_medical_transport(uuid,text,text,text),
  public.progress_medical_transport(uuid,text,text), public.complete_dispatch(uuid,boolean), public.finish_medical_transport(uuid,boolean,boolean,text),
  public.save_panel_ambulance(text,text,ambulance_state,boolean,text,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_medical_transport(uuid,smallint,uuid), public.dispatch_ambulance(uuid,uuid), public.review_medical_transport(uuid,text,text,text),
  public.progress_medical_transport(uuid,text,text), public.complete_dispatch(uuid,boolean), public.finish_medical_transport(uuid,boolean,boolean,text),
  public.save_panel_ambulance(text,text,ambulance_state,boolean,text,smallint) TO authenticated;

-- La única unidad registrada en producción.
INSERT INTO ambulances(code, status, active) VALUES ('AMB-001', 'disponible', true);
