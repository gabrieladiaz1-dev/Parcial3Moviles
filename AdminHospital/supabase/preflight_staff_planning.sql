-- READ ONLY. Recheck immediately before a separately authorized migration.
BEGIN READ ONLY;
DO $$
DECLARE expected text; actual text; t text;
BEGIN
 IF current_setting('server_version_num')::integer/10000<>17 THEN RAISE EXCEPTION 'Review PostgreSQL version first'; END IF;
 IF current_setting('default_transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Review transaction isolation first'; END IF;
 FOREACH t IN ARRAY ARRAY['staff','profiles','user_roles','staff_shifts','staff_absences','doctor_schedules','doctor_consulting_rooms','consulting_rooms','appointments'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN RAISE EXCEPTION 'Missing table or disabled RLS: %',t; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND (
  (table_name='doctor_schedules' AND column_name IN('active','consulting_assignment_id')) OR
  (table_name='doctor_consulting_rooms' AND column_name IN('active','slot_minutes')) OR
  (table_name='staff_absences' AND column_name='active'))) THEN RAISE EXCEPTION 'Proposed columns already exist; do not reapply'; END IF;
 FOREACH expected IN ARRAY ARRAY['public.set_employee_role(uuid,public.hospital_role,boolean)','public.upsert_staff(uuid,text,text)','public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid)'] LOOP
  IF to_regprocedure(expected) IS NULL THEN RAISE EXCEPTION 'Missing current RPC: %',expected; END IF;
 END LOOP;
 IF to_regprocedure('public.save_staff_planning(text,jsonb,uuid,text)') IS NOT NULL THEN RAISE EXCEPTION 'Planning RPC already installed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.doctor_consulting_rooms'::regclass AND conname='doctor_consulting_rooms_consulting_room_id_tstzrange_excl') OR
    NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.doctor_consulting_rooms'::regclass AND conname='doctor_consulting_rooms_doctor_id_tstzrange_excl') THEN RAISE EXCEPTION 'Original exclusions changed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN('staff_shifts','staff_absences','doctor_schedules','doctor_consulting_rooms','consulting_rooms') AND cmd IN('ALL','INSERT','UPDATE','DELETE') AND (
  cmd='ALL' OR roles<>ARRAY['authenticated']::name[] OR
  (cmd IN('UPDATE','DELETE') AND qual IS DISTINCT FROM 'private.has_role(''admin''::hospital_role)') OR
  (cmd IN('INSERT','UPDATE') AND with_check IS DISTINCT FROM 'private.has_role(''admin''::hospital_role)'))) THEN RAISE EXCEPTION 'Unexpected write policy; audit before applying'; END IF;
 IF EXISTS(SELECT 1 FROM public.appointments) OR EXISTS(SELECT 1 FROM public.staff_shifts) OR
    EXISTS(SELECT 1 FROM public.staff_absences) OR EXISTS(SELECT 1 FROM public.doctor_schedules) OR
    EXISTS(SELECT 1 FROM public.doctor_consulting_rooms) THEN RAISE EXCEPTION 'Planning or appointments changed since this review; refresh backup and repeat review'; END IF;
 SELECT md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) ORDER BY id),'')) INTO actual FROM public.consulting_rooms x;
 IF actual<>'e23d100776f9d925014ba07d9d652c75' THEN RAISE EXCEPTION 'Consulting room baseline changed; refresh backup'; END IF;
END $$;
SELECT 'PASS: read-only preflight matches the reviewed baseline' result;
ROLLBACK;
