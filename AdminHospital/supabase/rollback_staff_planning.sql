-- OPERATIONAL ROLLBACK ONLY, NOT AUTHORIZED FOR EXECUTION.
-- Captured from the connected project at 2026-11-13T07:31:59Z.
-- Keeps all five added columns and never deletes data. Refuses after planning usage.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
LOCK TABLE public.staff,public.user_roles,public.staff_shifts,public.staff_absences,public.doctor_schedules,public.doctor_consulting_rooms,public.consulting_rooms,public.appointments IN ACCESS EXCLUSIVE MODE;
DO $rollback$
DECLARE baseline jsonb := '{"appointments":{"md5":"d41d8cd98f00b204e9800998ecf8427e","count":0},"staff_shifts":{"md5":"d41d8cd98f00b204e9800998ecf8427e","count":0},"staff_absences":{"md5":"d41d8cd98f00b204e9800998ecf8427e","count":0},"consulting_rooms":{"md5":"e23d100776f9d925014ba07d9d652c75","count":20},"doctor_schedules":{"md5":"d41d8cd98f00b204e9800998ecf8427e","count":0},"doctor_consulting_rooms":{"md5":"d41d8cd98f00b204e9800998ecf8427e","count":0}}'::jsonb;
 t text; removed text[]; actual_count bigint; actual_digest text;
BEGIN
 IF to_regprocedure('public.save_staff_planning(text,jsonb,uuid,text)') IS NULL THEN RAISE EXCEPTION 'Planning migration not installed'; END IF;
 FOR t IN SELECT key FROM jsonb_each(baseline) LOOP
  removed := CASE t WHEN 'doctor_schedules' THEN ARRAY['active','consulting_assignment_id'] WHEN 'doctor_consulting_rooms' THEN ARRAY['active','slot_minutes'] WHEN 'staff_absences' THEN ARRAY['active'] ELSE ARRAY[]::text[] END;
  EXECUTE format('SELECT count(*), md5(coalesce(string_agg((to_jsonb(x)-$1::text[])::text,E''\n'' ORDER BY x.id),'''')) FROM public.%I x',t) INTO actual_count,actual_digest USING removed;
  IF actual_count<>(baseline->t->>'count')::bigint OR actual_digest<>baseline->t->>'md5' THEN
   RAISE EXCEPTION 'Rollback blocked: % changed. Preserve new data and prepare a forward repair instead',t;
  END IF;
 END LOOP;
END $rollback$;
DROP TRIGGER planning_guard ON public."staff_shifts";
DROP TRIGGER planning_lock ON public."staff_shifts";
DROP TRIGGER planning_guard ON public."staff_absences";
DROP TRIGGER planning_lock ON public."staff_absences";
DROP TRIGGER planning_guard ON public."doctor_schedules";
DROP TRIGGER planning_lock ON public."doctor_schedules";
DROP TRIGGER planning_guard ON public."doctor_consulting_rooms";
DROP TRIGGER planning_lock ON public."doctor_consulting_rooms";
DROP TRIGGER planning_guard ON public."consulting_rooms";
DROP TRIGGER planning_lock ON public."consulting_rooms";
DROP TRIGGER planning_guard ON public."appointments";
DROP TRIGGER planning_lock ON public."appointments";
DROP TRIGGER planning_guard ON public."staff";
DROP TRIGGER planning_lock ON public."staff";
DROP TRIGGER planning_guard ON public."user_roles";
DROP TRIGGER planning_lock ON public."user_roles";
CREATE OR REPLACE FUNCTION public.schedule_appointment(p_patient uuid, p_doctor uuid, p_room uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_request uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_weekday integer; v_local_start timestamp; v_local_end timestamp;
BEGIN
 IF NOT (private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_start<=now() OR p_end<=p_start THEN RAISE EXCEPTION 'Horario inválido'; END IF;
 v_local_start=p_start AT TIME ZONE 'America/El_Salvador'; v_local_end=p_end AT TIME ZONE 'America/El_Salvador';
 v_weekday=extract(dow from v_local_start);
 IF v_local_start::date<>v_local_end::date THEN RAISE EXCEPTION 'Cita fuera de jornada'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE s.doctor_id=p_doctor AND s.weekday=v_weekday
 AND v_local_start::date>=s.valid_from AND (s.valid_until IS NULL OR v_local_start::date<=s.valid_until)
 AND v_local_start::time>=s.start_time AND v_local_end::time<=s.end_time) THEN RAISE EXCEPTION 'Doctor fuera de horario'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_absences WHERE staff_id=p_doctor AND tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,p_end,'[)')) THEN RAISE EXCEPTION 'Doctor ausente'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.doctor_consulting_rooms WHERE doctor_id=p_doctor AND consulting_room_id=p_room
 AND starts_at<=p_start AND ends_at>=p_end) THEN RAISE EXCEPTION 'Consultorio no asignado'; END IF;
 IF p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointment_requests WHERE id=p_request AND patient_id=p_patient AND status IN ('pendiente','en_revision')) THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
 INSERT INTO public.appointments(request_id,patient_id,doctor_id,consulting_room_id,starts_at,ends_at,created_by)
 VALUES(p_request,p_patient,p_doctor,p_room,p_start,p_end,auth.uid()) RETURNING id INTO v_id;
 IF p_request IS NOT NULL THEN UPDATE public.appointment_requests SET status='agendada',reviewed_by=auth.uid() WHERE id=p_request; END IF;
 INSERT INTO public.appointment_status_history(appointment_id,new_status,actor_id) VALUES(v_id,'programada',auth.uid());
 RETURN v_id;
END $function$
;
DROP POLICY "schedules_read" ON public."doctor_schedules";
CREATE POLICY "schedules_read" ON public."doctor_schedules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
DROP POLICY "doctor_rooms_read" ON public."doctor_consulting_rooms";
CREATE POLICY "doctor_rooms_read" ON public."doctor_consulting_rooms" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
DROP POLICY "absences_read" ON public."staff_absences";
CREATE POLICY "absences_read" ON public."staff_absences" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((private.has_role('admin'::hospital_role) OR (staff_id = private.my_staff_id()) OR private.has_role('recepcionista'::hospital_role)));
DROP FUNCTION public.save_staff_planning(text,jsonb,uuid,text);
DROP FUNCTION public.read_staff_planning(timestamptz,timestamptz);
DROP FUNCTION public.get_medical_availability(timestamptz,timestamptz,uuid,uuid);
DROP FUNCTION private.planning_guard();
DROP FUNCTION private.assert_staff_planning();
DROP FUNCTION private.planning_valid_slot(uuid,uuid,timestamptz,timestamptz);
DROP FUNCTION private.planning_medical_coverage(uuid,timestamptz,timestamptz);
DROP FUNCTION private.planning_lock();
ALTER TABLE public.doctor_schedules DROP CONSTRAINT planning_finite_schedule;
ALTER TABLE public.staff_absences DROP CONSTRAINT planning_absence_overlap;
ALTER TABLE public.doctor_consulting_rooms DROP CONSTRAINT planning_room_overlap;
ALTER TABLE public.doctor_consulting_rooms DROP CONSTRAINT planning_doctor_overlap;
ALTER TABLE public.doctor_consulting_rooms ADD CONSTRAINT "doctor_consulting_rooms_consulting_room_id_tstzrange_excl" EXCLUDE USING gist (consulting_room_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&);
ALTER TABLE public.doctor_consulting_rooms ADD CONSTRAINT "doctor_consulting_rooms_doctor_id_tstzrange_excl" EXCLUDE USING gist (doctor_id WITH =, tstzrange(starts_at, ends_at, '[)'::text) WITH &&);
DROP INDEX public.planning_schedule_assignment_idx;
DROP INDEX public.planning_schedule_doctor_idx;
-- Existing ACL on schedule_appointment is preserved by CREATE OR REPLACE.
-- No CASCADE; unknown dependencies stop rollback instead of being deleted.
NOTIFY pgrst,'reload schema';
COMMIT;

