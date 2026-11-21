-- Run only after recurring-journeys.database.sql in the same isolated LOCAL database.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
INSERT INTO public.patients(id,first_name,last_name) VALUES('ee000000-0000-4000-8000-000000000001','Paciente','Local recurrente');
CREATE FUNCTION pg_temp.reject(q text,pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM!~*pattern THEN RAISE EXCEPTION 'Error inesperado: %, esperado %',SQLERRM,pattern; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'Faltó rechazo: %',pattern;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE d date=(current_date+7)+((8-extract(dow FROM current_date+7)::integer)%7);
 doc uuid='bb000000-0000-4000-8000-000000000002'; other_doc uuid='bb000000-0000-4000-8000-000000000004';
 room uuid='cc000000-0000-4000-8000-000000000002'; patient uuid='ee000000-0000-4000-8000-000000000001';
 appointment uuid; v text; values_doc jsonb; projection jsonb;
BEGIN
 -- The existing appointment RPC uses the recurring backend validator without signature changes.
 appointment=public.schedule_appointment(patient,doc,room,((d+21)::text||'T08:00:00-06:00')::timestamptz,((d+21)::text||'T08:30:00-06:00')::timestamptz,NULL);
 IF (SELECT count(*) FROM public.get_medical_availability((d+21)::timestamp AT TIME ZONE 'America/El_Salvador',(d+22)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>14 THEN RAISE EXCEPTION 'La cita guardada no se excluyó de disponibilidad'; END IF;
 PERFORM pg_temp.reject(format('SELECT public.schedule_appointment(%L,%L,%L,%L,%L,NULL)',patient,doc,room,(d+21)::text||'T08:00:00-06:00',(d+21)::text||'T08:30:00-06:00'),'conflicting|exclusion|exclus');
 PERFORM pg_temp.reject(format('SELECT public.schedule_appointment(%L,%L,%L,%L,%L,NULL)',patient,doc,room,(d+21)::text||'T12:00:00-06:00',(d+21)::text||'T12:30:00-06:00'),'disponibilidad|descanso');
 PERFORM pg_temp.reject(format('SELECT public.schedule_appointment(%L,%L,%L,%L,%L,NULL)',patient,doc,room,(d+21)::text||'T07:00:00-06:00',(d+21)::text||'T07:30:00-06:00'),'disponibilidad|descanso');
 projection=public.read_staff_planning((d+14)::timestamp AT TIME ZONE 'America/El_Salvador',(d+21)::timestamp AT TIME ZONE 'America/El_Salvador');
 SELECT j->>'version',j->'request_values' INTO v,values_doc FROM jsonb_array_elements(projection->'recurring_journeys')j WHERE j->>'id'='dd000000-0000-4000-8000-000000000005';
 PERFORM pg_temp.reject(format('SELECT public.save_recurring_journey(%L::jsonb,%L,%L,%L)',values_doc||jsonb_build_object('valid_from',d+21,'start_time','09:00','consultations',jsonb_build_array(jsonb_build_object('start_time','09:00','end_time','16:00','slot_minutes',30))),'dd000000-0000-4000-8000-000000000005',v,'dd000000-0000-4000-8000-000000000007'),'Conflicto con citas');
 PERFORM pg_temp.reject(format('SELECT public.save_recurring_journey(%L::jsonb,%L,%L,%L)',jsonb_build_object('staff_id',doc,'valid_from',d+21,'active',false),'dd000000-0000-4000-8000-000000000005',v,'dd000000-0000-4000-8000-000000000008'),'Conflicto con citas');
 -- Successful deactivation after the booked appointment keeps the appointment and past definition.
 PERFORM public.save_recurring_journey(jsonb_build_object('staff_id',doc,'valid_from',d+28,'active',false),'dd000000-0000-4000-8000-000000000005',v,'dd000000-0000-4000-8000-000000000009');
 IF EXISTS(SELECT 1 FROM public.get_medical_availability((d+28)::timestamp AT TIME ZONE 'America/El_Salvador',(d+29)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room)) THEN RAISE EXCEPTION 'La jornada desactivada sigue ofreciendo citas'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.appointments WHERE id=appointment AND patient_id=patient AND status='programada') THEN RAISE EXCEPTION 'Se alteró la cita o su relación'; END IF;
 PERFORM pg_temp.reject('SELECT * FROM public.staff_recurring_journeys','permission denied|permiso');
 RAISE NOTICE 'PASS: guardar cita real local, bloqueo de cruces, descanso, horario, edición incompatible, baja efectiva e historial de cita';
END $$;
RESET ROLE;
COMMIT;
SELECT count(*) AS preserved_appointments FROM public.appointments;
