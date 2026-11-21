-- Single controlled acceptance test; synthetic users/resources, all rolled back.
BEGIN;
CREATE TEMP TABLE panel_fixture(admin1 uuid,admin2 uuid,receptionist uuid,doctor_user uuid,patient_user uuid,driver1 uuid,driver2 uuid,patient1 uuid,patient2 uuid);
GRANT SELECT ON panel_fixture TO authenticated;
DO $$
DECLARE a uuid=gen_random_uuid(); b uuid=gen_random_uuid(); r uuid=gen_random_uuid(); d uuid=gen_random_uuid(); u uuid=gen_random_uuid(); s1 uuid=gen_random_uuid(); s2 uuid=gen_random_uuid(); p1 uuid=gen_random_uuid(); p2 uuid=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 (a,a::text||'@panel-test.invalid','{"first_name":"Admin","last_name":"Synthetic One"}'),
 (b,b::text||'@panel-test.invalid','{"first_name":"Admin","last_name":"Synthetic Two"}'),
 (r,r::text||'@panel-test.invalid','{"first_name":"Reception","last_name":"Synthetic"}'),
 (d,d::text||'@panel-test.invalid','{"first_name":"Doctor","last_name":"Synthetic"}'),
 (u,u::text||'@panel-test.invalid','{"first_name":"Patient","last_name":"Synthetic"}');
 INSERT INTO public.user_roles(user_id,role,active) VALUES(a,'admin',true),(b,'admin',true),(r,'recepcionista',true),(d,'doctor',true);
 UPDATE public.user_roles SET active=false WHERE user_id IN(a,b,r,d) AND role='paciente';
 INSERT INTO public.staff(id,profile_id,employee_code,category) VALUES(s1,r,'PANEL-R-'||left(r::text,8),'recepcionista'),(s2,d,'PANEL-D-'||left(d::text,8),'doctor');
 INSERT INTO public.patients(id,profile_id,first_name,last_name) VALUES(p1,u,'Patient','Synthetic One'),(p2,NULL,'Patient','Synthetic Two');
 INSERT INTO public.medical_records(patient_id) VALUES(p1),(p2);
 INSERT INTO public.care_team_assignments(patient_id,staff_id) VALUES(p1,s2),(p2,s2);
 INSERT INTO panel_fixture VALUES(a,b,r,d,u,s1,s2,p1,p2);
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
DECLARE f panel_fixture%ROWTYPE; i jsonb; p jsonb; v text; unit1 smallint; unit2 smallint; r1 uuid; r2 uuid; dispatch uuid; notice uuid; admission uuid; k uuid=gen_random_uuid();
BEGIN
 SELECT * INTO STRICT f FROM panel_fixture;
 PERFORM set_config('request.jwt.claim.sub',f.admin1::text,true);
 i=public.panel_institution();
 PERFORM public.save_hospital_settings('{"name":"Synthetic institution","about":"Synthetic acceptance test","affiliation":null,"email":"test@hospital.invalid","phone":null,"address":"Synthetic test address","latitude":14,"longitude":-89}'::jsonb,i->>'version');
 IF public.panel_institution()->>'name'<>'Synthetic institution' THEN RAISE EXCEPTION 'FAIL settings persistence'; END IF;
 p=public.my_panel_profile();
 PERFORM public.save_my_panel_profile('0000-0000','Synthetic city',p->>'version',p->>'first_name',p->>'last_name',NULL);
 IF public.my_panel_profile()->>'city'<>'Synthetic city' OR NOT(public.my_panel_profile()->'roles' ? 'admin') THEN RAISE EXCEPTION 'FAIL profile update'; END IF;
 unit1=public.save_panel_ambulance('TEST-'||left(k::text,8),left(k::text,8),'disponible',true);
 unit2=public.save_panel_ambulance('TEST2-'||left(k::text,8),'B-'||left(k::text,8),'disponible',true);
 PERFORM public.authorize_panel_driver(f.driver1,true);
 PERFORM public.authorize_panel_driver(f.driver2,true);
 PERFORM set_config('request.jwt.claim.sub',f.admin2::text,true);
 PERFORM public.my_panel_preferences('{"attention":true,"admissions":true,"ambulance":true,"poll_seconds":30}');
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 PERFORM public.my_panel_preferences('{"attention":true,"admissions":true,"ambulance":false,"poll_seconds":60}');
 PERFORM pg_temp.reject('select public.save_hospital_settings(''{"name":"Unauthorized"}'',NULL)','Solo administración');
 PERFORM pg_temp.reject('select public.save_panel_ambulance(''UNAUTHORIZED'',NULL,''disponible'',true)','Solo administración');
 PERFORM set_config('request.jwt.claim.sub',f.doctor_user::text,true);
 r1=public.request_medical_transport(f.patient1,'Synthetic Contact','0000-0000','Synthetic origin','Synthetic destination','Synthetic medical reason','normal',k);
 IF r1<>public.request_medical_transport(f.patient1,'Synthetic Contact','0000-0000','Synthetic origin','Synthetic destination','Synthetic medical reason','normal',k) THEN RAISE EXCEPTION 'FAIL transport idempotency'; END IF;
 r2=public.request_medical_transport(f.patient2,'Synthetic Contact','0000-0000','Synthetic origin','Synthetic destination','Synthetic medical reason','urgente',gen_random_uuid());
 admission=public.request_admission(f.patient1,'vip','Synthetic admission reason',NULL,NULL);
 PERFORM set_config('request.jwt.claim.sub',f.admin2::text,true);
 SELECT id INTO STRICT notice FROM public.notifications WHERE entity_type='ambulance_requests' AND entity_id=r1::text;
 IF (SELECT count(*) FROM public.notifications WHERE entity_type='ambulance_requests' AND entity_id=r1::text)<>1 THEN RAISE EXCEPTION 'FAIL duplicated notice'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE recipient_id<>f.admin2) THEN RAISE EXCEPTION 'FAIL notification isolation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=notice AND body NOT LIKE '%Synthetic medical reason%' AND body NOT LIKE '%Patient%') THEN RAISE EXCEPTION 'FAIL sensitive notice text'; END IF;
 PERFORM public.read_panel_notification(notice);
 PERFORM set_config('request.jwt.claim.sub',f.receptionist::text,true);
 IF EXISTS(SELECT 1 FROM public.notifications WHERE entity_type='ambulance_requests' AND entity_id=r1::text) THEN RAISE EXCEPTION 'FAIL notification preference'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE entity_type='hospital_admissions' AND entity_id=admission::text) THEN RAISE EXCEPTION 'FAIL admission notice'; END IF;
 PERFORM public.read_panel_notification(notice); -- must not change another user's row.
 i=public.panel_transport_data(0,NULL,r1);
 IF i->'items'->0->>'id' IS DISTINCT FROM r1::text THEN RAISE EXCEPTION 'FAIL related record'; END IF;
 PERFORM public.review_medical_transport(r1,'autorizar','Synthetic destination',NULL);
 dispatch=public.assign_medical_transport(r1,unit1,f.driver1);
 IF dispatch<>public.assign_medical_transport(r1,unit1,f.driver1) THEN RAISE EXCEPTION 'FAIL assignment retry'; END IF;
 PERFORM pg_temp.reject(format('select public.assign_medical_transport(%L,%s::smallint,%L)',r2,unit1,f.driver2),'ambulancia.*disponible');
 PERFORM pg_temp.reject(format('select public.assign_medical_transport(%L,%s::smallint,%L)',r2,unit2,f.driver1),'conductor.*disponible');
 PERFORM pg_temp.reject(format('select public.complete_dispatch(%L,false)',dispatch),'llegada|controles');
 PERFORM public.progress_medical_transport(dispatch,'salida',NULL);
 PERFORM public.progress_medical_transport(dispatch,'llegada',NULL);
 IF NOT EXISTS(SELECT 1 FROM public.ambulances WHERE id=unit1 AND status='en_servicio') THEN RAISE EXCEPTION 'FAIL arrival released unit'; END IF;
 PERFORM pg_temp.reject(format('select public.finish_medical_transport(%L,false,false,NULL)',dispatch),'Confirma');
 PERFORM public.finish_medical_transport(dispatch,true,false,'Synthetic operational check');
 PERFORM public.finish_medical_transport(dispatch,true,false,'Synthetic operational check');
 IF NOT EXISTS(SELECT 1 FROM public.ambulances WHERE id=unit1 AND status='disponible') OR NOT EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE id=dispatch AND completed_by=f.receptionist AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL completion'; END IF;
 i=public.panel_transport_data(0,NULL,r1);
 IF i->'items'->0->>'status'<>'finalizada' OR jsonb_array_length(i->'items'->0->'history')<5 THEN RAISE EXCEPTION 'FAIL service history'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.admin1::text,true);
 PERFORM public.save_panel_ambulance('TEST2-'||left(k::text,8),'B-'||left(k::text,8),'en_mantenimiento',true,'Synthetic maintenance',unit2);
 PERFORM set_config('request.jwt.claim.sub',f.admin2::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=notice AND read_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL persistent read state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE entity_type='ambulances' AND entity_id=unit2::text) THEN RAISE EXCEPTION 'FAIL maintenance notice'; END IF;
 PERFORM public.read_panel_notification();
 IF (public.my_panel_notifications()->>'unread')::integer<>0 THEN RAISE EXCEPTION 'FAIL mark all'; END IF;
 PERFORM set_config('request.jwt.claim.sub',f.patient_user::text,true);
 PERFORM pg_temp.reject('select public.my_panel_notifications()','No autorizado');
 PERFORM pg_temp.reject('select public.panel_transport_data()','No autorizado');
 PERFORM pg_temp.reject('select public.my_panel_profile()','No autorizado');
 IF EXISTS(SELECT 1 FROM public.notifications WHERE recipient_id<>f.patient_user) THEN RAISE EXCEPTION 'FAIL patient notice isolation'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS: institutional settings/profile, real transport request, multi-unit fleet and driver authorization, related-record access, role restrictions, duplicate unit/driver rejection, departure/arrival/operational completion, event notifications, recipient preferences/isolation, persistent read state and mark-all. Synthetic changes rolled back.' result;
ROLLBACK;
