BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $$ BEGIN
 IF to_regprocedure('private.recurring_work(timestamptz,timestamptz,uuid)') IS NULL
 OR to_regprocedure('public.read_staff_planning(timestamptz,timestamptz)') IS NULL THEN
  RAISE EXCEPTION 'Faltan contratos de planificación recurrente. No aplicar esta migración.';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION private.staff_search_normalize(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT pg_catalog.translate(pg_catalog.lower(coalesce(p_value,'')),'áéíóúüñ','aeiouun')
$$;
REVOKE ALL ON FUNCTION private.staff_search_normalize(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.search_planning_staff(p_query text DEFAULT '',p_role text DEFAULT NULL,p_limit integer DEFAULT 40)
RETURNS TABLE(id uuid,profile_id uuid,employee_code text,category text,active boolean,first_name text,last_name text,roles text[],specialties text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE tokens text[];
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede buscar empleados' USING ERRCODE='42501'; END IF;
 IF p_role IS NOT NULL AND p_role NOT IN ('doctor','recepcionista') THEN RAISE EXCEPTION 'Cargo inválido' USING ERRCODE='22023'; END IF;
 tokens=pg_catalog.regexp_split_to_array(private.staff_search_normalize(trim(coalesce(p_query,''))),'[[:space:]]+');
 RETURN QUERY
 WITH candidates AS (
  SELECT s.id,s.profile_id,s.employee_code,s.category,s.active,p.first_name,p.last_name,
   coalesce(pg_catalog.array_agg(DISTINCT sp.name) FILTER(WHERE sp.name IS NOT NULL),ARRAY[]::text[]) specialties,
   private.staff_search_normalize(pg_catalog.concat_ws(' ',p.first_name,p.last_name,s.employee_code,
    CASE s.category WHEN 'doctor' THEN 'doctor doctora médico médica medico medica'
     WHEN 'recepcionista' THEN 'recepcionista recepción recepcion recepcionista' ELSE s.category END,
    pg_catalog.string_agg(DISTINCT sp.name,' '))) searchable
  FROM public.staff s
  LEFT JOIN public.profiles p ON p.id=s.profile_id
  LEFT JOIN public.doctor_specialties ds ON ds.doctor_id=s.id
  LEFT JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active
  WHERE s.category IN('doctor','recepcionista')
   AND (p_role IS NULL OR s.category=p_role)
   AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.active AND u.role::text=s.category)
  GROUP BY s.id,p.first_name,p.last_name
 )
 SELECT c.id,c.profile_id,c.employee_code,c.category,c.active,c.first_name,c.last_name,
  coalesce((SELECT pg_catalog.array_agg(u.role::text) FROM public.user_roles u WHERE u.user_id=c.profile_id AND u.active),ARRAY[]::text[]),
  c.specialties
 FROM candidates c
 WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(tokens) AS token(value)
  WHERE token.value<>'' AND pg_catalog.strpos(c.searchable,token.value)=0)
 ORDER BY c.employee_code,c.last_name,c.first_name
 LIMIT LEAST(GREATEST(coalesce(p_limit,40),1),40);
END $$;

CREATE OR REPLACE FUNCTION public.read_staff_schedule(p_from timestamptz,p_until timestamptz,p_staff uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE person jsonb; recurring jsonb; result jsonb;
 shifts jsonb='[]'; pauses jsonb='[]'; care jsonb='[]';
 base_shifts jsonb; base_pauses jsonb; base_care jsonb;
 saved_shifts jsonb; saved_pauses jsonb; saved_care jsonb;
 w record; j public.staff_recurring_journeys%ROWTYPE; b jsonb; i integer; v text;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede consultar horarios' USING ERRCODE='42501'; END IF;
 IF p_staff IS NULL OR p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>interval '32 days' THEN
  RAISE EXCEPTION 'Empleado o rango de lectura inválido' USING ERRCODE='22023';
 END IF;
 SELECT pg_catalog.to_jsonb(x) INTO person FROM (
  SELECT s.id,s.profile_id,s.employee_code,s.category,s.active,p.first_name,p.last_name,
   coalesce((SELECT pg_catalog.array_agg(u.role::text) FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.active),ARRAY[]::text[]) roles,
   coalesce((SELECT pg_catalog.array_agg(sp.name ORDER BY sp.name) FROM public.doctor_specialties ds JOIN public.specialties sp ON sp.id=ds.specialty_id WHERE ds.doctor_id=s.id),ARRAY[]::text[]) specialties
  FROM public.staff s LEFT JOIN public.profiles p ON p.id=s.profile_id WHERE s.id=p_staff
 ) x;
 IF person IS NULL THEN RAISE EXCEPTION 'El empleado ya no existe. Actualiza la búsqueda.' USING ERRCODE='22023'; END IF;

 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO base_shifts
  FROM (SELECT s.*,s.xmin::text version FROM public.staff_shifts s
   WHERE s.staff_id=p_staff AND s.starts_at<p_until AND s.ends_at>p_from ORDER BY s.starts_at)x;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO base_pauses
  FROM (SELECT a.*,a.xmin::text version FROM public.staff_absences a
   WHERE a.staff_id=p_staff AND a.starts_at<p_until AND a.ends_at>p_from ORDER BY a.starts_at)x;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO base_care
  FROM (SELECT a.*,a.xmin::text version FROM public.doctor_consulting_rooms a
   WHERE a.doctor_id=p_staff AND a.starts_at<p_until AND a.ends_at>p_from ORDER BY a.starts_at)x;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO saved_shifts
  FROM (SELECT s.*,s.xmin::text version FROM public.staff_shifts s WHERE s.staff_id=p_staff ORDER BY s.starts_at)x;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO saved_pauses
  FROM (SELECT a.*,a.xmin::text version FROM public.staff_absences a WHERE a.staff_id=p_staff ORDER BY a.starts_at)x;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO saved_care
  FROM (SELECT a.*,a.xmin::text version FROM public.doctor_consulting_rooms a WHERE a.doctor_id=p_staff ORDER BY a.starts_at)x;

 FOR w IN SELECT * FROM private.recurring_work(p_from,p_until,p_staff) LOOP
  SELECT * INTO j FROM public.staff_recurring_journeys WHERE id=w.journey_id;
  SELECT xmin::text INTO v FROM public.staff_recurring_journeys WHERE id=j.id;
  shifts=shifts||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',md5(j.id::text||w.work_day::text||'shift')::uuid,'staff_id',w.staff_id,'starts_at',w.starts_at,'ends_at',w.ends_at,'shift_type',j.shift_type,'status','programado','version',v,'recurring_id',j.id));
  i=0;
  FOR b IN SELECT value FROM pg_catalog.jsonb_array_elements(j.breaks) LOOP
   pauses=pauses||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',md5(j.id::text||w.work_day::text||'break'||i)::uuid,'staff_id',w.staff_id,'starts_at',private.recurring_instant(w.work_day,(b->>'start_time')::time,j.start_time),'ends_at',private.recurring_instant(w.work_day,(b->>'end_time')::time,j.start_time),'reason','Descanso: '||(b->>'reason'),'active',true,'version',v,'recurring_id',j.id)); i=i+1;
  END LOOP;
  i=0;
  FOR b IN SELECT value FROM pg_catalog.jsonb_array_elements(j.consultations) LOOP
   care=care||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',md5(j.id::text||w.work_day::text||'care'||i)::uuid,'doctor_id',w.staff_id,'starts_at',private.recurring_instant(w.work_day,(b->>'start_time')::time,j.start_time),'ends_at',private.recurring_instant(w.work_day,(b->>'end_time')::time,j.start_time),'consulting_room_id',j.consulting_room_id,'slot_minutes',(b->>'slot_minutes')::integer,'active',true,'version',v,'recurring_id',j.id)); i=i+1;
  END LOOP;
 END LOOP;

 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) INTO recurring
  FROM (SELECT r.*,r.xmin::text version FROM public.staff_recurring_journeys r WHERE r.staff_id=p_staff ORDER BY r.valid_from,r.created_at)x;
 result=pg_catalog.jsonb_build_object(
  'ready',true,'staff',pg_catalog.jsonb_build_array(person),
  'rooms',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x)),'[]'::jsonb) FROM
   (SELECT r.*,r.xmin::text version FROM public.consulting_rooms r ORDER BY r.code)x),'floors','[]'::jsonb,
  'recurring_ready',true,'recurring_journeys',coalesce(recurring,'[]'::jsonb),
  'doctor_specialties',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('doctor_id',ds.doctor_id,'specialty_id',sp.id,'name',sp.name)),'[]'::jsonb)
   FROM public.doctor_specialties ds JOIN public.specialties sp ON sp.id=ds.specialty_id AND sp.active WHERE ds.doctor_id=p_staff),
  'shifts',base_shifts||shifts,'saved_shifts',saved_shifts||shifts,
  'absences',base_pauses||pauses,'saved_absences',saved_pauses||pauses,
  'consultations',base_care||care,'saved_consultations',saved_care||care);
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.search_planning_staff(text,text,integer),public.read_staff_schedule(timestamptz,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_planning_staff(text,text,integer),public.read_staff_schedule(timestamptz,timestamptz,uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.planning_revision(id boolean PRIMARY KEY DEFAULT true CHECK(id),revision bigint NOT NULL DEFAULT 0);
INSERT INTO public.planning_revision(id,revision) VALUES(true,0) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.planning_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planning_revision FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.planning_revision TO authenticated;
DROP POLICY IF EXISTS planning_revision_read ON public.planning_revision;
CREATE POLICY planning_revision_read ON public.planning_revision FOR SELECT TO authenticated
 USING(private.has_role('admin') OR private.has_role('recepcionista') OR private.has_role('doctor'));

CREATE OR REPLACE FUNCTION private.notify_planning_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed_user_id uuid;
BEGIN
 IF TG_LEVEL='ROW' THEN
  IF TG_TABLE_NAME='user_roles' THEN
   IF TG_OP='DELETE' THEN changed_user_id=OLD.user_id; ELSE changed_user_id=NEW.user_id; END IF;
  ELSE
   IF TG_OP='DELETE' THEN changed_user_id=OLD.id; ELSE changed_user_id=NEW.id; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.staff WHERE public.staff.profile_id=changed_user_id) THEN
   UPDATE public.planning_revision SET revision=revision+1 WHERE id;
  END IF;
 ELSE
  UPDATE public.planning_revision SET revision=revision+1 WHERE id;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_planning_revision() FROM PUBLIC,anon,authenticated;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['staff_recurring_journeys','staff_shifts','staff_absences','doctor_consulting_rooms','consulting_rooms','appointments','staff','doctor_specialties','specialties'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS planning_revision_changed ON public.%I',t);
  EXECUTE format('CREATE TRIGGER planning_revision_changed AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.notify_planning_revision()',t);
 END LOOP;
 DROP TRIGGER IF EXISTS planning_revision_changed ON public.profiles;
 CREATE TRIGGER planning_revision_changed AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.notify_planning_revision();
 DROP TRIGGER IF EXISTS planning_revision_changed ON public.user_roles;
 CREATE TRIGGER planning_revision_changed AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION private.notify_planning_revision();
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_publication WHERE pubname='supabase_realtime')
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='planning_revision') THEN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_revision';
 END IF;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
