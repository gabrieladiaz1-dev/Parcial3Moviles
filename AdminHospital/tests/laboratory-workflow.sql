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
SET LOCAL ROLE authenticated;
DO $$
DECLARE f laboratory_fixture%ROWTYPE; order1 uuid; order2 uuid; key1 uuid=gen_random_uuid(); result_id uuid; retry uuid; data jsonb; schema jsonb; version integer; catalog_version text;
BEGIN
 SELECT * INTO STRICT f FROM laboratory_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 IF public.my_laboratory_access()->>'can_validate'<>'false' OR public.my_laboratory_access()->>'can_publish'<>'false' THEN RAISE EXCEPTION 'FAIL admin gained clinical authority'; END IF;
 PERFORM public.authorize_laboratory_staff(f.processor_staff,true,false,false,true);
 PERFORM public.authorize_laboratory_staff(f.validator_staff,false,true,true,true);
 PERFORM set_config('request.jwt.claim.sub',f.validator::text,true);
 schema='[{"key":"synthetic_number","label":"Synthetic parameter","type":"number","required":true,"unit":"synthetic-unit","low":"1","high":"10","range_scope":"all_patients","reference":"Synthetic general range for test only"},{"key":"synthetic_quality","label":"Synthetic qualitative","type":"qualitative","required":true,"choices":["Synthetic positive","Synthetic negative"]}]'::jsonb;
 SELECT xmin::text INTO catalog_version FROM public.lab_test_types WHERE id=f.test1;
 PERFORM public.configure_laboratory_test(f.test1,schema,catalog_version);
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 order1=public.doctor_native_lab(f.encounter,f.test1,'Synthetic indication',key1);
 IF order1<>public.doctor_native_lab(f.encounter,f.test1,'Synthetic indication',key1) THEN RAISE EXCEPTION 'FAIL native order idempotency'; END IF;
 order2=public.doctor_native_lab(f.encounter,f.test2,'Synthetic second exam',gen_random_uuid());
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 IF public.my_laboratory_access()->>'can_view'<>'true' OR public.my_panel_profile()->>'id'<>f.processor::text THEN RAISE EXCEPTION 'FAIL laboratory staff panel access'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE entity_type='lab_orders' AND entity_id=order1::text)<>1 THEN RAISE EXCEPTION 'FAIL new order notification'; END IF;
 data=public.laboratory_panel(0,'pendiente','',NULL,NULL,f.test1,NULL);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items') x WHERE x->>'id'=order1::text) THEN RAISE EXCEPTION 'FAIL web inbox'; END IF;
 PERFORM public.start_laboratory_order(order1);
 PERFORM public.start_laboratory_order(order1);
 IF (SELECT count(*) FROM public.lab_results WHERE order_id=order1)<>1 THEN RAISE EXCEPTION 'FAIL duplicate result'; END IF;
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM public.save_laboratory_draft(order1,version,'','{}');
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM pg_temp.reject(format('select public.submit_laboratory_validation(%L,%s)',order1,version),'Completa|Falta');
 PERFORM pg_temp.reject(format('select public.publish_laboratory_order(%L,%s,true)',order1,version),'autorización');
 PERFORM public.save_laboratory_draft(order1,version,'Synthetic interpretation','{"synthetic_number":{"value":"5","observation":"Synthetic observation"},"synthetic_quality":{"value":"Synthetic positive"}}');
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF EXISTS(SELECT 1 FROM public.lab_results WHERE order_id=order1) OR EXISTS(SELECT 1 FROM public.lab_result_drafts WHERE order_id=order1) THEN RAISE EXCEPTION 'FAIL patient draft visibility'; END IF;
 PERFORM pg_temp.reject(format('select public.validate_laboratory_result(%L,%s)',order1,version),'autorización');
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 data=public.doctor_native_patient_labs(f.patient,0);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items') x WHERE x->>'id'=order1::text AND x->>'result_summary' IS NOT NULL) THEN RAISE EXCEPTION 'FAIL native patient labs leaked draft'; END IF;
 data=public.doctor_native_workspace(now()-interval '1 day',now()+interval '1 day');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'orders') x WHERE x->>'id'=order1::text AND x->>'result_summary' IS NOT NULL) THEN RAISE EXCEPTION 'FAIL workspace leaked draft'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 PERFORM pg_temp.reject(format('select public.validate_laboratory_result(%L,%s)',order1,version),'autorización');
 PERFORM pg_temp.reject(format('select public.publish_lab_result(%L,''Unauthorized result'',true)',order1),'autorización');
 IF public.laboratory_order_detail(order1)->'draft'->>'draft_summary' IS NOT NULL THEN RAISE EXCEPTION 'FAIL supervisor sees preparation data'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 PERFORM public.submit_laboratory_validation(order1,version);
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM pg_temp.reject(format('select public.validate_laboratory_result(%L,%s)',order1,version),'autorización');
 PERFORM set_config('request.jwt.claim.sub',f.validator::text,true);
 PERFORM public.validate_laboratory_result(order1,version);
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 result_id=public.publish_laboratory_order(order1,version,false);
 retry=public.publish_laboratory_order(order1,version,false);
 IF result_id<>retry THEN RAISE EXCEPTION 'FAIL publication retry'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF EXISTS(SELECT 1 FROM public.lab_results WHERE order_id=order1) OR EXISTS(SELECT 1 FROM public.notifications WHERE entity_type='lab_orders' AND entity_id=order1::text) THEN RAISE EXCEPTION 'FAIL patient publication consent'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.validator::text,true);
 PERFORM public.reception_release_lab(order1);
 PERFORM public.reception_release_lab(order1);
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 SELECT to_jsonb(r) INTO data FROM public.lab_results r WHERE order_id=order1;
 IF data->>'summary' NOT LIKE '%Synthetic parameter: 5 synthetic-unit%' OR data ? 'draft_values' OR data ? 'draft_summary' THEN RAISE EXCEPTION 'FAIL patient published SELECT * contract'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE entity_type='lab_orders' AND entity_id=order1::text)<>1 THEN RAISE EXCEPTION 'FAIL patient notification duplicate'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.other_patient::text,true);
 IF EXISTS(SELECT 1 FROM public.lab_results WHERE order_id=order1) THEN RAISE EXCEPTION 'FAIL foreign patient result'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.other_doctor::text,true);
 IF EXISTS(SELECT 1 FROM public.lab_results WHERE order_id=order1) THEN RAISE EXCEPTION 'FAIL unauthorized doctor result'; END IF;
 PERFORM pg_temp.reject(format('select public.doctor_native_patient_labs(%L,0)',f.patient),'Paciente no asignado');
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 data=public.doctor_native_patient_labs(f.patient,0);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'items') x WHERE x->>'id'=order1::text AND x->>'result_summary' LIKE '%Synthetic parameter: 5 synthetic-unit%') THEN RAISE EXCEPTION 'FAIL authorized doctor result'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE entity_type='lab_orders' AND entity_id=order1::text)<>1 THEN RAISE EXCEPTION 'FAIL doctor notification'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM public.correct_laboratory_result(order1,version,'Synthetic traceable correction');
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM public.save_laboratory_draft(order1,version,'Synthetic corrected interpretation','{"synthetic_number":{"value":"9"},"synthetic_quality":{"value":"Synthetic negative"}}');
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.lab_results WHERE order_id=order1 AND result_values->'synthetic_number'->>'value'='5') THEN RAISE EXCEPTION 'FAIL correction replaced published result prematurely'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 PERFORM public.submit_laboratory_validation(order1,version);
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM set_config('request.jwt.claim.sub',f.validator::text,true);
 PERFORM public.validate_laboratory_result(order1,version);
 version=(public.laboratory_order_detail(order1)->'draft'->>'version')::integer;
 PERFORM public.publish_laboratory_order(order1,version,true);
 IF (SELECT count(*) FROM public.lab_results WHERE order_id=order1)<>1 OR NOT EXISTS(SELECT 1 FROM public.lab_results WHERE order_id=order1 AND published_revision=2 AND result_values->'synthetic_number'->>'value'='9') THEN RAISE EXCEPTION 'FAIL correction publication'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lab_orders WHERE id=order1 AND status='completado') OR NOT EXISTS(SELECT 1 FROM public.lab_orders WHERE id=order2 AND status='pendiente') THEN RAISE EXCEPTION 'FAIL independent exam states'; END IF;
 data=public.laboratory_order_detail(order1);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'history') h WHERE h->>'revision'='1' AND h->>'summary' LIKE '%Synthetic parameter: 5 synthetic-unit%') THEN RAISE EXCEPTION 'FAIL correction history'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: native iOS doctor order/retry -> web inbox -> processing -> structured draft -> review -> authorized validation/publication -> doctor and patient authorized reads. Verified no admin automatic signature, incomplete/unauthorized rejection, foreign patient/doctor isolation, both native doctor RPCs hide drafts, SELECT * compatibility, no duplicates, notifications, independent exams and traceable correction retaining the last published version. All synthetic data rolled back.' result;
ROLLBACK;
