-- LOCAL fixture database only; run after the two recurring database suites.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.reject(q text,pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN
 IF SQLERRM!~*pattern THEN RAISE EXCEPTION 'Error inesperado: %, esperado %',SQLERRM,pattern; END IF; RETURN;
 END; RAISE EXCEPTION 'Faltó rechazo: %',pattern; END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE d date=(current_date+7)+((8-extract(dow FROM current_date+7)::integer)%7);
 doc uuid='bb000000-0000-4000-8000-000000000002'; rec uuid='bb000000-0000-4000-8000-000000000003';
 room uuid='cc000000-0000-4000-8000-000000000001'; p jsonb; v text;
BEGIN
 -- A dated absence is a real exception; the recurring rule is not overwritten.
 PERFORM public.save_staff_planning('absence',jsonb_build_object('staff_id',doc,'dates',jsonb_build_array(d+7),'start_time','08:00','end_time','10:00','active',true,'reason','Ausencia local de prueba'),NULL,NULL);
 IF (SELECT count(*) FROM public.get_medical_availability((d+7)::timestamp AT TIME ZONE 'America/El_Salvador',(d+8)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>11 THEN RAISE EXCEPTION 'La excepción no se aplicó al horario recurrente'; END IF;
 SELECT j->>'version',j->'request_values' INTO v,p FROM jsonb_array_elements(public.read_staff_planning(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador')->'recurring_journeys')j WHERE j->>'id'='dd000000-0000-4000-8000-000000000001';
 PERFORM public.save_recurring_journey(p||jsonb_build_object('valid_from',d+42,'weekdays',jsonb_build_array(0,1,2,3,4,5,6),'start_time','20:00','end_time','04:00','breaks',jsonb_build_array(jsonb_build_object('start_time','00:00','end_time','00:30','reason','Pausa nocturna'))),'dd000000-0000-4000-8000-000000000001',v,'dd000000-0000-4000-8000-000000000010');
 SELECT j->>'version',j->'request_values' INTO v,p FROM jsonb_array_elements(public.read_staff_planning((d+42)::timestamp AT TIME ZONE 'America/El_Salvador',(d+49)::timestamp AT TIME ZONE 'America/El_Salvador')->'recurring_journeys')j WHERE j->>'id'='dd000000-0000-4000-8000-000000000010';
 PERFORM pg_temp.reject(format('SELECT public.save_recurring_journey(%L::jsonb,%L,%L,%L)',p||jsonb_build_object('valid_from',d+49,'start_time','00:00','end_time','08:00'),'dd000000-0000-4000-8000-000000000010',v,'dd000000-0000-4000-8000-000000000011'),'nocturna');
 -- Existing dated operations remain usable; no migration of their records is assumed.
 PERFORM public.save_staff_planning_set('doctor','shift',jsonb_build_object('staff_id','bb000000-0000-4000-8000-000000000004','dates',jsonb_build_array(d+80),'start_time','08:00','end_time','16:00','active',true,'shift_type','ordinario','breaks',jsonb_build_array(jsonb_build_object('start_time','12:00','end_time','12:30','reason','Almuerzo')),'consultations',jsonb_build_array(jsonb_build_object('start_time','08:00','end_time','16:00','room_id',room,'slot_minutes',30))),'[]'::jsonb);
 IF (SELECT count(*) FROM public.get_medical_availability((d+80)::timestamp AT TIME ZONE 'America/El_Salvador',(d+81)::timestamp AT TIME ZONE 'America/El_Salvador','bb000000-0000-4000-8000-000000000004',room))<>15 THEN RAISE EXCEPTION 'Se rompió disponibilidad del horario por fecha'; END IF;
 RAISE NOTICE 'PASS: excepción por fecha y protección de transición nocturna';
END $$;
RESET ROLE;
COMMIT;
