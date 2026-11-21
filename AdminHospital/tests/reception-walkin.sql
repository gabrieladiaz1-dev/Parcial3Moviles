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

CREATE FUNCTION pg_temp.reject(q text,pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN IF SQLERRM !~* pattern THEN RAISE EXCEPTION 'Unexpected: %, expected %',SQLERRM,pattern; END IF; RETURN; END;
 RAISE EXCEPTION 'Expected rejection: %',pattern;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f reception_fixture%ROWTYPE; pid uuid; p2 uuid; document_value text; payload jsonb; result jsonb; slot record; v_key uuid=gen_random_uuid(); hospital_key uuid=gen_random_uuid(); room uuid; bed uuid; admission uuid; shift_start timestamptz; shift_end timestamptz; care_start timestamptz; care_end timestamptz; hospital_day date; notices bigint;
BEGIN
 SELECT * INTO STRICT f FROM reception_fixture;
 document_value=lpad((abs(hashtext(f.patient_user::text)::bigint)%100000000)::text,8,'0')||'-0';
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 pid=public.create_walkin_patient('Paciente','Synthetic',replace(document_value,'-',''),'0000-0000','1990-01-01','Synthetic city',' Patient@Example.invalid ');
 IF NOT EXISTS(SELECT 1 FROM public.patients WHERE id=pid AND email='patient@example.invalid' AND city='Synthetic city') THEN RAISE EXCEPTION 'FAIL email or city persistence'; END IF;
 IF pid<>public.create_walkin_patient('Paciente','Synthetic',document_value,'0000-0000','1990-01-01','Synthetic city') THEN RAISE EXCEPTION 'FAIL duplicate record retry'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.patients WHERE id=pid AND profile_id IS NULL AND dui=document_value) OR (SELECT count(*) FROM public.medical_records WHERE patient_id=pid)<>1 THEN RAISE EXCEPTION 'FAIL physical record'; END IF;
 PERFORM pg_temp.reject(format('select public.create_walkin_patient(''Other'',''Name'',%L,NULL,NULL,NULL)',document_value),'existe');
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM public.save_staff_planning('shift',jsonb_build_object('staff_id',f.doctor,'dates',jsonb_build_array(f.day),'start_time','08:00','end_time','16:00','active',true,'shift_type','ordinario'));
 PERFORM public.save_staff_planning('consultation',jsonb_build_object('staff_id',f.doctor,'dates',jsonb_build_array(f.day),'start_time','09:00','end_time','12:00','room_id',f.room,'slot_minutes',30,'active',true));
 SELECT * INTO STRICT slot FROM public.get_medical_availability(f.day::timestamp AT TIME ZONE 'America/El_Salvador',(f.day+1)::timestamp AT TIME ZONE 'America/El_Salvador',f.doctor) LIMIT 1;
 payload=jsonb_build_object('mode','scheduled','specialty_id',f.specialty,'doctor_id',f.doctor,'room_id',f.room,'starts_at',slot.starts_at,'ends_at',slot.ends_at,'reason','Synthetic physical appointment','symptoms','','priority','normal','identity_confirmed',true);
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 result=public.reception_walkin_attention(pid,v_key,payload);
 IF result<>public.reception_walkin_attention(pid,v_key,payload) THEN RAISE EXCEPTION 'FAIL booking retry'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.appointments WHERE id=(result->>'appointment_id')::uuid AND status='programada') OR EXISTS(SELECT 1 FROM public.clinical_encounters WHERE appointment_id=(result->>'appointment_id')::uuid) THEN RAISE EXCEPTION 'FAIL doctor workflow bypassed'; END IF;
 PERFORM pg_temp.reject(format('select public.reception_walkin_attention(%L,%L,%L::jsonb)',pid,gen_random_uuid(),payload),'ocup|disponib|conflic|solap|exclu');
 PERFORM pg_temp.reject(format('select public.reception_walkin_attention(%L,%L,%L::jsonb)',pid,gen_random_uuid(),payload||'{"identity_confirmed":false}'),'identidad');
 -- Native request linking must not disclose or bind merely because a DUI matches.
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF EXISTS(SELECT 1 FROM public.patients WHERE id=pid) OR EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=pid) THEN RAISE EXCEPTION 'FAIL unverified owner sees record'; END IF;
 PERFORM pg_temp.reject(format('select public.reception_walkin_attention(%L,%L,%L::jsonb)',pid,gen_random_uuid(),payload),'autorizado');
 PERFORM public.submit_my_attention_request(f.request,f.specialty,'manana','Synthetic future identity request',ARRAY[f.symptom],NULL,jsonb_build_object('dui',document_value));
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 PERFORM pg_temp.reject(format('select public.link_attention_patient(%L,%L,false)',f.request,pid),'identidad');
 PERFORM public.link_attention_patient(f.request,pid,true);
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=pid) OR NOT EXISTS(SELECT 1 FROM public.appointments WHERE id=(result->>'appointment_id')::uuid) THEN RAISE EXCEPTION 'FAIL verified future iOS read'; END IF;

 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 PERFORM pg_temp.reject(format('select public.reception_walkin_attention(%L,%L,%L::jsonb)',pid,gen_random_uuid(),payload||'{"mode":"admission","medical_indication_confirmed":true}'),'autoriz|cuenta');
 PERFORM pg_temp.reject(format('select public.create_walkin_patient(''Invalid'',''Email'',%L,NULL,NULL,NULL,''bad@email'')',document_value),'Correo');
 PERFORM pg_temp.reject(format('select public.create_walkin_patient(''Invalid'',''Phone'',%L,''invalid'',NULL,NULL,NULL)',document_value),'fono');
 PERFORM pg_temp.reject(format('select public.create_walkin_patient(''Invalid'',''Birth'',%L,NULL,%L,NULL,NULL)',document_value,current_date+1),'nacimiento');
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 admission=public.doctor_native_admission_request(pid,'vip','Synthetic authenticated indication',NULL,'normal',NULL,gen_random_uuid());
 IF admission IS NULL THEN RAISE EXCEPTION 'FAIL authenticated physician admission'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 PERFORM pg_temp.reject(format('select public.create_walkin_patient(''Patient'',''Denied'',%L,NULL,NULL,NULL,NULL)',document_value),'autorizado');
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: physical record/no account, normalized DUI/retry, appointment/no clinical bypass, availability conflict, email/city persistence, validation, receptionist admission denied, authenticated physician admission, future identity verification/RLS' AS result;
ROLLBACK;
