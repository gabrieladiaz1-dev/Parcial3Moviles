-- Local only: reproduce the DB steps used by manage-employees, after planning DDL.
BEGIN;
DO $$
DECLARE a uuid := gen_random_uuid(); u uuid; employee uuid; sp bigint; category text;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(a,a::text||'@local.test','{"first_name":"Admin","last_name":"Synthetic"}');
 INSERT INTO public.user_roles(user_id,role,active) VALUES(a,'admin',true);
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 SELECT id INTO STRICT sp FROM public.specialties WHERE active ORDER BY id LIMIT 1;
 FOREACH category IN ARRAY ARRAY['doctor','recepcionista'] LOOP
  u := gen_random_uuid();
  -- Auth Admin API triggers the same profile/patient-role database trigger.
  INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
   VALUES(u,u::text||'@local.test','{"first_name":"Personal","last_name":"Synthetic"}','{"employee_pending":true}');
  PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
  PERFORM user_id FROM public.user_roles WHERE user_id=a AND role='admin' AND active FOR SHARE;
  PERFORM id FROM auth.users WHERE id=u FOR UPDATE;
  UPDATE public.profiles SET first_name='Prueba',last_name=category,phone='00000000',birth_date='1990-01-01',city='Prueba' WHERE id=u;
  PERFORM public.set_employee_role(u,category::public.hospital_role,true);
  employee:=public.upsert_staff(u,'COMPAT-'||u::text,category);
  UPDATE public.staff SET active=true WHERE id=employee;
  DELETE FROM public.doctor_specialties WHERE doctor_id=employee;
  IF category='doctor' THEN INSERT INTO public.doctor_specialties VALUES(employee,sp); END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF NOT EXISTS(SELECT 1 FROM public.staff WHERE id=employee AND profile_id=u AND active) OR
    NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role::text=category AND active) OR
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role='paciente' AND active) THEN RAISE EXCEPTION 'FAIL employee database registration'; END IF;
  IF category='recepcionista' AND EXISTS(SELECT 1 FROM public.doctor_specialties WHERE doctor_id=employee) THEN RAISE EXCEPTION 'FAIL receptionist specialties'; END IF;
  -- The ordinary personal-data edit also remains valid.
  UPDATE public.profiles SET first_name='Editado' WHERE id=u;
  UPDATE public.staff SET employee_code=employee_code||'-EDIT' WHERE id=employee;
  -- No-schedule employee can still be deactivated.
  UPDATE public.staff SET active=false WHERE id=employee;
  PERFORM public.set_employee_role(u,category::public.hospital_role,false);
 END LOOP;
END $$;
SELECT 'PASS employee registration DB contract, editing and no-schedule deactivation after planning migration' result;
ROLLBACK;
