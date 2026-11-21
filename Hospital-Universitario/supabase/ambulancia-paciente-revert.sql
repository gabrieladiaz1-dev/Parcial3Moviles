-- Reversión de supabase/ambulancia-paciente.sql. PREPARADO, NO APLICADO.
-- Restaura la política de inserción original, quita las RPC, disparadores y la publicación Realtime añadidas.
-- Las columnas nuevas de ambulance_requests se CONSERVAN para no perder datos de recogida ya registrados; si se quiere
-- retirarlas, hacerlo aparte tras exportar su contenido. Los avisos ya creados en notifications no se borran.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ambulance_requests') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.ambulance_requests;
  END IF;
END $$;
DROP POLICY IF EXISTS ambreq_insert ON public.ambulance_requests;
CREATE POLICY ambreq_insert ON public.ambulance_requests FOR INSERT TO authenticated WITH CHECK (
  (status = 'pendiente'::dispatch_state) AND (requester_id = auth.uid()) AND (
    (private.has_role('paciente'::hospital_role) AND (patient_id IS NOT NULL) AND private.my_patient(patient_id))
    OR private.has_role('recepcionista'::hospital_role) OR private.has_role('admin'::hospital_role)
    OR (private.has_role('doctor'::hospital_role) AND (patient_id IS NOT NULL) AND private.treats_patient(patient_id))));
DROP TRIGGER IF EXISTS ambulance_requests_keep ON public.ambulance_requests;
DROP TRIGGER IF EXISTS ambulance_dispatches_keep ON public.ambulance_dispatches;
DROP TRIGGER IF EXISTS ambulance_dispatch_progress ON public.ambulance_dispatches;
DROP TRIGGER IF EXISTS ambulance_request_notice ON public.ambulance_requests;
DROP TRIGGER IF EXISTS ambulance_request_touch ON public.ambulance_requests;
DROP FUNCTION IF EXISTS public.ambulance_service_log(timestamptz, timestamptz, text, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.cancel_dispatched_transport(uuid, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.cancel_my_ambulance_request(uuid, text);
DROP FUNCTION IF EXISTS public.submit_my_ambulance_request(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.my_ambulance_context();
DROP FUNCTION IF EXISTS private.ambulance_history_keep();
DROP FUNCTION IF EXISTS private.ambulance_dispatch_progress();
DROP FUNCTION IF EXISTS private.ambulance_request_notice();
DROP FUNCTION IF EXISTS private.ambulance_patient_notice(uuid, text);
DROP FUNCTION IF EXISTS private.my_ambulance_request(uuid, uuid);
DROP FUNCTION IF EXISTS private.ambulance_phone_ok(text);
DROP FUNCTION IF EXISTS private.ambulance_request_touch();
DROP INDEX IF EXISTS public.ambulance_requests_requester_idx;
ALTER TABLE public.ambulance_requests DROP CONSTRAINT IF EXISTS ambulance_pickup_coordinates;
ALTER TABLE public.ambulance_requests DROP CONSTRAINT IF EXISTS ambulance_pickup_lengths;
COMMIT;
