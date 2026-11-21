-- Extend the existing notification stream and add only missing panel settings.
CREATE TABLE public.hospital_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), name text, about text, affiliation text,
 email text, phone text, address text, latitude numeric, longitude numeric,
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.profiles(id),
 CHECK(latitude BETWEEN -90 AND 90), CHECK(longitude BETWEEN -180 AND 180),
 CHECK((latitude IS NULL)=(longitude IS NULL)),
 CHECK(length(name)<=150 AND length(about)<=6000 AND length(affiliation)<=250 AND length(address)<=1000 AND length(email)<=254 AND length(phone)<=50)
);
ALTER TABLE public.hospital_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.hospital_settings TO authenticated;
CREATE POLICY panel_settings_read ON public.hospital_settings FOR SELECT TO authenticated USING(private.has_role('admin') OR private.has_role('recepcionista'));

CREATE TABLE public.panel_preferences (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 attention boolean NOT NULL DEFAULT true, admissions boolean NOT NULL DEFAULT true,
 ambulance boolean NOT NULL DEFAULT true, poll_seconds integer NOT NULL DEFAULT 60 CHECK(poll_seconds IN (30,60,120))
);
ALTER TABLE public.panel_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.panel_preferences TO authenticated;
CREATE POLICY panel_preferences_read ON public.panel_preferences FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND (private.has_role('admin') OR private.has_role('recepcionista')));

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS event_key text;
CREATE UNIQUE INDEX notification_event_once ON public.notifications(recipient_id,event_key) WHERE event_key IS NOT NULL;
CREATE INDEX notifications_recipient_time ON public.notifications(recipient_id,created_at DESC);
CREATE INDEX notifications_unread_recipient ON public.notifications(recipient_id) WHERE read_at IS NULL;

CREATE FUNCTION public.save_hospital_settings(p_values jsonb,p_version text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede editar la información institucional' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('name','about','affiliation','email','phone','address','latitude','longitude')) THEN RAISE EXCEPTION 'Revisa los campos institucionales'; END IF;
 PERFORM pg_advisory_xact_lock(901407020::bigint);
 SELECT h.xmin::text INTO v FROM public.hospital_settings h WHERE id FOR UPDATE;
 IF FOUND AND v IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'La información cambió. Actualiza antes de guardar.'; END IF;
 IF nullif(trim(p_values->>'name'),'') IS NULL THEN RAISE EXCEPTION 'Escribe el nombre del hospital'; END IF;
 IF nullif(trim(p_values->>'email'),'') IS NOT NULL AND p_values->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Revisa el correo institucional'; END IF;
 INSERT INTO public.hospital_settings(id,name,about,affiliation,email,phone,address,latitude,longitude,updated_by)
 VALUES(true,trim(p_values->>'name'),nullif(trim(p_values->>'about'),''),nullif(trim(p_values->>'affiliation'),''),nullif(trim(p_values->>'email'),''),nullif(trim(p_values->>'phone'),''),nullif(trim(p_values->>'address'),''),nullif(p_values->>'latitude','')::numeric,nullif(p_values->>'longitude','')::numeric,auth.uid())
 ON CONFLICT(id) DO UPDATE SET name=excluded.name,about=excluded.about,affiliation=excluded.affiliation,email=excluded.email,phone=excluded.phone,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now(),updated_by=auth.uid();
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id) VALUES(auth.uid(),'actualizar_institucion','hospital_settings','true');
END $$;

CREATE FUNCTION public.panel_institution() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN (SELECT to_jsonb(h)||jsonb_build_object('version',h.xmin::text) FROM public.hospital_settings h WHERE id);
END $$;

CREATE FUNCTION public.my_panel_preferences(p_values jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_values IS NOT NULL THEN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('attention','admissions','ambulance','poll_seconds')) THEN RAISE EXCEPTION 'Preferencias inválidas'; END IF;
  INSERT INTO public.panel_preferences(user_id,attention,admissions,ambulance,poll_seconds)
  VALUES(auth.uid(),(p_values->>'attention')::boolean,(p_values->>'admissions')::boolean,(p_values->>'ambulance')::boolean,(p_values->>'poll_seconds')::integer)
  ON CONFLICT(user_id) DO UPDATE SET attention=excluded.attention,admissions=excluded.admissions,ambulance=excluded.ambulance,poll_seconds=excluded.poll_seconds;
 END IF;
 RETURN coalesce((SELECT to_jsonb(p)-'user_id' FROM public.panel_preferences p WHERE user_id=auth.uid()),'{"attention":true,"admissions":true,"ambulance":true,"poll_seconds":60}'::jsonb);
END $$;

CREATE FUNCTION private.emit_panel_notice(p_kind text,p_title text,p_body text,p_entity text,p_id text,p_key text,p_admin_only boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key)
 SELECT DISTINCT r.user_id,p_title,p_body,p_kind,p_entity,p_id,p_key FROM public.user_roles r
 LEFT JOIN public.panel_preferences pref ON pref.user_id=r.user_id
 WHERE r.active AND (r.role='admin' OR (NOT p_admin_only AND r.role='recepcionista'))
 AND r.user_id IS DISTINCT FROM auth.uid()
 AND CASE p_kind WHEN 'atencion' THEN coalesce(pref.attention,true) WHEN 'hospitalizacion' THEN coalesce(pref.admissions,true) WHEN 'ambulancia' THEN coalesce(pref.ambulance,true) ELSE false END
 ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION private.emit_panel_notice(text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.panel_clinical_notice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='appointment_requests' THEN
  IF TG_OP='INSERT' AND NEW.status='pendiente' THEN PERFORM private.emit_panel_notice('atencion','Nueva solicitud de atención','Hay una solicitud pendiente de revisión.','appointment_requests',NEW.id::text,'attention:'||NEW.id::text); END IF;
 ELSE
  IF TG_OP='INSERT' AND NEW.status='solicitado' THEN PERFORM private.emit_panel_notice('hospitalizacion','Nueva solicitud de hospitalización','Revisa la indicación y la disponibilidad de camas.','hospital_admissions',NEW.id::text,'admission:'||NEW.id::text);
  ELSIF TG_OP='UPDATE' AND NEW.status='alta_medica' AND OLD.status IS DISTINCT FROM NEW.status THEN PERFORM private.emit_panel_notice('hospitalizacion','Alta médica registrada','Una hospitalización tiene salida administrativa pendiente.','hospital_admissions',NEW.id::text,'discharge:'||NEW.id::text); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.panel_clinical_notice() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER panel_attention_notice AFTER INSERT ON public.appointment_requests FOR EACH ROW EXECUTE FUNCTION private.panel_clinical_notice();
CREATE TRIGGER panel_admission_notice AFTER INSERT OR UPDATE OF status ON public.hospital_admissions FOR EACH ROW EXECUTE FUNCTION private.panel_clinical_notice();

CREATE FUNCTION public.my_panel_notifications(p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Página inválida'; END IF;
 RETURN jsonb_build_object('items',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC,n.id DESC),'[]') FROM (SELECT id,title,body,kind,read_at,created_at,entity_type,entity_id FROM public.notifications WHERE recipient_id=auth.uid() ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET p_offset)n),
 'unread',(SELECT count(*) FROM public.notifications WHERE recipient_id=auth.uid() AND read_at IS NULL),
 'has_more',(SELECT count(*)>p_offset+30 FROM public.notifications WHERE recipient_id=auth.uid()));
END $$;

CREATE FUNCTION public.read_panel_notification(p_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET read_at=now() WHERE recipient_id=auth.uid() AND read_at IS NULL AND (p_id IS NULL OR id=p_id);
END $$;

CREATE FUNCTION public.my_panel_profile() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN (SELECT to_jsonb(p)||jsonb_build_object('version',p.xmin::text,'email',u.email,'account_created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,'roles',(SELECT jsonb_agg(role::text ORDER BY role::text) FROM public.user_roles WHERE user_id=p.id AND active)) FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=auth.uid());
END $$;

-- Only fields already allowed for personal contact are editable for reception.
CREATE FUNCTION public.save_my_panel_profile(p_phone text,p_city text,p_version text,p_first text DEFAULT NULL,p_last text DEFAULT NULL,p_birth date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF coalesce(length(p_phone),0)>50 OR coalesce(length(p_city),0)>120 THEN RAISE EXCEPTION 'Revisa teléfono y ciudad'; END IF;
 SELECT xmin::text INTO v FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR v IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'El perfil cambió. Actualiza antes de guardar.'; END IF;
 IF private.has_role('admin') THEN
  IF nullif(trim(p_first),'') IS NULL OR nullif(trim(p_last),'') IS NULL OR length(p_first)>100 OR length(p_last)>100 OR p_birth>current_date OR p_birth<current_date-interval '120 years' THEN RAISE EXCEPTION 'Revisa nombre, apellidos y fecha de nacimiento'; END IF;
  UPDATE public.profiles SET first_name=trim(p_first),last_name=trim(p_last),birth_date=p_birth,phone=nullif(trim(p_phone),''),city=nullif(trim(p_city),'') WHERE id=auth.uid();
 ELSE
  UPDATE public.profiles SET phone=nullif(trim(p_phone),''),city=nullif(trim(p_city),'') WHERE id=auth.uid();
 END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id) VALUES(auth.uid(),'actualizar_mi_perfil','profiles',auth.uid()::text);
END $$;

REVOKE ALL ON FUNCTION public.save_hospital_settings(jsonb,text),public.panel_institution(),public.my_panel_preferences(jsonb),public.my_panel_notifications(integer),public.read_panel_notification(uuid),public.my_panel_profile(),public.save_my_panel_profile(text,text,text,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_hospital_settings(jsonb,text),public.panel_institution(),public.my_panel_preferences(jsonb),public.my_panel_notifications(integer),public.read_panel_notification(uuid),public.my_panel_profile(),public.save_my_panel_profile(text,text,text,text,text,date) TO authenticated;
