-- PREPARED ONLY. Requires explicit authorization before applying remotely.
-- Keep the published RPC signature, idempotent retry, planning lock, queue and notice triggers.
BEGIN;
DO $$
DECLARE definition text; anchor text = ' IF p_start IS NULL OR p_end IS NULL';
BEGIN
 definition = pg_get_functiondef('public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid)'::regprocedure);
 IF strpos(definition, 'booking_active_patient_guard') > 0 THEN RETURN; END IF;
 IF strpos(definition, anchor) = 0 OR strpos(definition, 'pg_advisory_xact_lock') = 0
 OR strpos(definition, 'private.planning_valid_slot') = 0 THEN
  RAISE EXCEPTION 'Inspect published schedule_appointment before applying this change';
 END IF;
 definition = replace(definition, anchor, $guard$
 -- booking_active_patient_guard: patients has no active/status column in the published schema.
 -- Check existence without inventing patient lifecycle rules. Lock deletion against a new booking.
 PERFORM 1 FROM public.patients WHERE id=p_patient FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'El paciente ya no está disponible' USING ERRCODE='22023'; END IF;
 IF p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.specialties WHERE id=r.specialty_id AND active) THEN
  RAISE EXCEPTION 'La especialidad ya no está disponible' USING ERRCODE='22023';
 END IF;
$guard$ || anchor);
 EXECUTE definition;
END $$;
COMMIT;
