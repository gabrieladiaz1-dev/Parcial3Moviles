-- LOCAL DATABASE ONLY. All employees, patients and appointments below are synthetic.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('00000000-0000-4000-8000-000000000001','admin@local.test','{"first_name":"Admin","last_name":"Prueba"}'),
 ('00000000-0000-4000-8000-000000000002','doctor@local.test','{"first_name":"Doctor","last_name":"Uno"}'),
 ('00000000-0000-4000-8000-000000000003','reception@local.test','{"first_name":"Recepción","last_name":"Prueba"}'),
 ('00000000-0000-4000-8000-000000000004','nurse@local.test','{"first_name":"Enfermera","last_name":"Prueba"}'),
 ('00000000-0000-4000-8000-000000000005','doctor2@local.test','{"first_name":"Doctor","last_name":"Dos"}'),
 ('00000000-0000-4000-8000-000000000006','patient@local.test','{"first_name":"Paciente","last_name":"Sintético"}');
INSERT INTO public.user_roles(user_id,role) VALUES ('00000000-0000-4000-8000-000000000001','admin');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT public.set_employee_role('00000000-0000-4000-8000-000000000002','doctor',true);
SELECT public.set_employee_role('00000000-0000-4000-8000-000000000003','recepcionista',true);
SELECT public.set_employee_role('00000000-0000-4000-8000-000000000004','enfermera',true);
SELECT public.set_employee_role('00000000-0000-4000-8000-000000000005','doctor',true);
INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','D1','doctor'),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','R1','recepcionista'),
 ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','N1','enfermera'),
 ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000005','D2','doctor');
INSERT INTO public.consulting_rooms(id,code) VALUES
 ('30000000-0000-4000-8000-000000000001','TEST-01'),
 ('30000000-0000-4000-8000-000000000002','TEST-02'),
 ('30000000-0000-4000-8000-000000000003','TEST-03');
INSERT INTO public.patients(id,first_name,last_name,phone) VALUES
 ('20000000-0000-4000-8000-000000000001','Paciente','Sintético','00000000');

CREATE FUNCTION pg_temp.reject(p_query text,p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE p_query;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM !~* p_pattern THEN RAISE EXCEPTION 'Unexpected error: %, expected %',SQLERRM,p_pattern; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'Expected rejection: %',p_pattern;
END $$;
CREATE FUNCTION pg_temp.save(p_kind text,p_staff uuid,p_day date,p_start text,p_end text,p_room uuid DEFAULT NULL,p_minutes integer DEFAULT 30,p_id uuid DEFAULT NULL,p_version text DEFAULT NULL,p_active boolean DEFAULT true,p_reason text DEFAULT 'Ausencia: Prueba') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.save_staff_planning(p_kind,jsonb_build_object('staff_id',p_staff,'dates',jsonb_build_array(p_day),'start_time',p_start,'end_time',p_end,'room_id',p_room,'slot_minutes',p_minutes,'active',p_active,'shift_type','ordinario','reason',p_reason),p_id,p_version)
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
 d date:=current_date+7; d1 uuid:='10000000-0000-4000-8000-000000000002';
 d2 uuid:='10000000-0000-4000-8000-000000000005'; n uuid:='10000000-0000-4000-8000-000000000004';
 r uuid:='10000000-0000-4000-8000-000000000003'; room1 uuid:='30000000-0000-4000-8000-000000000001';
 room2 uuid:='30000000-0000-4000-8000-000000000002'; room3 uuid:='30000000-0000-4000-8000-000000000003';
 shift_id uuid; consultation_id uuid; version text; booking uuid; amount integer;
 midnight_start timestamptz; weekly jsonb;
BEGIN
 shift_id:=(pg_temp.save('shift',d1,d,'08:00','16:00')->>'id')::uuid;
 PERFORM pg_temp.save('shift',d2,d,'08:00','16:00');
 PERFORM pg_temp.save('shift',r,d,'08:00','16:00');
 PERFORM pg_temp.save('shift',n,d,'22:00','06:00');
 IF NOT EXISTS(SELECT 1 FROM public.staff_shifts WHERE staff_id=n AND ends_at-starts_at=interval '8 hours') THEN RAISE EXCEPTION 'FAIL overnight shift'; END IF;
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L)','shift',d1,d,'09:00','17:00'),'conflicting|exclusion|solap');
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,%L)','consultation',d1,d,'07:00','09:00',room1),'dentro del horario');
 consultation_id:=(pg_temp.save('consultation',d1,d,'09:00','12:00',room1)->>'id')::uuid;
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,%L)','consultation',d2,d,'09:00','11:00',room1),'conflicting|exclusion|solap');
 PERFORM pg_temp.save('consultation',d2,d,'09:00','11:00',room2);
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,%L)','consultation',d1,d,'09:30','11:00',room3),'conflicting|exclusion|solap');
 SELECT count(*) INTO amount FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/Guatemala',(d+1)::timestamp AT TIME ZONE 'America/Guatemala',d1);
 IF amount<>6 THEN RAISE EXCEPTION 'FAIL: expected 6 slots, got %',amount; END IF;
 PERFORM pg_temp.save('absence',d1,d,'10:00','10:30',NULL,30,NULL,NULL,true,'Descanso: Almuerzo');
 SELECT count(*) INTO amount FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/Guatemala',(d+1)::timestamp AT TIME ZONE 'America/Guatemala',d1);
 IF amount<>5 THEN RAISE EXCEPTION 'FAIL: break did not remove slot (%)',amount; END IF;
 booking:=public.schedule_appointment('20000000-0000-4000-8000-000000000001',d1,room1,(d+time '09:00') AT TIME ZONE 'America/Guatemala',(d+time '09:30') AT TIME ZONE 'America/Guatemala');
 PERFORM public.update_appointment_status(booking,'confirmada');
 SELECT count(*) INTO amount FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/Guatemala',(d+1)::timestamp AT TIME ZONE 'America/Guatemala',d1);
 IF amount<>4 THEN RAISE EXCEPTION 'FAIL: booked slot visible (%)',amount; END IF;
 PERFORM pg_temp.reject(format('select public.schedule_appointment(%L,%L,%L,%L,%L)','20000000-0000-4000-8000-000000000001',d1,room1,(d+time '09:15') AT TIME ZONE 'America/Guatemala',(d+time '09:45') AT TIME ZONE 'America/Guatemala'),'disponibilidad');
 PERFORM pg_temp.reject(format('select public.schedule_appointment(%L,%L,%L,%L,%L)','20000000-0000-4000-8000-000000000001',d1,room1,(d+time '10:00') AT TIME ZONE 'America/Guatemala',(d+time '10:30') AT TIME ZONE 'America/Guatemala'),'disponibilidad');
 PERFORM pg_temp.reject(format('select public.schedule_appointment(%L,%L,%L,%L,%L)','20000000-0000-4000-8000-000000000001',d1,room1,(d+time '10:30') AT TIME ZONE 'America/Guatemala',(d+time '11:30') AT TIME ZONE 'America/Guatemala'),'disponibilidad');
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L)','absence',d1,d,'09:00','09:30'),'Conflicto con citas');
 SELECT c.xmin::text INTO version FROM public.doctor_consulting_rooms c WHERE id=consultation_id;
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,%L,30,%L,%L)','consultation',d1,d,'09:30','12:00',room1,consultation_id,version),'Conflicto con citas');
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,%L,15,%L,%L)','consultation',d1,d,'09:00','12:00',room1,consultation_id,version),'Conflicto con citas');
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,%L,30,%L,%L,false)','consultation',d1,d,'09:00','12:00',room1,consultation_id,version),'Conflicto con citas');
 SELECT s.xmin::text INTO version FROM public.staff_shifts s WHERE id=shift_id;
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,NULL,30,%L,%L,false)','shift',d1,d,'08:00','16:00',shift_id,version),'dentro del horario');
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L,NULL,30,%L,%L)','shift',d1,d,'08:00','16:00',shift_id,'stale'),'registro cambió');
 -- Repeating batches must roll back their successful first item on any conflict.
 SELECT count(*) INTO amount FROM public.staff_shifts WHERE staff_id=n;
 PERFORM pg_temp.reject(format('select public.save_staff_planning(%L,%L::jsonb)','shift',jsonb_build_object('staff_id',n,'dates',jsonb_build_array(d-1,d),'start_time','22:00','end_time','06:00','shift_type','ordinario','active',true)),'conflicting|exclusion|solap');
 IF amount<>(SELECT count(*) FROM public.staff_shifts WHERE staff_id=n) THEN RAISE EXCEPTION 'FAIL: partial batch'; END IF;
 -- Overnight consultation and a slot ending exactly at midnight.
 PERFORM pg_temp.save('shift',d1,d+2,'22:00','06:00');
 PERFORM pg_temp.save('consultation',d1,d+2,'23:30','01:30',room1);
 midnight_start:=((d+2)+time '23:30') AT TIME ZONE 'America/Guatemala';
 PERFORM public.schedule_appointment('20000000-0000-4000-8000-000000000001',d1,room1,midnight_start,midnight_start+interval '30 minutes');
 SELECT count(*) INTO amount FROM public.get_medical_availability((d+2)::timestamp AT TIME ZONE 'America/Guatemala',(d+4)::timestamp AT TIME ZONE 'America/Guatemala',d1);
 IF amount<>3 THEN RAISE EXCEPTION 'FAIL overnight slots (%)',amount; END IF;
 -- No-booking sessions can be disabled and reactivated without reviving old versions.
 SELECT a.id,a.xmin::text INTO consultation_id,version FROM public.doctor_consulting_rooms a WHERE doctor_id=d2 AND active;
 PERFORM pg_temp.save('consultation',d2,d,'09:00','11:00',room2,30,consultation_id,version,false);
 SELECT count(*) INTO amount FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/Guatemala',(d+1)::timestamp AT TIME ZONE 'America/Guatemala',d2);
 IF amount<>0 THEN RAISE EXCEPTION 'FAIL disabled consultation still available'; END IF;
 SELECT a.xmin::text INTO version FROM public.doctor_consulting_rooms a WHERE id=consultation_id;
 PERFORM pg_temp.save('consultation',d2,d,'09:00','11:00',room2,30,consultation_id,version,true);
 SELECT count(*) INTO amount FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/Guatemala',(d+1)::timestamp AT TIME ZONE 'America/Guatemala',d2);
 IF amount<>4 THEN RAISE EXCEPTION 'FAIL reactivated consultation (%)',amount; END IF;
 -- Real table privileges apply to room management too.
 PERFORM public.save_staff_planning('room','{"code":"TEST-04","active":true}'::jsonb);
 PERFORM pg_temp.reject('select public.save_staff_planning(''room'',''{"code":"TEST-04","active":true}''::jsonb)','duplicate|unique');
 SELECT a.xmin::text INTO version FROM public.consulting_rooms a WHERE id=room3;
 PERFORM public.save_staff_planning('room',jsonb_build_object('code','TEST-03','active',false),room3,version);
 weekly:=public.read_staff_planning(d::timestamp AT TIME ZONE 'America/Guatemala',(d+7)::timestamp AT TIME ZONE 'America/Guatemala');
 IF jsonb_array_length(weekly->'staff')<>4 OR weekly->>'ready'<>'true' THEN RAISE EXCEPTION 'FAIL planning payload'; END IF;
 -- Synthetic doctor can read own schedules only and cannot mutate any planning.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 IF EXISTS(SELECT 1 FROM public.doctor_consulting_rooms WHERE doctor_id<>d1) OR EXISTS(SELECT 1 FROM public.staff_shifts WHERE staff_id<>d1) THEN RAISE EXCEPTION 'FAIL RLS doctor isolation'; END IF;
 PERFORM pg_temp.reject(format('select pg_temp.save(%L,%L,%L,%L,%L)','shift',d1,d+4,'08:00','16:00'),'Solo administración');
 PERFORM pg_temp.reject('select public.read_staff_planning(now(),now()+interval ''7 days'')','Solo administración');
 -- Reception sees medical availability but cannot read sensitive absence reasons.
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 IF EXISTS(SELECT 1 FROM public.staff_absences WHERE staff_id=d1) THEN RAISE EXCEPTION 'FAIL reception absence privacy'; END IF;
 SELECT count(*) INTO amount FROM public.get_medical_availability(d::timestamp AT TIME ZONE 'America/Guatemala',(d+1)::timestamp AT TIME ZONE 'America/Guatemala',d1);
 IF amount<>4 THEN RAISE EXCEPTION 'FAIL reception availability'; END IF;
 PERFORM pg_temp.reject(format('insert into public.staff_shifts(staff_id,starts_at,ends_at) values(%L,%L,%L)',r,((d+3)+time '08:00') AT TIME ZONE 'America/Guatemala',((d+3)+time '16:00') AT TIME ZONE 'America/Guatemala'),'row-level security');
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
 PERFORM pg_temp.reject('select * from public.get_medical_availability(now(),now()+interval ''7 days'')','No autorizado');
END $$;
DO $$
DECLARE actor text; t text; field text; changed bigint;
 doc uuid:='10000000-0000-4000-8000-000000000002'; room uuid:='30000000-0000-4000-8000-000000000001'; d date:=current_date+30;
BEGIN
 FOREACH actor IN ARRAY ARRAY['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000006'] LOOP
  PERFORM set_config('request.jwt.claim.sub',actor,true);
  PERFORM pg_temp.reject('select public.save_staff_planning(''room'',''{"code":"UNAUTHORIZED"}''::jsonb)','Solo administración');
  PERFORM pg_temp.reject(format('insert into public.staff_shifts(staff_id,starts_at,ends_at) values(%L,%L,%L)',doc,(d+time '08:00') AT TIME ZONE 'America/Guatemala',(d+time '16:00') AT TIME ZONE 'America/Guatemala'),'row-level security');
  PERFORM pg_temp.reject(format('insert into public.staff_absences(staff_id,starts_at,ends_at,reason) values(%L,%L,%L,%L)',doc,(d+time '12:00') AT TIME ZONE 'America/Guatemala',(d+time '13:00') AT TIME ZONE 'America/Guatemala','TEST'),'row-level security');
  PERFORM pg_temp.reject(format('insert into public.doctor_schedules(doctor_id,weekday,start_time,end_time,valid_from,valid_until,active) values(%L,1,%L,%L,%L,%L,false)',doc,'08:00','09:00',d,d),'row-level security');
  PERFORM pg_temp.reject(format('insert into public.doctor_consulting_rooms(doctor_id,consulting_room_id,starts_at,ends_at,active) values(%L,%L,%L,%L,false)',doc,room,(d+time '08:00') AT TIME ZONE 'America/Guatemala',(d+time '16:00') AT TIME ZONE 'America/Guatemala'),'row-level security');
  PERFORM pg_temp.reject('insert into public.consulting_rooms(code) values(''UNAUTHORIZED'')','row-level security');
  FOREACH t IN ARRAY ARRAY['staff_shifts','staff_absences','doctor_schedules','doctor_consulting_rooms','consulting_rooms'] LOOP
   field:=CASE WHEN t='staff_shifts' THEN 'status' ELSE 'active' END;
   EXECUTE format('update public.%I set %I=%I',t,field,field);
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>0 THEN RAISE EXCEPTION 'FAIL unauthorized update: % %',actor,t; END IF;
   EXECUTE format('delete from public.%I',t);
   GET DIAGNOSTICS changed=ROW_COUNT;
   IF changed<>0 THEN RAISE EXCEPTION 'FAIL unauthorized delete: % %',actor,t; END IF;
  END LOOP;
 END LOOP;
 IF has_function_privilege('anon','public.save_staff_planning(text,jsonb,uuid,text)','execute') OR
    has_function_privilege('anon','public.get_medical_availability(timestamptz,timestamptz,uuid,uuid)','execute') OR
    has_function_privilege('authenticated','private.planning_guard()','execute') THEN RAISE EXCEPTION 'FAIL function ACL'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS scheduling, overnight shifts/consultations, slots, breaks, room collisions, appointment protection, batch rollback, stale edits, RLS and privacy' result;
ROLLBACK;
