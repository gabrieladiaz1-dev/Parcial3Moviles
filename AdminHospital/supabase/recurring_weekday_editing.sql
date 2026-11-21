-- Incremental extension. Never rerun recurring_staff_journeys.sql.
-- Reuses the existing versions, readers, availability and authorization checks.
CREATE FUNCTION private.journey_weekday_set(p_days smallint[]) RETURNS int4multirange
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT range_agg(int4range(d::integer,d::integer+1,'[)')) FROM unnest(p_days)d
$$;
ALTER TABLE public.staff_recurring_journeys
 ADD COLUMN weekday_set int4multirange GENERATED ALWAYS AS (private.journey_weekday_set(weekdays)) STORED;
ALTER TABLE public.staff_recurring_journeys
 DROP CONSTRAINT staff_recurring_journeys_staff_id_effective_period_excl,
 DROP CONSTRAINT staff_recurring_journeys_consulting_room_id_effective_peri_excl;
ALTER TABLE public.staff_recurring_journeys
 ADD CONSTRAINT recurring_employee_weekdays_excl EXCLUDE USING gist
 (staff_id WITH =,effective_period WITH &&,weekday_set WITH &&) DEFERRABLE INITIALLY DEFERRED,
 -- The same doctor may have different hours on different days in the same room.
 -- A room remains exclusively reserved against every OTHER doctor, even on days off.
 ADD CONSTRAINT recurring_fixed_room_excl EXCLUDE USING gist
 (consulting_room_id WITH =,staff_id WITH <>,effective_period WITH &&)
 WHERE (consulting_room_id IS NOT NULL) DEFERRABLE INITIALLY DEFERRED;

-- Existing guards still check appointments, breaks, inactive rooms and dated shifts.
-- Extend the overnight check across a whole week at every version boundary.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('private.assert_staff_planning()'::regprocedure);
 EXECUTE replace(definition,'FUNCTION private.assert_staff_planning(','FUNCTION private.recurring_before_weekday_assert(');
END $$;
CREATE OR REPLACE FUNCTION private.assert_staff_planning() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.recurring_before_weekday_assert();
 IF EXISTS(SELECT 1 FROM public.staff_recurring_journeys marker
  CROSS JOIN LATERAL private.recurring_work(marker.valid_from::timestamp AT TIME ZONE 'America/El_Salvador',(marker.valid_from+8)::timestamp AT TIME ZONE 'America/El_Salvador',marker.staff_id)a
  CROSS JOIN LATERAL private.recurring_work(marker.valid_from::timestamp AT TIME ZONE 'America/El_Salvador',(marker.valid_from+8)::timestamp AT TIME ZONE 'America/El_Salvador',marker.staff_id)b
  WHERE a.journey_id<b.journey_id AND a.ends_at>now()
  AND tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(b.starts_at,b.ends_at,'[)'))
 THEN RAISE EXCEPTION 'El horario se superpone con la jornada nocturna de otro día. Revisa entrada y salida.' USING ERRCODE='23P01'; END IF;
END $$;

CREATE FUNCTION public.save_recurring_journey_scope(
 p_values jsonb,p_id uuid,p_version text,p_key uuid,
 p_weekday integer DEFAULT NULL,p_originals jsonb DEFAULT '[]',p_preview boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.staff_recurring_journeys%ROWTYPE; item public.staff_recurring_journeys%ROWTYPE;
 effective date=(p_values->>'valid_from')::date; employee uuid=(p_values->>'staff_id')::uuid;
 remaining smallint[]; remainder_id uuid; result jsonb; original_ids uuid[];
 payload jsonb=p_values||jsonb_build_object('_scope_id',p_id,'_scope_weekday',p_weekday,'_scope_originals',p_originals);
 today date=(now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede editar jornadas' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_id IS NULL OR employee IS NULL OR effective IS NULL OR effective<=today
  OR p_values->>'active' IS DISTINCT FROM 'true' OR nullif(p_values->>'valid_until','') IS NOT NULL
  OR jsonb_typeof(p_originals) IS DISTINCT FROM 'array' OR jsonb_array_length(p_originals)>100
  OR (p_weekday IS NOT NULL AND p_weekday NOT BETWEEN 0 AND 6)
 THEN RAISE EXCEPTION 'Indica una jornada recurrente y una fecha efectiva futura, sin fecha final' USING ERRCODE='22023'; END IF;
 SELECT * INTO item FROM public.staff_recurring_journeys WHERE id=p_key;
 IF FOUND THEN
  IF item.request_values IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Esta operación ya se utilizó con otros datos' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('id',item.id,'preview',p_preview);
 END IF;
 SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR old.staff_id<>employee OR old.closed_on IS NOT NULL OR NOT old.active
  OR p_version IS DISTINCT FROM (SELECT xmin::text FROM public.staff_recurring_journeys WHERE id=p_id)
 THEN RAISE EXCEPTION 'La jornada cambió. Actualiza antes de editar' USING ERRCODE='40001'; END IF;
 IF effective<old.valid_from OR (old.valid_until IS NOT NULL AND effective>old.valid_until) THEN
  RAISE EXCEPTION 'La fecha efectiva debe estar dentro de la vigencia de la jornada elegida' USING ERRCODE='22023'; END IF;
 IF p_weekday IS NOT NULL AND (p_values->'weekdays' IS DISTINCT FROM jsonb_build_array(p_weekday)) THEN
  RAISE EXCEPTION 'Editar día solo permite modificar el día de la semana seleccionado' USING ERRCODE='22023'; END IF;
 -- All modifications below, including preview, are one transaction/subtransaction.
 BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  IF p_weekday IS NOT NULL THEN
   IF p_weekday NOT BETWEEN 0 AND 6 THEN RAISE EXCEPTION 'Día de la semana inválido' USING ERRCODE='22023'; END IF;
   UPDATE public.staff_recurring_journeys SET closed_on=effective,active=false,last_change_key=p_key,last_change_values=payload WHERE id=p_id;
   SELECT array_agg(d ORDER BY d) INTO remaining FROM unnest(old.weekdays)d WHERE d<>p_weekday;
   IF cardinality(remaining)>0 THEN
    remainder_id=md5(p_key::text||':remaining')::uuid;
    INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,valid_from,valid_until,supersedes,request_values,created_by)
    VALUES(remainder_id,old.staff_id,old.staff_role,remaining,old.start_time,old.end_time,old.shift_type,old.breaks,old.consultations,old.consulting_room_id,old.specialty_id,effective,old.valid_until,old.id,
     jsonb_build_object('preserved_from',old.id,'operation',p_key),auth.uid());
   END IF;
  ELSE
   SELECT array_agg(j.id ORDER BY j.id) INTO original_ids FROM public.staff_recurring_journeys j
    WHERE j.staff_id=employee AND j.active AND j.closed_on IS NULL AND (j.valid_until IS NULL OR j.valid_until>=effective);
   IF cardinality(original_ids) IS DISTINCT FROM jsonb_array_length(p_originals)
    OR EXISTS(SELECT 1 FROM public.staff_recurring_journeys j WHERE j.id=ANY(original_ids)
     AND (j.valid_from>effective OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_originals)x
       WHERE (x->>'id')::uuid=j.id AND x->>'version'=j.xmin::text)))
   THEN RAISE EXCEPTION 'La jornada completa cambió o tiene una vigencia posterior. Actualiza y revisa la fecha efectiva' USING ERRCODE='40001'; END IF;
   PERFORM 1 FROM public.staff_recurring_journeys WHERE id=ANY(original_ids) ORDER BY id FOR UPDATE;
   UPDATE public.staff_recurring_journeys SET closed_on=effective,active=false,last_change_key=p_key,last_change_values=payload WHERE id=ANY(original_ids);
  END IF;
  -- Reuse the deployed validator and final-state checks; never validate an intermediate gap.
  result=public.save_recurring_journey(payload,NULL,NULL,p_key);
  UPDATE public.staff_recurring_journeys SET supersedes=p_id WHERE id=p_key;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  VALUES(auth.uid(),CASE WHEN p_weekday IS NULL THEN 'jornada_completa_editada' ELSE 'dia_recurrente_editado' END,
   'staff_recurring_journeys',p_key::text,jsonb_build_object('weekday',p_weekday,'previous_id',p_id,'effective_from',effective));
  PERFORM private.assert_staff_planning();
  SET CONSTRAINTS ALL IMMEDIATE;
  IF p_preview THEN RAISE EXCEPTION 'Preview rollback' USING ERRCODE='PZ001'; END IF;
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('preview',true,'valid',true);
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean) TO authenticated;
REVOKE ALL ON FUNCTION private.recurring_before_weekday_assert() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
