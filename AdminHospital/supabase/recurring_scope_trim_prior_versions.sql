-- APLICADO el 20/11/2026 (migración recurring_scope_trim_prior_versions). No volver a ejecutar: se detiene con 'Ya aplicado'.
-- Permite que una edición de jornada (día de la semana o jornada completa) rija desde una fecha anterior al
-- inicio de la versión editada. Las versiones vigentes entre la fecha efectiva y ese inicio se cierran en la
-- fecha efectiva y sus otros días de la semana se conservan en una copia con la misma vigencia.
-- Inserta un paso en save_recurring_journey_scope sin alterar el resto de su lógica.
DO $do$
DECLARE d text; anchor_decl text := $a$today date=(now() AT TIME ZONE 'America/El_Salvador')::date;$a$;
 anchor_body text := $a$  -- Reuse the deployed validator$a$;
BEGIN
 d := pg_get_functiondef('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)'::regprocedure);
 IF position(anchor_decl in d)=0 OR position(anchor_body in d)=0 THEN RAISE EXCEPTION 'Anclas no encontradas'; END IF;
 IF position('prior_version_trim' in d)>0 THEN RAISE EXCEPTION 'Ya aplicado'; END IF;
 d := replace(d, anchor_decl, anchor_decl || $a$
 prev public.staff_recurring_journeys%ROWTYPE; v_upper date; v_new smallint[];$a$);
 d := replace(d, anchor_body, $a$  -- prior_version_trim: when the change starts before the edited version, versions still in force
  -- between the effective date and that start are closed at the effective date; their other weekdays are preserved.
  IF p_values->>'active'='true' THEN
   v_new := ARRAY(SELECT jsonb_array_elements_text(p_values->'weekdays')::smallint);
   v_upper := CASE WHEN p_weekday IS NOT NULL THEN old.valid_from ELSE (SELECT max(valid_from) FROM public.staff_recurring_journeys WHERE id=ANY(original_ids)) END;
   IF v_upper>effective THEN
    FOR prev IN SELECT * FROM public.staff_recurring_journeys j WHERE j.staff_id=employee AND j.id<>p_id AND NOT (j.id=ANY(coalesce(original_ids,'{}'::uuid[])))
     AND NOT isempty(j.effective_period) AND NOT upper_inf(j.effective_period) AND j.effective_period && daterange(effective,v_upper,'[)') AND j.weekdays && v_new
     ORDER BY j.id FOR UPDATE LOOP
     UPDATE public.staff_recurring_journeys SET closed_on=greatest(effective,prev.valid_from),active=false WHERE id=prev.id;
     IF EXISTS(SELECT 1 FROM unnest(prev.weekdays) x WHERE x<>ALL(v_new)) AND upper(prev.effective_period)>greatest(effective,prev.valid_from) THEN
      INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,specialty_ids,valid_from,valid_until,supersedes,request_values,created_by)
      VALUES(md5(p_key::text||':prior:'||prev.id::text)::uuid,prev.staff_id,prev.staff_role,ARRAY(SELECT x FROM unnest(prev.weekdays) x WHERE x<>ALL(v_new) ORDER BY x),prev.start_time,prev.end_time,prev.shift_type,prev.breaks,prev.consultations,prev.consulting_room_id,prev.specialty_id,prev.specialty_ids,
       greatest(effective,prev.valid_from),upper(prev.effective_period)-1,prev.id,jsonb_build_object('preserved_from',prev.id,'operation',p_key),auth.uid());
     END IF;
    END LOOP;
   END IF;
  END IF
;
$a$ || anchor_body);
 EXECUTE d;
END $do$;
