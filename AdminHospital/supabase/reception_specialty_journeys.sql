-- Recepción: médicos y horarios filtrados por la especialidad habilitada en la jornada del día.
-- Misma regla que schedule_appointment: si una jornada recurrente cubre el horario, debe incluir
-- la especialidad en specialty_ids; los consultorios asignados por fecha (legado) no la restringen.
-- Aditivo: reemplaza reception_specialty_doctors y añade reception_specialty_slots. Sin cambios de tablas ni RLS.
BEGIN;

CREATE OR REPLACE FUNCTION private.reception_slot_accepts(p_specialty bigint,p_doctor uuid,p_room uuid,p_start timestamptz,p_end timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.doctor_specialties WHERE doctor_id=p_doctor AND specialty_id=p_specialty)
 AND (NOT EXISTS(SELECT 1 FROM private.recurring_windows(p_start,p_end,p_doctor) w WHERE w.room_id=p_room AND w.starts_at<=p_start AND w.ends_at>=p_end)
  OR EXISTS(SELECT 1 FROM private.recurring_windows(p_start,p_end,p_doctor) w JOIN public.staff_recurring_journeys j ON j.id=w.journey_id
   WHERE w.room_id=p_room AND w.starts_at<=p_start AND w.ends_at>=p_end AND p_specialty=ANY(j.specialty_ids)))
$$;
REVOKE ALL ON FUNCTION private.reception_slot_accepts(bigint,uuid,uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.reception_specialty_slots(p_specialty bigint,p_from timestamptz,p_until timestamptz,p_doctor uuid DEFAULT NULL)
RETURNS TABLE(doctor_id uuid,doctor_name text,consulting_room_id uuid,room_code text,starts_at timestamptz,ends_at timestamptz,slot_minutes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_specialty IS NULL THEN RAISE EXCEPTION 'Selecciona una especialidad' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT a.* FROM public.get_medical_availability(p_from,p_until,p_doctor,NULL) a
  WHERE private.reception_slot_accepts(p_specialty,a.doctor_id,a.consulting_room_id,a.starts_at,a.ends_at)
  ORDER BY a.starts_at,a.room_code;
END $$;

CREATE OR REPLACE FUNCTION public.reception_specialty_doctors(p_specialty bigint,p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from timestamptz=p_day::timestamp AT TIME ZONE 'America/El_Salvador'; v_day_end timestamptz=(p_day+1)::timestamp AT TIME ZONE 'America/El_Salvador';
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_day IS NULL OR p_specialty IS NULL THEN RAISE EXCEPTION 'Selecciona especialidad y fecha' USING ERRCODE='22023'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',s.id,'name',concat_ws(' ',p.first_name,p.last_name),'specialty',sp.name,
 'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',x.starts_at,'ends_at',x.ends_at) ORDER BY x.starts_at),'[]'::jsonb) FROM (
   SELECT a.starts_at,a.ends_at FROM public.staff_shifts a WHERE a.staff_id=s.id AND a.status<>'cancelado' AND a.starts_at<v_from+interval '7 days' AND a.ends_at>v_from
   UNION SELECT w.starts_at,w.ends_at FROM private.recurring_work(v_from,v_from+interval '7 days',s.id) w) x),
 'consultations',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',x.starts_at,'ends_at',x.ends_at,'room_code',x.code,'slot_minutes',x.slot_minutes) ORDER BY x.starts_at),'[]'::jsonb) FROM (
   SELECT a.starts_at,a.ends_at,r.code,a.slot_minutes FROM public.doctor_consulting_rooms a JOIN public.consulting_rooms r ON r.id=a.consulting_room_id AND r.active WHERE a.doctor_id=s.id AND a.active AND a.starts_at<v_from+interval '7 days' AND a.ends_at>v_from
   UNION SELECT w.starts_at,w.ends_at,r.code,w.slot_minutes FROM private.recurring_windows(v_from,v_from+interval '7 days',s.id) w JOIN public.staff_recurring_journeys j ON j.id=w.journey_id JOIN public.consulting_rooms r ON r.id=w.room_id AND r.active WHERE p_specialty=ANY(j.specialty_ids)) x),
 'breaks',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at) ORDER BY a.starts_at),'[]'::jsonb) FROM public.staff_absences a WHERE a.staff_id=s.id AND a.active AND a.starts_at<v_from+interval '7 days' AND a.ends_at>v_from)
 ) ORDER BY p.last_name,p.first_name,s.id),'[]'::jsonb)
 FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id
 JOIN public.doctor_specialties ds ON ds.doctor_id=s.id AND ds.specialty_id=p_specialty
 JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active
 WHERE s.active AND s.category='doctor' AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.role='doctor' AND u.active)
 -- Solo médicos con atención ese día en una jornada que habilita la especialidad (o consultorio por fecha).
 AND (EXISTS(SELECT 1 FROM private.recurring_windows(v_from,v_day_end,s.id) w JOIN public.staff_recurring_journeys j ON j.id=w.journey_id
       WHERE w.starts_at<v_day_end AND w.ends_at>v_from AND p_specialty=ANY(j.specialty_ids))
  OR EXISTS(SELECT 1 FROM public.doctor_consulting_rooms a JOIN public.consulting_rooms r ON r.id=a.consulting_room_id AND r.active
       WHERE a.doctor_id=s.id AND a.active AND a.starts_at<v_day_end AND a.ends_at>v_from
       AND NOT EXISTS(SELECT 1 FROM private.recurring_windows(a.starts_at,a.ends_at,s.id) w WHERE w.room_id=a.consulting_room_id AND w.starts_at<=a.starts_at AND w.ends_at>=a.ends_at))));
END $$;

REVOKE ALL ON FUNCTION public.reception_specialty_slots(bigint,timestamptz,timestamptz,uuid),public.reception_specialty_doctors(bigint,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reception_specialty_slots(bigint,timestamptz,timestamptz,uuid),public.reception_specialty_doctors(bigint,date) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
