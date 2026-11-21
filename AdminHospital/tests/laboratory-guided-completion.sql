-- Native doctor -> laboratory -> authorized publication. Synthetic data; no commits.
BEGIN;
CREATE TEMP TABLE laboratory_fixture(admin_id uuid,processor uuid,validator uuid,doctor_user uuid,other_doctor uuid,patient_user uuid,other_patient uuid,processor_staff uuid,validator_staff uuid,doctor_staff uuid,encounter uuid,patient uuid,test1 bigint,test2 bigint);
GRANT SELECT ON laboratory_fixture TO authenticated;
DO $$
DECLARE a uuid=gen_random_uuid(); p uuid=gen_random_uuid(); v uuid=gen_random_uuid(); d uuid=gen_random_uuid(); od uuid=gen_random_uuid(); u uuid=gen_random_uuid(); ou uuid=gen_random_uuid();
 ps uuid=gen_random_uuid(); vs uuid=gen_random_uuid(); ds uuid=gen_random_uuid(); ods uuid=gen_random_uuid(); patient uuid=gen_random_uuid(); other uuid=gen_random_uuid(); record_id uuid; other_record uuid; room uuid=gen_random_uuid(); room2 uuid=gen_random_uuid(); ap uuid; encounter uuid; t1 bigint; t2 bigint; day date=current_date+10;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (a,a::text||'@laboratory-test.invalid','{"first_name":"Admin","last_name":"Synthetic"}'),
 (p,p::text||'@laboratory-test.invalid','{"first_name":"Processor","last_name":"Synthetic"}'),
 (v,v::text||'@laboratory-test.invalid','{"first_name":"Validator","last_name":"Synthetic"}'),
 (d,d::text||'@laboratory-test.invalid','{"first_name":"Doctor","last_name":"Synthetic"}'),
 (od,od::text||'@laboratory-test.invalid','{"first_name":"Other Doctor","last_name":"Synthetic"}'),
 (u,u::text||'@laboratory-test.invalid','{"first_name":"Patient","last_name":"Synthetic"}'),
 (ou,ou::text||'@laboratory-test.invalid','{"first_name":"Other Patient","last_name":"Synthetic"}');
 INSERT INTO public.user_roles(user_id,role,active) VALUES(a,'admin',true),(p,'enfermera',true),(v,'enfermera',true),(d,'doctor',true),(od,'doctor',true);
 UPDATE public.user_roles SET active=false WHERE user_id IN(a,p,v,d,od) AND role='paciente';
 INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES(ps,p,'L-P-'||left(p::text,8),'enfermera'),(vs,v,'L-V-'||left(v::text,8),'enfermera'),(ds,d,'L-D-'||left(d::text,8),'doctor'),(ods,od,'L-OD-'||left(od::text,8),'doctor');
 INSERT INTO public.patients(id,profile_id,first_name,last_name) VALUES(patient,u,'Patient','Laboratory Synthetic'),(other,ou,'Other Patient','Laboratory Synthetic');
 INSERT INTO public.medical_records(patient_id) VALUES(patient) RETURNING id INTO record_id;
 INSERT INTO public.medical_records(patient_id) VALUES(other) RETURNING id INTO other_record;
 INSERT INTO public.consulting_rooms(id,code) VALUES(room,'L-'||left(room::text,8)),(room2,'L-'||left(room2::text,8));
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM public.save_staff_planning('shift',jsonb_build_object('staff_id',ds,'dates',jsonb_build_array(day),'start_time','08:00','end_time','16:00','active',true,'shift_type','ordinario'));
 PERFORM public.save_staff_planning('consultation',jsonb_build_object('staff_id',ds,'dates',jsonb_build_array(day),'start_time','09:00','end_time','12:00','room_id',room,'slot_minutes',30,'active',true));
 INSERT INTO public.appointments(patient_id,doctor_id,consulting_room_id,starts_at,ends_at,status,created_by) VALUES(patient,ds,room,(day+time '09:00') AT TIME ZONE 'America/El_Salvador',(day+time '09:30') AT TIME ZONE 'America/El_Salvador','en_atencion',a) RETURNING id INTO ap;
 INSERT INTO public.clinical_encounters(record_id,appointment_id,doctor_id) VALUES(record_id,ap,ds) RETURNING id INTO encounter;
 INSERT INTO public.lab_test_types(name,description) VALUES('Synthetic structured '||left(a::text,8),'Synthetic acceptance test only') RETURNING id INTO t1;
 INSERT INTO public.lab_test_types(name,description) VALUES('Synthetic descriptive '||left(a::text,8),'Synthetic acceptance test only') RETURNING id INTO t2;
 INSERT INTO laboratory_fixture VALUES(a,p,v,d,od,u,ou,ps,vs,ds,encounter,patient,t1,t2);
END $$;
CREATE FUNCTION pg_temp.reject(q text,pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM !~* pattern THEN RAISE EXCEPTION 'Unexpected error: %, expected %',SQLERRM,pattern; END IF; RETURN;
 END;
 RAISE EXCEPTION 'Expected rejection: %',pattern;
END $$;

CREATE FUNCTION pg_temp.fail_lab_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('test.lab_fail',true)='on' AND NEW.entity_type='lab_orders' THEN RAISE EXCEPTION 'Synthetic publication failure'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER synthetic_publication_failure BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_lab_publication();
SET LOCAL ROLE authenticated;
DO $$
DECLARE f laboratory_fixture%ROWTYPE; o uuid; data jsonb; version integer; r uuid; records_before bigint; notices bigint;
BEGIN
 SELECT * INTO STRICT f FROM laboratory_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM public.authorize_laboratory_staff(f.processor_staff,true,false,false,true);
 PERFORM public.authorize_laboratory_staff(f.validator_staff,true,true,true,true);
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 o=public.doctor_native_lab(f.encounter,f.test2,'Synthetic guided completion',gen_random_uuid());
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 data=public.laboratory_panel(0,'pendiente','',NULL,NULL,f.test2,NULL);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items') x WHERE x->>'id'=o::text) THEN RAISE EXCEPTION 'FAIL inbox'; END IF;
 data=public.laboratory_order_detail(o);
 IF data->>'patient_first_name'<>'Patient' OR data->>'patient_last_name'<>'Laboratory Synthetic' OR data->>'patient_email'<>f.patient_user::text||'@laboratory-test.invalid' OR data->>'record_code' IS NULL THEN RAISE EXCEPTION 'FAIL identity'; END IF;
 PERFORM public.start_laboratory_order(o);
 version=(public.laboratory_order_detail(o)->'draft'->>'version')::integer;
 PERFORM pg_temp.reject(format('select public.complete_laboratory_exam(%L,%s,%L,%L,true)',o,version,'Synthetic result','{}'),'autorizaci');
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM pg_temp.reject(format('select public.complete_laboratory_exam(%L,%s,%L,%L,true)',o,version,'Synthetic result','{}'),'autorizaci');
 PERFORM set_config('request.jwt.claim.sub',f.validator::text,true);
 PERFORM pg_temp.reject(format('select public.complete_laboratory_exam(%L,%s,%L,%L,true)',o,version,'','{}'),'Completa|Falta|resultado');
 PERFORM set_config('test.lab_fail','on',true);
 PERFORM pg_temp.reject(format('select public.complete_laboratory_exam(%L,%s,%L,%L,true)',o,version,'Synthetic result','{}'),'Synthetic publication failure');
 data=public.laboratory_order_detail(o);
 IF data->>'status'<>'en_proceso' OR (data->'draft'->>'version')::int<>version OR data->'draft'->>'workflow_stage'<>'draft' OR data->'result'->>'published_at' IS NOT NULL THEN RAISE EXCEPTION 'FAIL atomic rollback'; END IF;
 PERFORM set_config('test.lab_fail','off',true);
 r=public.complete_laboratory_exam(o,version,'Synthetic result','{}',true);
 IF r<>public.complete_laboratory_exam(o,version,'Synthetic result','{}',true) THEN RAISE EXCEPTION 'FAIL retry'; END IF;
 data=public.laboratory_order_detail(o);
 IF data->>'status'<>'completado' OR data->'result'->>'validated_at' IS NULL OR data->'result'->>'published_at' IS NULL THEN RAISE EXCEPTION 'FAIL completion'; END IF;
 IF (SELECT count(*) FROM public.lab_results WHERE order_id=o)<>1 THEN RAISE EXCEPTION 'FAIL duplicate result'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'history') x WHERE x->>'status'='completado') THEN RAISE EXCEPTION 'FAIL state history'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 data=public.doctor_native_patient_labs(f.patient,0);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items') x WHERE x->>'id'=o::text AND x->>'result_summary'='Synthetic result') THEN RAISE EXCEPTION 'FAIL doctor read'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.lab_results WHERE id=r AND summary='Synthetic result' AND published_to_patient_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL owner read'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE entity_type='lab_orders' AND entity_id=o::text)<>1 THEN RAISE EXCEPTION 'FAIL duplicate patient notification'; END IF;
 IF (SELECT count(*) FROM public.medical_records WHERE patient_id=f.patient)<>1 THEN RAISE EXCEPTION 'FAIL record duplicated'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.other_patient::text,true);
 IF EXISTS(SELECT 1 FROM public.lab_results WHERE id=r) THEN RAISE EXCEPTION 'FAIL privacy'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: native order, inbox, identity, permission guards, empty rejection, rollback on publish failure, completion, retry, doctor/patient reads, state audit, privacy' AS result;
ROLLBACK;
