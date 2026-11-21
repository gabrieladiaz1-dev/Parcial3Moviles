-- Synthetic acceptance test on the actual schema. Nothing is committed.
BEGIN;
CREATE TEMP TABLE reception_fixture(admin_id uuid, doctor_user uuid, receptionist uuid, patient_user uuid, doctor uuid, room uuid, specialty bigint, symptom bigint, request uuid, day date);
GRANT SELECT ON reception_fixture TO authenticated;
DO $$
DECLARE a uuid=gen_random_uuid(); d uuid=gen_random_uuid(); r uuid=gen_random_uuid(); p uuid=gen_random_uuid(); doc uuid=gen_random_uuid(); room uuid=gen_random_uuid(); sp bigint; sy bigint;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (a,a::text||'@reception-test.invalid','{"first_name":"Admin","last_name":"Synthetic"}'),
 (d,d::text||'@reception-test.invalid','{"first_name":"Doctor","last_name":"Synthetic"}'),
 (r,r::text||'@reception-test.invalid','{"first_name":"Recepcion","last_name":"Synthetic"}'),
 (p,p::text||'@reception-test.invalid','{"first_name":"Paciente","last_name":"Synthetic"}');
 INSERT INTO public.user_roles(user_id,role,active) VALUES(a,'admin',true),(d,'doctor',true),(r,'recepcionista',true);
 UPDATE public.user_roles SET active=false WHERE user_id IN (a,d,r) AND role='paciente';
 INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES(doc,d,'RX-'||left(doc::text,8),'doctor');
 INSERT INTO public.consulting_rooms(id,code) VALUES(room,'RX-'||left(room::text,8));
 INSERT INTO public.specialties(name) VALUES('Synthetic reception '||left(doc::text,8)) RETURNING id INTO sp;
 INSERT INTO public.doctor_specialties(doctor_id,specialty_id) VALUES(doc,sp);
 SELECT id INTO STRICT sy FROM public.symptom_catalog WHERE active LIMIT 1;
 UPDATE public.profiles SET phone='0000-0000',birth_date='1990-01-01' WHERE id=p;
 INSERT INTO reception_fixture VALUES(a,d,r,p,doc,room,sp,sy,gen_random_uuid(),current_date+10);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f reception_fixture%ROWTYPE; pid uuid; booking uuid; retry uuid; slot record; dui text; blocked boolean=false;
BEGIN
 SELECT * INTO STRICT f FROM reception_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM public.save_staff_planning('shift',jsonb_build_object('staff_id',f.doctor,'dates',jsonb_build_array(f.day),'start_time','08:00','end_time','16:00','active',true,'shift_type','ordinario'));
 PERFORM public.save_staff_planning('consultation',jsonb_build_object('staff_id',f.doctor,'dates',jsonb_build_array(f.day),'start_time','09:00','end_time','12:00','room_id',f.room,'slot_minutes',30,'active',true));
 -- Generate a non-conflicting, synthetic DUI; no real patient data is selected.
 dui=left(replace(f.patient_user::text,'-',''),8);
 dui=lpad((abs(hashtext(dui)::bigint)%100000000)::text,8,'0')||'-0';
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 PERFORM public.submit_my_attention_request(f.request,f.specialty,'manana','Solicitud sintética de aceptación',ARRAY[f.symptom],NULL,jsonb_build_object('dui',dui));
 IF NOT EXISTS(SELECT 1 FROM public.appointment_requests WHERE id=f.request AND status='pendiente') THEN RAISE EXCEPTION 'FAIL patient submission'; END IF;
 BEGIN PERFORM public.create_attention_patient(f.request,true); EXCEPTION WHEN insufficient_privilege THEN blocked=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'FAIL patient can create reception record'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.appointment_requests WHERE id=f.request) THEN RAISE EXCEPTION 'FAIL reception inbox RLS'; END IF;
 PERFORM public.review_attention_request(f.request,'en_revision');
 pid=public.create_attention_patient(f.request,true);
 IF NOT EXISTS(SELECT 1 FROM public.patients WHERE id=pid AND profile_id=f.patient_user) OR NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=pid) THEN RAISE EXCEPTION 'FAIL linked medical record'; END IF;
 SELECT * INTO STRICT slot FROM public.get_medical_availability(f.day::timestamp AT TIME ZONE 'America/El_Salvador',(f.day+1)::timestamp AT TIME ZONE 'America/El_Salvador',f.doctor) LIMIT 1;
 booking=public.schedule_appointment(pid,f.doctor,f.room,slot.starts_at,slot.ends_at,f.request);
 retry=public.schedule_appointment(pid,f.doctor,f.room,slot.starts_at,slot.ends_at,f.request);
 IF booking<>retry OR (SELECT count(*) FROM public.appointments WHERE request_id=f.request)<>1 THEN RAISE EXCEPTION 'FAIL idempotent scheduling'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.appointment_requests WHERE id=f.request AND status='agendada') THEN RAISE EXCEPTION 'FAIL request status'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.appointments WHERE id=booking AND patient_id=pid) THEN RAISE EXCEPTION 'FAIL patient appointment RLS'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.my_attention_requests()) x WHERE x->>'appointment_id'=booking::text) THEN RAISE EXCEPTION 'FAIL iOS request appointment association'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=f.patient_user AND role='paciente' AND active) THEN RAISE EXCEPTION 'FAIL patient role changed'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: iOS RPC submission, reception RLS/review, atomic record creation/link, availability, scheduling/retry, patient RLS and iOS association. All synthetic data rolled back.' result;
ROLLBACK;
