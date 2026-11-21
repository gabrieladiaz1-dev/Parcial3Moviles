-- Bounded operational reads. No clinical notes, absence reasons or Auth data.
CREATE OR REPLACE FUNCTION public.reception_doctor_day(p_doctor uuid,p_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from timestamptz=p_day::timestamp AT TIME ZONE 'America/El_Salvador';
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_day IS NULL OR NOT EXISTS(SELECT 1 FROM public.staff WHERE id=p_doctor AND active AND category='doctor') THEN RAISE EXCEPTION 'Médico o fecha no disponible'; END IF;
 RETURN jsonb_build_object(
 'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at)),'[]'::jsonb) FROM public.staff_shifts s WHERE s.staff_id=p_doctor AND s.status<>'cancelado' AND s.starts_at<v_from+interval '1 day' AND s.ends_at>v_from),
 'consultations',(SELECT coalesce(jsonb_agg(jsonb_build_object('starts_at',a.starts_at,'ends_at',a.ends_at,'room_code',r.code,'slot_minutes',a.slot_minutes)),'[]'::jsonb) FROM public.doctor_consulting_rooms a JOIN public.consulting_rooms r ON r.id=a.consulting_room_id WHERE a.doctor_id=p_doctor AND a.active AND a.starts_at<v_from+interval '1 day' AND a.ends_at>v_from));
END $$;
CREATE OR REPLACE FUNCTION public.reception_agenda(p_day date)
RETURNS TABLE(id uuid,request_id uuid,patient_id uuid,starts_at timestamptz,ends_at timestamptz,status public.appointment_state,consulting_room_id uuid,doctor_id uuid,patient_name text,doctor_name text,room_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_day IS NULL THEN RAISE EXCEPTION 'Selecciona una fecha'; END IF;
 RETURN QUERY SELECT a.id,a.request_id,a.patient_id,a.starts_at,a.ends_at,a.status,a.consulting_room_id,a.doctor_id,
 concat_ws(' ',p.first_name,p.last_name),concat_ws(' ',pr.first_name,pr.last_name),r.code
 FROM public.appointments a JOIN public.patients p ON p.id=a.patient_id JOIN public.staff s ON s.id=a.doctor_id JOIN public.profiles pr ON pr.id=s.profile_id JOIN public.consulting_rooms r ON r.id=a.consulting_room_id
 WHERE a.starts_at>=p_day::timestamp AT TIME ZONE 'America/El_Salvador' AND a.starts_at<(p_day+1)::timestamp AT TIME ZONE 'America/El_Salvador'
 ORDER BY a.starts_at,a.id LIMIT 200;
END $$;
REVOKE ALL ON FUNCTION public.reception_doctor_day(uuid,date),public.reception_agenda(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reception_doctor_day(uuid,date),public.reception_agenda(date) TO authenticated;
