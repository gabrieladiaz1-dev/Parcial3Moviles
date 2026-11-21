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
 INSERT INTO public.care_team_assignments(patient_id,staff_id) VALUES(p1,doc),(p2,doc);
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
DECLARE f hospital_fixture%ROWTYPE; room uuid; bed uuid; admission uuid; second_admission uuid; k uuid=gen_random_uuid(); result jsonb; saved uuid;
BEGIN
 SELECT * INTO STRICT f FROM hospital_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 room=public.save_hospital_room('TEST-'||left(k::text,8),2::smallint,'vip',true);
 bed=public.save_hospital_bed(room,'TEST-BED-'||left(k::text,8),'disponible',true);
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 admission=public.doctor_native_admission_request(f.patient1,'vip','Motivo sintético de hospitalización','Indicaciones sintéticas','urgente',NULL,k);
 IF admission<>public.doctor_native_admission_request(f.patient1,'vip','Motivo sintético de hospitalización','Indicaciones sintéticas','urgente',NULL,k) THEN RAISE EXCEPTION 'FAIL doctor retry'; END IF;
 second_admission=public.doctor_native_admission_request(f.patient2,'vip','Segundo paciente sintético',NULL,'normal',NULL,gen_random_uuid());
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.hospital_admissions WHERE id=admission) THEN RAISE EXCEPTION 'FAIL reception RLS'; END IF;
 result=public.reception_hospital_detail(admission);
 IF result->>'record_number' IS NULL THEN RAISE EXCEPTION 'FAIL record verification'; END IF;
 PERFORM public.reception_review_admission(admission);
 IF (public.reception_hospital_detail(admission)->>'reviewed_at') IS NULL THEN RAISE EXCEPTION 'FAIL review'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.reception_admission_availability(admission)->'beds') b WHERE b->>'bed_id'=bed::text) THEN RAISE EXCEPTION 'FAIL availability'; END IF;
 PERFORM public.reception_resolve_admission(admission,'asignar',NULL,bed);
 PERFORM public.reception_resolve_admission(admission,'asignar',NULL,bed);
 IF (SELECT count(*) FROM public.bed_assignments WHERE admission_id=admission AND released_at IS NULL)<>1 OR NOT EXISTS(SELECT 1 FROM public.beds WHERE id=bed AND state='ocupada') THEN RAISE EXCEPTION 'FAIL assignment/retry'; END IF;
 PERFORM pg_temp.expect_failure(format('select public.reception_resolve_admission(%L,''asignar'',NULL,%L)',second_admission,bed),'no.*disponible');
 PERFORM pg_temp.expect_failure(format('select public.release_bed(%L)',admission),'alta médica');
 PERFORM pg_temp.expect_failure(format('select public.medical_discharge(%L,NULL)',admission),'doctor activo');
 PERFORM pg_temp.expect_failure(format('select public.save_hospital_bed(%L,%L,''disponible'',true,NULL,%L)',room,'RX',bed),'Solo administración');
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM pg_temp.expect_failure(format('select public.save_hospital_room(%L,2::smallint,''vip'',false,%L)','RX',room),'hospitalización activa');
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 result=public.doctor_native_admissions();
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'items') x WHERE x->>'id'=admission::text AND x->>'status'='hospitalizado' AND x->'assignment'->>'bed'='TEST-BED-'||left(k::text,8)) THEN RAISE EXCEPTION 'FAIL doctor sees assignment'; END IF;
 PERFORM public.medical_discharge(admission,'Alta sintética autorizada');
 IF NOT EXISTS(SELECT 1 FROM public.beds WHERE id=bed AND state='ocupada') THEN RAISE EXCEPTION 'FAIL medical discharge released bed'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 PERFORM public.release_bed(admission);
 PERFORM public.release_bed(admission);
 IF NOT EXISTS(SELECT 1 FROM public.beds WHERE id=bed AND state='limpieza') OR (public.reception_hospital_detail(admission)->>'closed_by') IS DISTINCT FROM f.receptionist::text THEN RAISE EXCEPTION 'FAIL exit and cleaning'; END IF;
 PERFORM public.complete_hospital_bed_cleaning(bed);
 IF NOT EXISTS(SELECT 1 FROM public.beds WHERE id=bed AND state='disponible') THEN RAISE EXCEPTION 'FAIL cleaned bed'; END IF;
 PERFORM public.reception_resolve_admission(second_admission,'rechazar','Rechazo sintético de aceptación',NULL);
 IF (public.reception_hospital_detail(second_admission)->>'decision') IS DISTINCT FROM 'rechazada' THEN RAISE EXCEPTION 'FAIL rejection'; END IF;
 -- Admin maintenance and out-of-service do not make beds assignable.
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM public.save_hospital_bed(room,'TEST-BED-'||left(k::text,8),'mantenimiento',false,'Mantenimiento sintético',bed);
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_type='beds' AND entity_id=bed::text AND action='inventario_hospitalario') THEN RAISE EXCEPTION 'FAIL inventory audit'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 PERFORM pg_temp.expect_failure('select public.reception_hospital_inventory()','No autorizado');
 PERFORM pg_temp.expect_failure(format('select public.reception_hospital_detail(%L)',admission),'No autorizado');
 IF EXISTS(SELECT 1 FROM public.hospital_admissions WHERE id=second_admission) THEN RAISE EXCEPTION 'FAIL patient isolation'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: doctor request/retry → reception/review/record → availability → admission/occupied bed → doctor visibility → medical discharge without release → administrative exit/cleaning → clean/available. Duplicate assignment, unauthorized discharge/inventory and patient isolation rejected. Synthetic data rolled back.' result;
ROLLBACK;
