-- =====================================================================================================================
-- Ambulancia: solicitud del paciente, seguimiento, avisos idempotentes, cancelaciones y bitácora de servicios.
-- Hospital Móviles (uvebpsbbwofthucghccc). PREPARADO, NO APLICADO. Requiere autorización expresa del usuario.
-- Probado en PostgreSQL 17 desechable con scripts/test-ambulance-sql.mjs (incluye concurrencia real).
--
-- REUTILIZA (ya desplegado, no se modifica):
--   ambulances (una unidad, AMB-001) · ambulance_requests · ambulance_dispatches · ambulance_status_history · emergency_logs
--   Índice only_one_active_dispatch (UNIQUE ambulance_id WHERE completed_at IS NULL) + candado 901407021:
--     la base de datos impide dos servicios activos en la misma ambulancia.
--   review_medical_transport (autorizar/rechazar/cancelar antes del despacho) · dispatch_ambulance / assign_medical_transport
--   progress_medical_transport (salida/llegada) · finish_medical_transport (controles + disponible o mantenimiento)
--   save_panel_ambulance (mantenimiento; bloqueado con servicio activo) · panel_transport_data (panel administrativo)
--   panel_transport_audit / panel_fleet_audit (emergency_logs, historial de la unidad y avisos a administración)
--
-- AÑADE:
--   1. Columnas de recogida opcionales (referencia, coordenadas, situación, indicaciones, teléfono alterno, updated_at).
--   2. RPC del paciente: my_ambulance_context, submit_my_ambulance_request, cancel_my_ambulance_request.
--   3. Avisos al paciente idempotentes (event_key 'ambulance:<solicitud>:<evento>' + índice notification_event_once).
--   4. cancel_dispatched_transport: cancelación tras el despacho, solo administración, con controles y destino explícito
--      de la unidad (disponible o mantenimiento). Nunca libera la ambulancia automáticamente.
--   5. ambulance_service_log: bitácora filtrable (fecha, intervalo, estado, solicitud) para administración y recepción.
--   6. Historial no eliminable (BEFORE DELETE) en solicitudes y despachos.
--   7. El paciente ya no inserta directamente en ambulance_requests (solo mediante la RPC validada).
--   8. Realtime: ambulance_requests en la publicación supabase_realtime (RLS de lectura existente sin cambios).
--
-- Estados: se reutilizan dispatch_state (pendiente, autorizada, despachada, finalizada, rechazada, cancelada) y
-- ambulance_state (disponible, en_servicio, en_mantenimiento). «Asignada», «En camino» y «En atención» se derivan de
-- ambulance_dispatches (dispatched_at, departed_at, arrived_at); no se crean estados nuevos.
-- Reversión: supabase/ambulancia-paciente-revert.sql
-- =====================================================================================================================
BEGIN;

-- 1. Datos de recogida ------------------------------------------------------------------------------------------------
ALTER TABLE public.ambulance_requests
  ADD COLUMN IF NOT EXISTS pickup_reference text,
  ADD COLUMN IF NOT EXISTS pickup_latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS pickup_longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS pickup_accuracy_m numeric(8,1),
  ADD COLUMN IF NOT EXISTS situation text,
  ADD COLUMN IF NOT EXISTS pickup_notes text,
  ADD COLUMN IF NOT EXISTS alternate_phone text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.ambulance_requests DROP CONSTRAINT IF EXISTS ambulance_pickup_coordinates;
ALTER TABLE public.ambulance_requests ADD CONSTRAINT ambulance_pickup_coordinates CHECK (
  (pickup_latitude IS NULL) = (pickup_longitude IS NULL)
  AND (pickup_latitude IS NULL OR (pickup_latitude BETWEEN -90 AND 90 AND pickup_longitude BETWEEN -180 AND 180))
  AND (pickup_accuracy_m IS NULL OR (pickup_latitude IS NOT NULL AND pickup_accuracy_m BETWEEN 0 AND 100000)));
ALTER TABLE public.ambulance_requests DROP CONSTRAINT IF EXISTS ambulance_pickup_lengths;
ALTER TABLE public.ambulance_requests ADD CONSTRAINT ambulance_pickup_lengths CHECK (
  coalesce(length(pickup_reference),0) <= 500 AND coalesce(length(situation),0) <= 2000
  AND coalesce(length(pickup_notes),0) <= 1000 AND coalesce(length(alternate_phone),0) <= 30);

CREATE INDEX IF NOT EXISTS ambulance_requests_requester_idx ON public.ambulance_requests (requester_id, requested_at DESC);

-- updated_at: última actualización real de la solicitud (también cuando cambia su despacho).
CREATE OR REPLACE FUNCTION private.ambulance_request_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ambulance_request_touch ON public.ambulance_requests;
CREATE TRIGGER ambulance_request_touch BEFORE UPDATE ON public.ambulance_requests
  FOR EACH ROW EXECUTE FUNCTION private.ambulance_request_touch();

-- 2. Reglas compartidas -----------------------------------------------------------------------------------------------
-- Teléfono: dígitos con espacios, guiones o paréntesis; 8 a 15 dígitos (igual que HospitalCore.ambulance / AmbulanceRules).
CREATE OR REPLACE FUNCTION private.ambulance_phone_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT p IS NOT NULL AND length(p) <= 30 AND p ~ '^\+?[0-9][0-9 ()-]{6,22}[0-9]$'
     AND length(regexp_replace(p, '[^0-9]', '', 'g')) BETWEEN 8 AND 15 $$;

-- Solicitudes visibles para el paciente autenticado: las que envió o las de su expediente.
CREATE OR REPLACE FUNCTION private.my_ambulance_request(p_requester uuid, p_patient uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (p_requester = auth.uid() OR (p_patient IS NOT NULL AND private.my_patient(p_patient))) $$;

-- 3. Avisos al paciente (idempotentes) --------------------------------------------------------------------------------
-- Destinatarios: el solicitante si es paciente activo y la cuenta vinculada al expediente. Nunca al personal que la registró.
CREATE OR REPLACE FUNCTION private.ambulance_patient_notice(p_request uuid, p_event text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.ambulance_requests; v_title text; v_body text;
BEGIN
  SELECT * INTO r FROM public.ambulance_requests WHERE id = p_request;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT t, b INTO v_title, v_body FROM (VALUES
    ('recibida',   'Solicitud de ambulancia recibida', 'Tu solicitud fue enviada al hospital y está pendiente de revisión.'),
    ('asignada',   'Ambulancia asignada',              'El hospital ha asignado una ambulancia a tu solicitud.'),
    ('en_camino',  'Ambulancia en camino',             'La ambulancia ha salido para atender tu solicitud.'),
    ('finalizada', 'Servicio de ambulancia finalizado', 'El servicio de ambulancia de tu solicitud ha finalizado.'),
    ('cancelada',  'Solicitud de ambulancia cancelada', 'Tu solicitud de ambulancia fue cancelada.' || coalesce(' Motivo: ' || r.decision_reason, '')),
    ('rechazada',  'Solicitud de ambulancia no atendida', 'El hospital no puede atender tu solicitud de ambulancia.' || coalesce(' Motivo: ' || r.decision_reason, ''))
  ) v(e, t, b) WHERE e = p_event;
  IF v_title IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications(recipient_id, title, body, kind, entity_type, entity_id, event_key)
  SELECT DISTINCT x.id, v_title, v_body, 'ambulancia', 'ambulance_requests', r.id::text, 'ambulance:' || r.id::text || ':' || p_event
  FROM (
    SELECT r.requester_id AS id WHERE EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = r.requester_id AND ur.role = 'paciente' AND ur.active)
    UNION SELECT p.profile_id FROM public.patients p WHERE p.id = r.patient_id AND p.profile_id IS NOT NULL
  ) x WHERE x.id IS NOT NULL
  ON CONFLICT (recipient_id, event_key) WHERE event_key IS NOT NULL DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION private.ambulance_request_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM private.ambulance_patient_notice(NEW.id, 'recibida');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM private.ambulance_patient_notice(NEW.id, CASE NEW.status WHEN 'despachada' THEN 'asignada' ELSE NEW.status::text END);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ambulance_request_notice ON public.ambulance_requests;
CREATE TRIGGER ambulance_request_notice AFTER INSERT OR UPDATE OF status ON public.ambulance_requests
  FOR EACH ROW EXECUTE FUNCTION private.ambulance_request_notice();

-- Cambios del despacho: actualizan updated_at de la solicitud (Realtime del paciente) y avisan la salida.
CREATE OR REPLACE FUNCTION private.ambulance_dispatch_progress() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.departed_at IS NOT DISTINCT FROM OLD.departed_at AND NEW.arrived_at IS NOT DISTINCT FROM OLD.arrived_at
     AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at THEN RETURN NEW; END IF;
  UPDATE public.ambulance_requests SET updated_at = now() WHERE id = NEW.request_id;
  IF TG_OP = 'UPDATE' AND OLD.departed_at IS NULL AND NEW.departed_at IS NOT NULL THEN
    PERFORM private.ambulance_patient_notice(NEW.request_id, 'en_camino');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ambulance_dispatch_progress ON public.ambulance_dispatches;
CREATE TRIGGER ambulance_dispatch_progress AFTER INSERT OR UPDATE OF departed_at, arrived_at, completed_at ON public.ambulance_dispatches
  FOR EACH ROW EXECUTE FUNCTION private.ambulance_dispatch_progress();

-- 4. RPC del paciente -------------------------------------------------------------------------------------------------
-- Contexto: identidad (solo lectura), disponibilidad informativa de la unidad y sus solicitudes (máx. 20, recientes primero).
-- No expone personal, notas internas de cierre ni solicitudes de otros pacientes.
CREATE OR REPLACE FUNCTION public.my_ambulance_context() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_uid uuid := auth.uid(); v_person jsonb; v_rows jsonb;
BEGIN
  IF v_uid IS NULL OR NOT private.has_role('paciente') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('full_name', nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'phone', nullif(trim(p.phone), ''))
    INTO v_person FROM public.profiles p WHERE p.id = v_uid;
  IF v_person IS NULL THEN RAISE EXCEPTION 'Perfil no disponible' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.requested_at DESC, x.id), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.id, r.status, r.requested_at, r.updated_at, r.contact_name, r.contact_phone, r.alternate_phone, r.pickup_location,
           r.pickup_reference, r.pickup_latitude, r.pickup_longitude, r.pickup_accuracy_m, r.reason, r.situation, r.pickup_notes,
           r.destination, r.decision_reason, d.dispatched_at AS assigned_at, d.departed_at, d.arrived_at, d.completed_at, a.code AS unit_code
    FROM public.ambulance_requests r
    LEFT JOIN public.ambulance_dispatches d ON d.request_id = r.id
    LEFT JOIN public.ambulances a ON a.id = d.ambulance_id
    WHERE private.my_ambulance_request(r.requester_id, r.patient_id)
    ORDER BY r.requested_at DESC, r.id LIMIT 20) x;
  RETURN jsonb_build_object('person', v_person, 'requests', v_rows,
    'unit_available', EXISTS (SELECT 1 FROM public.ambulances a WHERE a.active AND a.status = 'disponible'
      AND NOT EXISTS (SELECT 1 FROM public.ambulance_dispatches d WHERE d.ambulance_id = a.id AND d.completed_at IS NULL)),
    'server_time', now());
END $$;

-- Envío: registra la solicitud (estado pendiente). NO asigna ni despacha: eso lo decide administración.
-- Idempotente por (requester_id, request_key) y serializado por paciente: doble pulsación o reintento → la misma solicitud;
-- una sola solicitud activa (pendiente, autorizada o despachada) por paciente. Identidad tomada de la sesión, nunca del cliente.
CREATE OR REPLACE FUNCTION public.submit_my_ambulance_request(
  p_key uuid, p_phone text, p_pickup text, p_reason text, p_reference text DEFAULT NULL, p_situation text DEFAULT NULL,
  p_notes text DEFAULT NULL, p_alternate_phone text DEFAULT NULL, p_latitude numeric DEFAULT NULL, p_longitude numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid; v_name text; v_patient uuid;
BEGIN
  IF v_uid IS NULL OR NOT private.has_role('paciente') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL THEN RAISE EXCEPTION 'Identificador de solicitud requerido' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ambulance:' || v_uid::text, 0));
  SELECT id INTO v_id FROM public.ambulance_requests WHERE requester_id = v_uid AND request_key = p_key;
  IF FOUND THEN RETURN v_id; END IF;
  IF EXISTS (SELECT 1 FROM public.ambulance_requests x WHERE private.my_ambulance_request(x.requester_id, x.patient_id)
             AND x.status IN ('pendiente', 'autorizada', 'despachada')) THEN
    RAISE EXCEPTION 'Ya tienes una solicitud de ambulancia activa. Consulta su estado o cancélala antes de enviar otra.' USING ERRCODE = '22023';
  END IF;
  IF NOT private.ambulance_phone_ok(trim(p_phone)) THEN
    RAISE EXCEPTION 'Escribe un teléfono de contacto válido (8 a 15 dígitos).' USING ERRCODE = '22023'; END IF;
  IF nullif(trim(p_alternate_phone), '') IS NOT NULL AND NOT private.ambulance_phone_ok(trim(p_alternate_phone)) THEN
    RAISE EXCEPTION 'El teléfono alternativo no es válido (8 a 15 dígitos).' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p_pickup, ''))) < 5 OR length(p_pickup) > 1000 THEN
    RAISE EXCEPTION 'Escribe la dirección de recogida (entre 5 y 1000 caracteres).' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 3 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Escribe el motivo de la solicitud (entre 3 y 500 caracteres).' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(p_reference), 0) > 500 OR coalesce(length(p_situation), 0) > 2000 OR coalesce(length(p_notes), 0) > 1000 THEN
    RAISE EXCEPTION 'El texto supera la longitud permitida.' USING ERRCODE = '22023'; END IF;
  IF (p_latitude IS NULL) <> (p_longitude IS NULL) OR (p_latitude IS NULL AND p_accuracy IS NOT NULL)
     OR (p_latitude IS NOT NULL AND (p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180))
     OR (p_accuracy IS NOT NULL AND p_accuracy NOT BETWEEN 0 AND 100000) THEN
    RAISE EXCEPTION 'La ubicación compartida no es válida. Vuelve a obtenerla o escribe solo la dirección.' USING ERRCODE = '22023'; END IF;
  SELECT nullif(trim(concat_ws(' ', first_name, last_name)), '') INTO v_name FROM public.profiles WHERE id = v_uid;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Completa tu nombre en tu perfil antes de solicitar la ambulancia.' USING ERRCODE = '22023'; END IF;
  -- Solo se vincula el expediente si existe (assign_medical_transport exige expediente válido cuando hay patient_id).
  SELECT p.id INTO v_patient FROM public.patients p
   WHERE p.profile_id = v_uid AND EXISTS (SELECT 1 FROM public.medical_records m WHERE m.patient_id = p.id) LIMIT 1;
  INSERT INTO public.ambulance_requests(patient_id, requester_id, contact_name, contact_phone, alternate_phone, pickup_location,
    pickup_reference, pickup_latitude, pickup_longitude, pickup_accuracy_m, reason, situation, pickup_notes, priority, request_key)
  VALUES (v_patient, v_uid, v_name, trim(p_phone), nullif(trim(p_alternate_phone), ''), trim(p_pickup), nullif(trim(p_reference), ''),
    p_latitude, p_longitude, CASE WHEN p_latitude IS NULL THEN NULL ELSE p_accuracy END, trim(p_reason), nullif(trim(p_situation), ''),
    nullif(trim(p_notes), ''), 'normal', p_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Cancelación por el paciente: solo antes del despacho. Usa el mismo candado que el despacho para no cruzarse con una asignación.
CREATE OR REPLACE FUNCTION public.cancel_my_ambulance_request(p_request uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r public.ambulance_requests;
BEGIN
  IF auth.uid() IS NULL OR NOT private.has_role('paciente') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 3 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'Indica el motivo de la cancelación (entre 3 y 500 caracteres).' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(901407021::bigint);
  SELECT * INTO r FROM public.ambulance_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT private.my_ambulance_request(r.requester_id, r.patient_id) THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = '42501'; END IF;
  IF r.status = 'cancelada' THEN RETURN; END IF;
  IF r.status = 'despachada' THEN
    RAISE EXCEPTION 'La ambulancia ya fue asignada a tu solicitud. Comunícate con el hospital: el personal autorizado gestionará la cancelación.' USING ERRCODE = '22023'; END IF;
  IF r.status NOT IN ('pendiente', 'autorizada') THEN RAISE EXCEPTION 'Esta solicitud ya no se puede cancelar.' USING ERRCODE = '22023'; END IF;
  UPDATE public.ambulance_requests SET status = 'cancelada', decision_reason = trim(p_reason) WHERE id = r.id;
END $$;

-- 5. Administración ---------------------------------------------------------------------------------------------------
-- Cancelación de un servicio YA despachado (en camino o en atención): solo administración, con motivo, controles confirmados
-- y decisión explícita sobre la unidad. No existe liberación automática.
CREATE OR REPLACE FUNCTION public.cancel_dispatched_transport(p_dispatch uuid, p_reason text, p_controls_confirmed boolean, p_maintenance boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d public.ambulance_dispatches; v_status public.dispatch_state;
BEGIN
  IF NOT private.transport_operator(p_dispatch) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF nullif(trim(p_reason), '') IS NULL OR length(p_reason) > 2000 OR p_controls_confirmed IS DISTINCT FROM true OR p_maintenance IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo, confirma los controles y el estado en que queda la unidad' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(901407021::bigint);
  SELECT * INTO d FROM public.ambulance_dispatches WHERE id = p_dispatch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Servicio inexistente' USING ERRCODE = '22023'; END IF;
  IF d.completed_at IS NOT NULL THEN
    SELECT status INTO v_status FROM public.ambulance_requests WHERE id = d.request_id;
    IF v_status = 'cancelada' THEN RETURN; END IF;
    RAISE EXCEPTION 'El servicio ya terminó' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ambulance_dispatches SET controls_checked_at = now(), completed_at = now(), completed_by = auth.uid(),
    completion_notes = trim(p_reason) WHERE id = d.id;
  UPDATE public.ambulance_requests SET status = 'cancelada', decision_reason = trim(p_reason) WHERE id = d.request_id;
  UPDATE public.ambulances SET status = CASE WHEN p_maintenance THEN 'en_mantenimiento'::public.ambulance_state ELSE 'disponible'::public.ambulance_state END,
    operational_notes = CASE WHEN p_maintenance THEN trim(p_reason) ELSE operational_notes END WHERE id = d.ambulance_id;
  INSERT INTO public.emergency_logs(request_id, event_type, description, actor_id) VALUES (d.request_id, 'cancelacion_servicio', trim(p_reason), auth.uid());
END $$;

-- Bitácora de servicios: horas reales registradas (nunca calculadas), operador que autorizó y que despachó.
CREATE OR REPLACE FUNCTION public.ambulance_service_log(p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL, p_request uuid DEFAULT NULL, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_items jsonb; v_total bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT (private.has_role('admin') OR private.has_role('recepcionista')) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF p_offset IS NULL OR p_offset < 0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to)
     OR (p_status IS NOT NULL AND p_status NOT IN ('pendiente','autorizada','despachada','finalizada','rechazada','cancelada')) THEN
    RAISE EXCEPTION 'Filtro inválido' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO v_total FROM public.ambulance_requests r
   WHERE (p_request IS NULL OR r.id = p_request) AND (p_status IS NULL OR r.status::text = p_status)
     AND (p_from IS NULL OR r.requested_at >= p_from) AND (p_to IS NULL OR r.requested_at < p_to);
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.requested_at DESC, x.request_id), '[]'::jsonb) INTO v_items FROM (
    SELECT r.id AS request_id, r.patient_id, nullif(concat_ws(' ', pt.first_name, pt.last_name), '') AS patient_name, r.contact_name,
           r.requested_at, d.dispatched_at AS assigned_at, d.departed_at, d.arrived_at, d.completed_at,
           r.pickup_location, r.pickup_reference, r.reason, r.status, a.code AS unit_code, r.decision_reason, d.completion_notes,
           (SELECT nullif(concat_ws(' ', p.first_name, p.last_name), '') FROM public.emergency_logs l LEFT JOIN public.profiles p ON p.id = l.actor_id
             WHERE l.request_id = r.id AND l.event_type = 'autorizada' ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS authorized_by,
           (SELECT nullif(concat_ws(' ', p.first_name, p.last_name), '') FROM public.emergency_logs l LEFT JOIN public.profiles p ON p.id = l.actor_id
             WHERE l.request_id = r.id AND l.event_type = 'despachada' ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS dispatched_by,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('event', l.event_type, 'description', l.description, 'at', l.occurred_at,
              'actor', nullif(concat_ws(' ', p.first_name, p.last_name), '')) ORDER BY l.occurred_at, l.id), '[]'::jsonb)
              FROM public.emergency_logs l LEFT JOIN public.profiles p ON p.id = l.actor_id WHERE l.request_id = r.id) AS events
    FROM public.ambulance_requests r
    LEFT JOIN public.patients pt ON pt.id = r.patient_id
    LEFT JOIN public.ambulance_dispatches d ON d.request_id = r.id
    LEFT JOIN public.ambulances a ON a.id = d.ambulance_id
    WHERE (p_request IS NULL OR r.id = p_request) AND (p_status IS NULL OR r.status::text = p_status)
      AND (p_from IS NULL OR r.requested_at >= p_from) AND (p_to IS NULL OR r.requested_at < p_to)
    ORDER BY r.requested_at DESC, r.id OFFSET p_offset LIMIT p_limit) x;
  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'offset', p_offset, 'limit', p_limit);
END $$;

-- 6. Historial no eliminable ------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.ambulance_history_keep() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'El historial de ambulancia no se elimina; registra una cancelación o un cierre.' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS ambulance_requests_keep ON public.ambulance_requests;
CREATE TRIGGER ambulance_requests_keep BEFORE DELETE ON public.ambulance_requests FOR EACH ROW EXECUTE FUNCTION private.ambulance_history_keep();
DROP TRIGGER IF EXISTS ambulance_dispatches_keep ON public.ambulance_dispatches;
CREATE TRIGGER ambulance_dispatches_keep BEFORE DELETE ON public.ambulance_dispatches FOR EACH ROW EXECUTE FUNCTION private.ambulance_history_keep();

-- 7. El paciente solo solicita mediante la RPC (sin prioridad, fecha, destino ni decisión elegidos por el cliente) -------
DROP POLICY IF EXISTS ambreq_insert ON public.ambulance_requests;
CREATE POLICY ambreq_insert ON public.ambulance_requests FOR INSERT TO authenticated WITH CHECK (
  status = 'pendiente'::public.dispatch_state AND requester_id = auth.uid()
  AND (private.has_role('recepcionista'::public.hospital_role) OR private.has_role('admin'::public.hospital_role)
       OR (private.has_role('doctor'::public.hospital_role) AND patient_id IS NOT NULL AND private.treats_patient(patient_id))));

-- 8. Realtime (la lectura sigue limitada por la política ambreq_read existente) ----------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ambulance_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ambulance_requests;
  END IF;
END $$;

-- Permisos --------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.ambulance_request_touch(), private.ambulance_phone_ok(text), private.my_ambulance_request(uuid, uuid),
  private.ambulance_patient_notice(uuid, text), private.ambulance_request_notice(), private.ambulance_dispatch_progress(),
  private.ambulance_history_keep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_ambulance_context(), public.submit_my_ambulance_request(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric),
  public.cancel_my_ambulance_request(uuid, text), public.cancel_dispatched_transport(uuid, text, boolean, boolean),
  public.ambulance_service_log(timestamptz, timestamptz, text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_ambulance_context(), public.submit_my_ambulance_request(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric),
  public.cancel_my_ambulance_request(uuid, text), public.cancel_dispatched_transport(uuid, text, boolean, boolean),
  public.ambulance_service_log(timestamptz, timestamptz, text, uuid, integer, integer) TO authenticated;

COMMIT;
