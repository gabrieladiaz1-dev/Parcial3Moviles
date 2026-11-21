-- Isolated local database only. All identities below are synthetic.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('fa000000-0000-4000-8000-000000000001','schedule-admin@local.test'),
 ('fa000000-0000-4000-8000-000000000002','schedule-doctor@local.test');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('fa000000-0000-4000-8000-000000000001','admin'),('fa000000-0000-4000-8000-000000000002','doctor');
INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES
 ('fb000000-0000-4000-8000-000000000002','fa000000-0000-4000-8000-000000000002','LOCAL-REDESIGN','doctor');
INSERT INTO public.consulting_rooms(id,code) VALUES('fc000000-0000-4000-8000-000000000001','LOCAL-REDESIGN');
INSERT INTO public.doctor_specialties SELECT 'fb000000-0000-4000-8000-000000000002',min(id) FROM public.specialties;
INSERT INTO public.patients(id,first_name,last_name) VALUES('fe000000-0000-4000-8000-000000000001','Paciente','Local');
SELECT set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.expect_error(q text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE<>code THEN RAISE EXCEPTION 'Expected %, got %: %',code,SQLSTATE,SQLERRM; END IF; RETURN;
 END;
 RAISE EXCEPTION 'Expected rejection %',code;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE d date=(now() AT TIME ZONE 'America/El_Salvador')::date+14;
 doc uuid='fb000000-0000-4000-8000-000000000002'; room uuid='fc000000-0000-4000-8000-000000000001';
 p jsonb; j jsonb; snapshot jsonb; originals jsonb; result jsonb; op uuid; version text; first_id uuid; count_before bigint;
BEGIN
 SELECT revision INTO count_before FROM public.planning_revision;
 p=jsonb_build_object('staff_id',doc,'weekdays',jsonb_build_array(0,1,2,3,4,5,6),'start_time','08:00','end_time','16:00','shift_type','ordinario','valid_from',d,'active',true,'room_id',room,'specialty_id',(SELECT min(id) FROM public.specialties),'consultations',jsonb_build_array(jsonb_build_object('start_time','08:00','end_time','16:00','slot_minutes',30)));
 first_id=gen_random_uuid(); PERFORM public.save_recurring_journey(p,NULL,NULL,first_id);
 SELECT x INTO j FROM jsonb_array_elements(public.read_staff_planning(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador')->'recurring_journeys')x WHERE x->>'id'=first_id::text;
 version=j->>'version'; op=gen_random_uuid();
 result=public.save_recurring_journey_day(p||jsonb_build_object('valid_from',d+1,'end_time','12:00','consultations',jsonb_build_array(jsonb_build_object('start_time','08:00','end_time','12:00','slot_minutes',30))),first_id,version,op);
 IF (SELECT count(*) FROM public.get_medical_availability((d+1)::timestamp AT TIME ZONE 'America/El_Salvador',(d+2)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>8 THEN RAISE EXCEPTION 'Single date retained old hours'; END IF;
 IF (SELECT count(*) FROM public.get_medical_availability((d+8)::timestamp AT TIME ZONE 'America/El_Salvador',(d+9)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>16 THEN RAISE EXCEPTION 'Single date changed following week'; END IF;
 PERFORM pg_temp.expect_error(format('SELECT public.save_recurring_journey_day(%L,%L,%L,%L)',p||jsonb_build_object('valid_from',d+1),first_id,version,gen_random_uuid()),'40001');
 SELECT x INTO j FROM jsonb_array_elements(public.read_staff_planning(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador')->'recurring_journeys')x WHERE x->>'staff_id'=doc::text AND x->>'valid_from'=(d+2)::text;
 p=p||jsonb_build_object('valid_from',d+2);
 op=gen_random_uuid();
 PERFORM public.save_recurring_journey_day(p||jsonb_build_object('active',false),(j->>'id')::uuid,j->>'version',op);
 PERFORM public.save_recurring_journey_day(p||jsonb_build_object('active',false),(j->>'id')::uuid,j->>'version',op);
 IF EXISTS(SELECT 1 FROM public.get_medical_availability((d+2)::timestamp AT TIME ZONE 'America/El_Salvador',(d+3)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room)) THEN RAISE EXCEPTION 'Disabled day still available'; END IF;
 PERFORM pg_temp.expect_error(format('SELECT public.schedule_appointment(%L,%L,%L,%L,%L,NULL)','fe000000-0000-4000-8000-000000000001',doc,room,(d+2)::text||'T08:00:00-06:00',(d+2)::text||'T08:30:00-06:00'),'P0001');
 SELECT x INTO j FROM jsonb_array_elements(public.read_staff_planning(d::timestamp AT TIME ZONE 'America/El_Salvador',(d+7)::timestamp AT TIME ZONE 'America/El_Salvador')->'recurring_journeys')x WHERE x->>'staff_id'=doc::text AND x->>'valid_from'=(d+3)::text;
 PERFORM public.schedule_appointment('fe000000-0000-4000-8000-000000000001',doc,room,((d+3)::text||'T08:00:00-06:00')::timestamptz,((d+3)::text||'T08:30:00-06:00')::timestamptz,NULL);
 PERFORM pg_temp.expect_error(format('SELECT public.save_recurring_journey_day(%L,%L,%L,%L)',p||jsonb_build_object('valid_from',d+3,'active',false),j->>'id',j->>'version',gen_random_uuid()),'P0001');
 p=p||jsonb_build_object('valid_from',d+7,'weekdays',jsonb_build_array(extract(dow FROM d+7)::int),'end_time','12:00','consultations',jsonb_build_array(jsonb_build_object('start_time','08:00','end_time','12:00','slot_minutes',30)));
 PERFORM public.save_recurring_journey_scope(p,(j->>'id')::uuid,j->>'version',gen_random_uuid(),extract(dow FROM d+7)::int,'[]',false);
 IF (SELECT count(*) FROM public.get_medical_availability((d+14)::timestamp AT TIME ZONE 'America/El_Salvador',(d+15)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>8 THEN RAISE EXCEPTION 'Weekday series failed'; END IF;
 IF (SELECT count(*) FROM public.get_medical_availability((d+15)::timestamp AT TIME ZONE 'America/El_Salvador',(d+16)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>16 THEN RAISE EXCEPTION 'Weekday series changed another day'; END IF;
 snapshot=public.read_staff_planning((d+14)::timestamp AT TIME ZONE 'America/El_Salvador',(d+21)::timestamp AT TIME ZONE 'America/El_Salvador');
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','version',x->>'version')) INTO originals FROM jsonb_array_elements(snapshot->'recurring_journeys')x WHERE x->>'staff_id'=doc::text AND (x->>'active')::boolean AND (x->>'valid_until' IS NULL OR (x->>'valid_until')::date>=d+14);
 SELECT x INTO j FROM jsonb_array_elements(snapshot->'recurring_journeys')x WHERE x->>'id'=originals->0->>'id';
 p=p||jsonb_build_object('valid_from',d+14,'weekdays',jsonb_build_array(0,1,2,3,4,5,6));
 PERFORM public.save_recurring_journey_scope(p,(j->>'id')::uuid,j->>'version',gen_random_uuid(),NULL,originals,false);
 IF (SELECT count(*) FROM public.get_medical_availability((d+14)::timestamp AT TIME ZONE 'America/El_Salvador',(d+21)::timestamp AT TIME ZONE 'America/El_Salvador',doc,room))<>56 THEN RAISE EXCEPTION 'Complete journey retained old hours'; END IF;
 PERFORM pg_temp.expect_error(format('SELECT public.save_recurring_journey_scope(%L,%L,%L,%L,NULL,%L,false)',p,j->>'id',j->>'version',gen_random_uuid(),originals),'40001');
 IF (SELECT revision FROM public.planning_revision)<=count_before THEN RAISE EXCEPTION 'Realtime revision unchanged'; END IF;
 RAISE NOTICE 'PASS: three scopes, disabled availability/booking, appointment protection, stale versions, revision signal';
END $$;
ROLLBACK;
