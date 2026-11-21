-- SQL Editor / privileged connector. All synthetic fixtures are rolled back.
-- Tests the verified database contract; does not replace Auth HTTP integration tests.
BEGIN;
DO $$
DECLARE
 admin_id uuid;
 doctor_user uuid := gen_random_uuid();
 reception_user uuid := gen_random_uuid();
 doctor_staff uuid;
 reception_staff uuid;
 specialty bigint;
 rejected boolean := false;
 code_prefix text := 'ROLLBACK-' || gen_random_uuid()::text;
BEGIN
 SELECT user_id INTO STRICT admin_id FROM public.user_roles WHERE role='admin' AND active LIMIT 1;
 SELECT id INTO STRICT specialty FROM public.specialties WHERE active ORDER BY id LIMIT 1;
 -- No credentials are created or stored. Auth inserts below only test the profile trigger.
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
 VALUES(doctor_user,doctor_user::text||'@example.com','{"first_name":"Doctor","last_name":"Prueba","role":"admin"}','{}'),
       (reception_user,reception_user::text||'@example.com','{"first_name":"Recepcionista","last_name":"Prueba"}','{}');
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id IN(doctor_user,reception_user) AND role<>'paciente') THEN
   RAISE EXCEPTION 'FAIL: metadata granted a privileged role';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM public.set_employee_role(doctor_user,'doctor',true);
 SELECT public.upsert_staff(doctor_user,code_prefix||'-D','doctor') INTO doctor_staff;
 INSERT INTO public.doctor_specialties VALUES(doctor_staff,specialty);
 PERFORM public.set_employee_role(reception_user,'recepcionista',true);
 SELECT public.upsert_staff(reception_user,code_prefix||'-R','recepcionista') INTO reception_staff;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=doctor_user AND first_name='Doctor') OR
    NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=doctor_user AND role='doctor' AND active) OR
    NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=reception_user AND role='recepcionista' AND active) OR
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id IN(doctor_user,reception_user) AND role='paciente' AND active) OR
    EXISTS(SELECT 1 FROM public.doctor_specialties WHERE doctor_id=reception_staff) THEN
   RAISE EXCEPTION 'FAIL: employee registration contract';
 END IF;
 BEGIN
   UPDATE public.staff SET employee_code=code_prefix||'-D' WHERE id=reception_staff;
 EXCEPTION WHEN unique_violation THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL: duplicate employee code accepted'; END IF;
 UPDATE public.profiles SET first_name='Doctor editado',city='Ciudad de prueba' WHERE id=doctor_user;
 UPDATE public.staff SET active=false WHERE id=doctor_staff;
 PERFORM public.set_employee_role(doctor_user,'doctor',false);
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=doctor_user AND active) THEN
   RAISE EXCEPTION 'FAIL: inactive employee has an active role';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',reception_user::text,true);
 rejected := false;
 BEGIN
   PERFORM public.set_employee_role(reception_user,'admin',true);
 EXCEPTION WHEN raise_exception THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL: employee promoted itself'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE rejected boolean := false;
BEGIN
 IF (SELECT count(*) FROM public.profiles) <> 1 OR
    EXISTS(SELECT 1 FROM public.user_roles WHERE user_id<>auth.uid()) THEN
   RAISE EXCEPTION 'FAIL: RLS exposes another user profile or roles';
 END IF;
 BEGIN
   INSERT INTO public.user_roles(user_id,role,active) VALUES(auth.uid(),'admin',true);
 EXCEPTION WHEN insufficient_privilege THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'FAIL: direct role mutation allowed'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: profile trigger, metadata escalation prevention, doctor and receptionist registration, specialties, duplicate code, editing, deactivation, role escalation prevention and authenticated RLS' AS result;
ROLLBACK;
