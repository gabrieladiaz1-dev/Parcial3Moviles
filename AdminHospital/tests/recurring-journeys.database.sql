-- LOCAL POSTGRES ONLY. Synthetic identities; no production endpoints or employees.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('aa000000-0000-4000-8000-000000000001','recurring-admin@local.test','{"first_name":"Admin","last_name":"Local"}'),
 ('aa000000-0000-4000-8000-000000000002','recurring-doctor@local.test','{"first_name":"Doctor","last_name":"Local"}'),
 ('aa000000-0000-4000-8000-000000000003','recurring-reception@local.test','{"first_name":"Recepción","last_name":"Local"}'),
 ('aa000000-0000-4000-8000-000000000004','recurring-other@local.test','{"first_name":"Otro","last_name":"Local"}');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('aa000000-0000-4000-8000-000000000001','admin'),('aa000000-0000-4000-8000-000000000002','doctor'),
 ('aa000000-0000-4000-8000-000000000003','recepcionista'),('aa000000-0000-4000-8000-000000000004','doctor');
INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES
 ('bb000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000002','LOCAL-D1','doctor'),
 ('bb000000-0000-4000-8000-000000000003','aa000000-0000-4000-8000-000000000003','LOCAL-R1','recepcionista'),
 ('bb000000-0000-4000-8000-000000000004','aa000000-0000-4000-8000-000000000004','LOCAL-D2','doctor');
INSERT INTO public.consulting_rooms(id,code) VALUES
 ('cc000000-0000-4000-8000-000000000001','LOCAL-FIXED-1'),('cc000000-0000-4000-8000-000000000002','LOCAL-FIXED-2');
INSERT INTO public.doctor_specialties(doctor_id,specialty_id) SELECT s.id,sp.id FROM public.staff s CROSS JOIN LATERAL (SELECT id FROM public.specialties ORDER BY id LIMIT 1)sp WHERE s.employee_code IN('LOCAL-D1','LOCAL-D2');
SELECT set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
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
 doc uuid='bb000000-0000-4000-8000-000000000002'; rec uuid='bb000000-0000-4000-8000-000000000003'; other_doc uuid='bb000000-0000-4000-8000-000000000004';
 room uuid='cc000000-0000-4000-8000-000000000001'; room2 uuid='cc000000-0000-4000-8000-000000000002'; sp bigint;
 values_rec jsonb; values_doc jsonb; result jsonb; v text; projection jsonb; future_date date; old_count integer;
BEGIN
 SELECT specialty_id INTO sp FROM public.doctor_specialties WHERE doctor_id=doc LIMIT 1;
 values_rec=jsonb_build_object('staff_id',rec,'weekdays',jsonb_build_array(1,2,3,4,5,6),'start_time','08:00','end_time','16:00','shift_type','ordinario','valid_from',d,'breaks',jsonb_build_array(jsonb_build_object('start_time','12:00','end_time','13:00','reason','Almuerzo')),'consultations','[]'::jsonb);
 result=public.save_recurring_journey(values_rec,NULL,NULL,'dd000000-0000-4000-8000-000000000001');
 projection=public.read_staff_planning(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador');
 IF (SELECT count(*) FROM jsonb_array_elements(projection->'shifts')s WHERE s->>'staff_id'=rec::text)<>6 THEN RAISE EXCEPTION 'Recepción: faltan días de la primera semana'; END IF;
 projection=public.read_staff_planning((d+364)::timestamp AT TIME ZONE 'America/El_Salvador',(d+371)::timestamp AT TIME ZONE 'America/El_Salvador');
 IF (SELECT count(*) FROM jsonb_array_elements(projection->'shifts')s WHERE s->>'staff_id'=rec::text)<>6 THEN RAISE EXCEPTION 'Recepción: no se repite indefinidamente'; END IF;
 values_doc=values_rec||jsonb_build_object('staff_id',doc,'room_id',room,'specialty_id',sp,'breaks',jsonb_build_array(jsonb_build_object('start_time','12:00','end_time','12:30','reason','Almuerzo')),'consultations',jsonb_build_array(jsonb_build_object('start_time','08:00','end_time','16:00','slot_minutes',30)));
 result=public.save_recurring_journey(values_doc,NULL,NULL,'dd000000-0000-4000-8000-000000000002');
 -- Same request key is idempotent.
 PERFORM public.save_recurring_journey(values_doc,NULL,NULL,'dd000000-0000-4000-8000-000000000002');
 IF (SELECT count(*) FROM public.get_medical_availability((d+364)::timestamp AT TIME ZONE 'America/El_Salvador',(d+365)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>15 THEN RAISE EXCEPTION 'Doctor: disponibilidad futura o descanso incorrectos'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+1)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room) WHERE (starts_at AT TIME ZONE 'America/El_Salvador')::time='12:00') THEN RAISE EXCEPTION 'Se ofreció el almuerzo'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_medical_availability((d+6)::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room)) THEN RAISE EXCEPTION 'Se ofreció un día libre'; END IF;
 -- The room remains reserved even when another doctor's work days do not coincide.
 PERFORM pg_temp.reject(format('SELECT public.save_recurring_journey(%L::jsonb,NULL,NULL,%L::uuid)',values_doc||jsonb_build_object('staff_id',other_doc,'weekdays',jsonb_build_array(0)),'dd000000-0000-4000-8000-000000000003'),'conflicting|exclusion|reservado|exclus');
 PERFORM pg_temp.reject(format('SELECT public.save_recurring_journey(%L::jsonb,NULL,NULL,%L::uuid)',values_doc||jsonb_build_object('breaks',jsonb_build_array(jsonb_build_object('start_time','07:00','end_time','08:00','reason','Fuera'))),'dd000000-0000-4000-8000-000000000004'),'dentro de la jornada');
 -- Read versions through the guarded RPC; direct SELECT is intentionally denied.
 SELECT x->>'version' INTO v FROM jsonb_array_elements(public.read_staff_planning(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador')->'recurring_journeys')x WHERE x->>'id'='dd000000-0000-4000-8000-000000000002';
 result=public.save_recurring_journey(values_doc||jsonb_build_object('valid_from',d+14,'room_id',room2),'dd000000-0000-4000-8000-000000000002',v,'dd000000-0000-4000-8000-000000000005');
 IF (SELECT count(*) FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+1)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>15 THEN RAISE EXCEPTION 'Se perdió la versión anterior'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_medical_availability((d+14)::timestamp AT TIME ZONE 'America/El_Salvador',(d+15)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room)) THEN RAISE EXCEPTION 'El consultorio viejo sigue vigente después del cambio'; END IF;
 IF (SELECT count(*) FROM public.get_medical_availability((d+14)::timestamp AT TIME ZONE 'America/El_Salvador',(d+15)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room2))<>15 THEN RAISE EXCEPTION 'Falta nueva asignación efectiva'; END IF;
 -- No authorization from receptionist role, even with forged payload.
 PERFORM set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000003',true);
 PERFORM pg_temp.reject(format('SELECT public.save_recurring_journey(%L::jsonb,NULL,NULL,%L::uuid)',values_rec,'dd000000-0000-4000-8000-000000000006'),'administración');
 PERFORM set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
 RAISE NOTICE 'PASS: recurrencia, semanas futuras, descansos, consultorio fijo, idempotencia, fecha efectiva, historial y autorización';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.staff_recurring_journeys)<>3 THEN RAISE EXCEPTION 'Hay versiones duplicadas'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_shifts) OR EXISTS(SELECT 1 FROM public.doctor_consulting_rooms) THEN RAISE EXCEPTION 'Se materializaron ocurrencias'; END IF;
END $$;
COMMIT;
-- Separate post-commit statement proves persisted definitions, not a rolled-back simulation.
SELECT count(*) AS persisted_recurring_versions FROM public.staff_recurring_journeys;
