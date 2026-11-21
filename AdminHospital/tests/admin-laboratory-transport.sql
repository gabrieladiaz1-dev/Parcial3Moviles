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
 INSERT INTO public.user_roles(user_id,role,active) VALUES(a,'admin',true),(p,'recepcionista',true),(v,'enfermera',true),(d,'doctor',true),(od,'doctor',true);
 UPDATE public.user_roles SET active=false WHERE user_id IN(a,p,v,d,od) AND role='paciente';
 INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES(ps,p,'L-P-'||left(p::text,8),'recepcionista'),(vs,v,'L-V-'||left(v::text,8),'enfermera'),(ds,d,'L-D-'||left(d::text,8),'doctor'),(ods,od,'L-OD-'||left(od::text,8),'doctor');
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
DECLARE f laboratory_fixture%ROWTYPE; o uuid; v integer; r uuid; transport uuid; dispatch uuid; unit_id smallint; data jsonb;
BEGIN
 SELECT * INTO STRICT f FROM laboratory_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 o=public.doctor_native_lab(f.encounter,f.test2,'Synthetic admin workflow',gen_random_uuid());
 IF (public.my_laboratory_access()->>'can_process')::boolean THEN RAISE EXCEPTION 'FAIL doctor laboratory permissions'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 IF (public.my_laboratory_access()->>'can_view')::boolean THEN RAISE EXCEPTION 'FAIL receptionist laboratory permissions'; END IF;
 PERFORM pg_temp.reject(format('select public.start_laboratory_order(%L)',o),'autorizaci');
 transport=public.request_medical_transport(f.patient,'Synthetic Contact','0000-0000','Synthetic origin','Synthetic destination','Synthetic reason','normal',gen_random_uuid());
 PERFORM pg_temp.reject(format('select public.review_medical_transport(%L,''autorizar'')',transport),'No autorizado');
 PERFORM set_config('request.jwt.claim.sub',f.admin_id::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE entity_type='lab_orders' AND entity_id=o::text AND recipient_id=f.admin_id) THEN RAISE EXCEPTION 'FAIL admin new order notification'; END IF;
 IF public.my_laboratory_access()->>'can_process'<>'true' OR public.my_laboratory_access()->>'can_validate'<>'true' OR public.my_laboratory_access()->>'can_publish'<>'true' THEN RAISE EXCEPTION 'FAIL admin laboratory access'; END IF;
 PERFORM public.start_laboratory_order(o);
 v=(public.laboratory_order_detail(o)->'draft'->>'version')::int;
 PERFORM pg_temp.reject(format('select public.complete_laboratory_exam(%L,%s,%L,%L,true)',o,v,'','{}'),'Completa|Falta|resultado');
 r=public.complete_laboratory_exam(o,v,'Synthetic admin result','{}',true);
 IF public.laboratory_order_detail(o)->>'status'<>'completado' THEN RAISE EXCEPTION 'FAIL admin completion'; END IF;
 unit_id=public.save_panel_ambulance('SYN-'||left(o::text,8),NULL,'disponible',true);
 PERFORM public.review_medical_transport(transport,'autorizar');
 dispatch=public.assign_medical_transport(transport,unit_id,NULL);
 IF dispatch<>public.assign_medical_transport(transport,unit_id,NULL) THEN RAISE EXCEPTION 'FAIL dispatch retry'; END IF;
 PERFORM public.progress_medical_transport(dispatch,'salida');
 PERFORM public.progress_medical_transport(dispatch,'llegada');
 PERFORM public.finish_medical_transport(dispatch,true,false,'Synthetic completion');
 data=public.panel_transport_data(0,NULL,transport);
 IF data->'items'->0->>'status'<>'finalizada' OR data->'items'->0->'dispatch'->>'assigned_staff_id' IS NOT NULL THEN RAISE EXCEPTION 'FAIL transport without staff assignment'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.processor::text,true);
 PERFORM pg_temp.reject(format('select public.progress_medical_transport(%L,''salida'')',dispatch),'No autorizado');
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.lab_results WHERE id=r AND summary='Synthetic admin result') THEN RAISE EXCEPTION 'FAIL patient publication'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: admin laboratory completion and transport without driver; receptionist/doctor operational restrictions; patient publication' AS result;
ROLLBACK;
