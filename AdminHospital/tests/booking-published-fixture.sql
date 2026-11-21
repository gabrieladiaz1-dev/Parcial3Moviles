-- LOCAL TEST FIXTURE ONLY. Function bodies matched against MCP reads on 2026-11-21.
-- This supplies current queue and notice dependencies to the repository's older local base schema.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS queue_date date, ADD COLUMN IF NOT EXISTS queue_number integer;
CREATE TABLE private.appointment_queue_day_counters(queue_date date PRIMARY KEY,last_number integer NOT NULL);
CREATE UNIQUE INDEX appointments_hospital_day_queue_unique ON public.appointments(queue_date,queue_number);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS kind text, ADD COLUMN IF NOT EXISTS entity_type text, ADD COLUMN IF NOT EXISTS entity_id text, ADD COLUMN IF NOT EXISTS event_key text;
CREATE UNIQUE INDEX notification_event_once ON public.notifications(recipient_id,event_key) WHERE event_key IS NOT NULL;
CREATE OR REPLACE FUNCTION private.assign_appointment_queue()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_day date;
BEGIN
  v_day := (NEW.starts_at AT TIME ZONE 'America/El_Salvador')::date;
  IF TG_OP = 'INSERT' OR v_day IS DISTINCT FROM OLD.queue_date THEN
    INSERT INTO private.appointment_queue_day_counters(queue_date, last_number) VALUES (v_day, 1)
      ON CONFLICT (queue_date) DO UPDATE SET last_number = private.appointment_queue_day_counters.last_number + 1
      RETURNING last_number INTO NEW.queue_number;
    NEW.queue_date := v_day;
  ELSIF NEW.queue_number IS DISTINCT FROM OLD.queue_number OR NEW.queue_date IS DISTINCT FROM OLD.queue_date THEN
    RAISE EXCEPTION 'El turno se asigna automáticamente al agendar la cita';
  END IF;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION private.patient_appointment_notice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE recipient uuid; title text; body text; event text;
BEGIN
 SELECT p.profile_id INTO recipient FROM public.patients p WHERE p.id=NEW.patient_id;
 IF recipient IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=recipient AND r.role='paciente' AND r.active) THEN RETURN NEW; END IF;
 IF NEW.status IN ('programada','confirmada') AND (TG_OP='INSERT' OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR OLD.status NOT IN ('programada','confirmada')) THEN
  title=CASE WHEN TG_OP='UPDATE' AND NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN 'Tu cita fue reprogramada' ELSE 'Tienes una cita programada' END;
  body='Tu cita es el '||to_char(NEW.starts_at AT TIME ZONE 'America/El_Salvador','DD/MM/YYYY')||' a las '||to_char(NEW.starts_at AT TIME ZONE 'America/El_Salvador','HH24:MI')||'. Revisa los detalles en Mis citas.';
  event='patient:appointment:'||NEW.id::text||':'||extract(epoch from NEW.starts_at)::text;
 ELSIF TG_OP='UPDATE' AND NEW.status='cancelada' AND OLD.status IS DISTINCT FROM NEW.status THEN
  title='Tu cita fue cancelada';
  body='La cita del '||to_char(NEW.starts_at AT TIME ZONE 'America/El_Salvador','DD/MM/YYYY HH24:MI')||' fue cancelada. Puedes enviar una nueva solicitud de atención.';
  event='patient:appointment:'||NEW.id::text||':cancelled';
 ELSE RETURN NEW; END IF;
 INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key)
 VALUES(recipient,title,body,'cita','appointments',NEW.id::text,event)
 ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 RETURN NEW;
END $function$;
CREATE TRIGGER assign_appointment_queue BEFORE INSERT OR UPDATE OF starts_at,queue_date,queue_number ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.assign_appointment_queue();
CREATE TRIGGER patient_appointment_notice AFTER INSERT OR UPDATE OF starts_at,status ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.patient_appointment_notice();

CREATE OR REPLACE FUNCTION private.mark_missed_appointments()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
 WITH candidates AS (
   SELECT a.id, a.status FROM public.appointments a
   WHERE a.status IN ('programada','confirmada') AND a.ends_at < now()
     AND NOT EXISTS (SELECT 1 FROM public.clinical_encounters e WHERE e.appointment_id = a.id)
   FOR UPDATE SKIP LOCKED),
 updated AS (
   UPDATE public.appointments a SET status = 'no_asistio' FROM candidates c
   WHERE a.id = c.id AND a.status = c.status RETURNING a.id, c.status AS old_status)
 INSERT INTO public.appointment_status_history(appointment_id, old_status, new_status, actor_id)
 SELECT id, old_status, 'no_asistio', NULL FROM updated;
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN n;
END $function$;
