-- Controlled end-to-end contract test. Synthetic fixtures; all changes rolled back.
BEGIN;
CREATE TEMP TABLE hospital_fixture(admin_id uuid,doctor_user uuid,receptionist uuid,patient_user uuid,doctor uuid,patient1 uuid,patient2 uuid);
GRANT SELECT ON hospital_fixture TO authenticated;
DO $$
DECLARE a uuid=gen_random_uuid(); d uuid=gen_random_uuid(); r uuid=gen_random_uuid(); u uuid=gen_random_uuid(); doc uuid=gen_random_uuid(); p1 uuid=gen_random_uuid(); p2 uuid=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (a,a::text||'@hospital-test.invalid','{"first_name":"Admin","last_name":"Synthetic"}'),
 (d,d::text||'@hospital-test.invalid','{"first_name":"Doctor","last_name":"Synthetic"}'),
 (r,r::text||'@hospital-test.invalid','{"first_name":"Recepcion","last_name":"Synthetic"}'),
 (u,u::text||'@hospital-test.invalid','{"first_name":"Paciente","last_name":"Synthetic"}');
 INSERT INTO public.user_roles(user_id,role,active) VALUES(a,'admin',true),(d,'doctor',true),(r,'recepcionista',true);
 UPDATE public.user_roles SET active=false WHERE user_id IN(a,d,r) AND role='paciente';
 INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES(doc,d,'HOSP-'||left(doc::text,8),'doctor');
 INSERT INTO public.patients(id,profile_id,first_name,last_name) VALUES(p1,u,'Paciente','Synthetic Uno'),(p2,NULL,'Paciente','Synthetic Dos');
 INSERT INTO public.medical_records(patient_id) VALUES(p1),(p2);

 INSERT INTO hospital_fixture VALUES(a,d,r,u,doc,p1,p2);
END $$;
CREATE FUNCTION pg_temp.expect_failure(q text,pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM !~* pattern THEN RAISE EXCEPTION 'Unexpected failure: %, expected %',SQLERRM,pattern; END IF; RETURN;
 END;
 RAISE EXCEPTION 'Expected operation to be rejected: %',pattern;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f hospital_fixture%ROWTYPE; assessment uuid=gen_random_uuid(); rejected uuid=gen_random_uuid(); patient3 uuid; result jsonb; admission uuid; room uuid; bed uuid;
BEGIN
 SELECT * INTO STRICT f FROM hospital_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 patient3=public.create_walkin_patient('Synthetic','Assessment rejection',NULL,NULL,NULL,NULL);
 PERFORM public.reception_request_admission_assessment(f.patient2,f.doctor,'Synthetic physical assessment','normal',assessment);
 IF assessment<>public.reception_request_admission_assessment(f.patient2,f.doctor,'Synthetic physical assessment','normal',assessment) THEN RAISE EXCEPTION 'FAIL assessment retry'; END IF;
 result=public.admission_assessment_context(f.patient2,0);
 IF result->'items'->0->>'status'<>'pending' OR result->'items'->0->>'admission_id' IS NOT NULL THEN RAISE EXCEPTION 'FAIL pending without admission'; END IF;
 PERFORM pg_temp.expect_failure(format('select public.doctor_decide_admission_assessment(%L,0,''approved'',''Forged'',''vip'',NULL)',assessment),'doctor');
 PERFORM pg_temp.expect_failure(format('select public.reception_request_admission_assessment(%L,%L,''Duplicate'',''normal'',%L)',f.patient2,f.doctor,gen_random_uuid()),'pendiente');
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 PERFORM pg_temp.expect_failure('select public.admission_assessment_context(NULL,0)','doctor');
 IF EXISTS(SELECT 1 FROM public.patients WHERE id=f.patient2) THEN RAISE EXCEPTION 'FAIL other patient privacy'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 result=public.admission_assessment_context(NULL,0);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'items') x WHERE x->>'id'=assessment::text) THEN RAISE EXCEPTION 'FAIL doctor queue'; END IF;
 result=public.doctor_native_chart(f.patient2,NULL,NULL,'');
 IF result->'patient'->>'id'<>f.patient2::text THEN RAISE EXCEPTION 'FAIL assigned chart'; END IF;
 PERFORM pg_temp.expect_failure(format('select public.doctor_native_chart(%L,NULL,NULL,'''')',f.patient1),'asignado');
 IF public.doctor_save_admission_assessment(assessment,0,'Synthetic assessment')<>1 THEN RAISE EXCEPTION 'FAIL saved assessment'; END IF;
 PERFORM pg_temp.expect_failure(format('select public.doctor_save_admission_assessment(%L,0,''stale'')',assessment),'cambi');
 result=public.doctor_decide_admission_assessment(assessment,1,'approved','Synthetic clinical approval','vip','Synthetic instruction');
 admission=(result->>'admission_id')::uuid;
 IF admission IS NULL OR result<>public.doctor_decide_admission_assessment(assessment,1,'approved','Synthetic clinical approval','vip','Synthetic instruction') THEN RAISE EXCEPTION 'FAIL approval retry'; END IF;
 IF EXISTS(SELECT 1 FROM public.appointments WHERE patient_id=f.patient2) OR EXISTS(SELECT 1 FROM public.clinical_encounters e JOIN public.medical_records m ON m.id=e.record_id WHERE m.patient_id=f.patient2) THEN RAISE EXCEPTION 'FAIL fictitious appointment/encounter'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 room=public.save_hospital_room('AS-'||left(assessment::text,8),2::smallint,'vip',true);
 bed=public.save_hospital_bed(room,'AS-B-'||left(assessment::text,8),'disponible',true);
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 result=public.admission_assessment_context(f.patient2,0);
 IF result->'items'->0->>'status'<>'approved' OR result->'items'->0->>'assessment' IS NOT NULL THEN RAISE EXCEPTION 'FAIL reception decision/privacy'; END IF;
 PERFORM public.assign_bed(admission,bed);
 PERFORM public.reception_request_admission_assessment(patient3,f.doctor,'Synthetic second physical assessment','urgente',rejected);
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 result=public.doctor_decide_admission_assessment(rejected,0,'rejected','Synthetic clinical rejection',NULL,NULL);
 IF result->>'admission_id' IS NOT NULL THEN RAISE EXCEPTION 'FAIL rejected admission'; END IF;
 PERFORM pg_temp.expect_failure(format('select public.doctor_native_chart(%L,NULL,NULL,'''')',patient3),'asignado');
 PERFORM pg_temp.expect_failure(format('select public.doctor_decide_admission_assessment(%L,0,''approved'',''Changed'',''vip'',NULL)',rejected),'resuelta|cambi');
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 IF EXISTS(SELECT 1 FROM public.hospital_admissions WHERE patient_id=patient3) OR EXISTS(SELECT 1 FROM public.bed_assignments WHERE patient_id=patient3) THEN RAISE EXCEPTION 'FAIL rejection allowed bed'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE recipient_id=f.receptionist AND event_key='assessment:'||assessment::text||':decided')<>1 THEN RAISE EXCEPTION 'FAIL duplicate notification'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: physical queue without appointment, assigned chart, notes/version, physician-only approval/rejection, real bed, no fake encounter, rejection revokes access, retry/notifications' AS result;
ROLLBACK;
