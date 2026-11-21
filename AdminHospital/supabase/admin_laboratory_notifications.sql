-- New laboratory requests are handled by active administrators.
DO $$
DECLARE source text; changed text; start_at integer; end_at integer;
BEGIN
 source=pg_get_functiondef('private.laboratory_notifications()'::regprocedure);
 start_at=strpos(source,'  SELECT DISTINCT s.profile_id');
 end_at=strpos(source,'  ON CONFLICT(recipient_id,event_key)');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Inspect laboratory notification recipients'; END IF;
 changed=left(source,start_at-1)||$replacement$
  SELECT DISTINCT r.user_id,'Nueva orden de laboratorio','Hay un examen pendiente de procesamiento.','laboratorio','lab_orders',NEW.id::text,'lab:'||NEW.id::text||':new'
  FROM public.user_roles r LEFT JOIN public.panel_preferences pref ON pref.user_id=r.user_id
  WHERE r.role='admin' AND r.active AND coalesce(pref.laboratory,true) AND r.user_id IS DISTINCT FROM auth.uid()
$replacement$||substr(source,end_at);
 EXECUTE changed;
END $$;
