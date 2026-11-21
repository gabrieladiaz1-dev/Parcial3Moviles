-- Avisos públicos (enunciado: «Información pública: ... avisos generales»). Administración los crea, edita y retira.
-- La RLS de lectura (announcements_read) solo muestra avisos públicos vigentes a todos, también al administrador; por eso
-- la gestión usa RPC SECURITY DEFINER exclusivas de administración. Sin cambios de tablas ni de RLS.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_announcements()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'content',a.content,'published_at',a.published_at,
   'expires_at',a.expires_at,'is_public',a.is_public,'author',nullif(concat_ws(' ',p.first_name,p.last_name),''))
   ORDER BY coalesce(a.published_at,'infinity'::timestamptz) DESC, a.id)
  FROM public.announcements a LEFT JOIN public.profiles p ON p.id=a.created_by),'[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.save_announcement(p_title text, p_content text, p_is_public boolean,
  p_published_at timestamptz DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL, p_id uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v uuid; v_published timestamptz := coalesce(p_published_at, now());
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_title),'') IS NULL OR length(p_title)>200 OR nullif(trim(p_content),'') IS NULL OR length(p_content)>2000 OR p_is_public IS NULL THEN
   RAISE EXCEPTION 'Escribe un título (hasta 200 caracteres) y el contenido del aviso (hasta 2000)' USING ERRCODE='22023'; END IF;
 IF p_expires_at IS NOT NULL AND p_expires_at <= v_published THEN
   RAISE EXCEPTION 'La fecha de vencimiento debe ser posterior a la de publicación' USING ERRCODE='22023'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.announcements(title,content,published_at,expires_at,is_public,created_by)
  VALUES(trim(p_title),trim(p_content),v_published,p_expires_at,p_is_public,auth.uid()) RETURNING id INTO v;
 ELSE
  UPDATE public.announcements SET title=trim(p_title),content=trim(p_content),published_at=v_published,expires_at=p_expires_at,is_public=p_is_public
  WHERE id=p_id RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Aviso inexistente' USING ERRCODE='P0002'; END IF;
 END IF;
 RETURN v;
END $function$;

-- Retirar: el aviso deja de ser visible al instante y se conserva el historial.
CREATE OR REPLACE FUNCTION public.retire_announcement(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 UPDATE public.announcements SET expires_at=now() WHERE id=p_id AND (expires_at IS NULL OR expires_at>now());
 IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.announcements WHERE id=p_id) THEN RAISE EXCEPTION 'Aviso inexistente' USING ERRCODE='P0002'; END IF;
END $function$;

REVOKE ALL ON FUNCTION public.admin_announcements(), public.save_announcement(text,text,boolean,timestamptz,timestamptz,uuid), public.retire_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_announcements(), public.save_announcement(text,text,boolean,timestamptz,timestamptz,uuid), public.retire_announcement(uuid) TO authenticated;

COMMIT;
