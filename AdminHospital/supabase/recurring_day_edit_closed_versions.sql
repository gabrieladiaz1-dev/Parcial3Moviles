-- APLICADO el 20/11/2026 (migración recurring_day_edit_closed_versions). No volver a ejecutar: se detiene con 'Anclas no encontradas'.
-- «Editar día» (save_recurring_journey_day) acepta también versiones que ya tienen fecha de fin, siempre que
-- la fecha elegida esté dentro de su vigencia, y reanuda la versión hasta su propio fin (closed_on o valid_until).
DO $do$
DECLARE d text;
 a1 text := $a$ OR old.closed_on IS NOT NULL
 OR p_version$a$;
 a2 text := $a$ IF old.valid_until IS NULL OR old.valid_until>day THEN$a$;
 a3 text := $a$day+1,old.valid_until,old.id,$a$;
BEGIN
 d := pg_get_functiondef('public.save_recurring_journey_day(jsonb,uuid,text,uuid)'::regprocedure);
 IF position(a1 in d)=0 OR position(a2 in d)=0 OR position(a3 in d)=0 THEN RAISE EXCEPTION 'Anclas no encontradas'; END IF;
 d := replace(d, a1, $a$
 OR p_version$a$);
 d := replace(d, a2, $a$ IF upper_inf(old.effective_period) OR upper(old.effective_period)-1>day THEN$a$);
 d := replace(d, a3, $a$day+1,CASE WHEN upper_inf(old.effective_period) THEN NULL ELSE upper(old.effective_period)-1 END,old.id,$a$);
 EXECUTE d;
END $do$;
