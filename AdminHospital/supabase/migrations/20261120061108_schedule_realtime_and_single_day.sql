-- Incremental: preserve the deployed validators and mobile RPC contracts.
CREATE TABLE public.planning_revision (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), revision bigint NOT NULL DEFAULT 0
);
INSERT INTO public.planning_revision VALUES(true,0);
ALTER TABLE public.planning_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planning_revision FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.planning_revision TO authenticated;
CREATE POLICY planning_revision_read ON public.planning_revision FOR SELECT TO authenticated
 USING (private.has_role('admin') OR private.has_role('recepcionista') OR private.has_role('doctor'));
CREATE FUNCTION private.notify_planning_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN UPDATE public.planning_revision SET revision=revision+1 WHERE id; RETURN NULL; END $$;
REVOKE ALL ON FUNCTION private.notify_planning_revision() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['staff_recurring_journeys','staff_shifts','staff_absences','doctor_consulting_rooms','consulting_rooms','appointments'] LOOP
 EXECUTE format('CREATE TRIGGER planning_revision_changed AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION private.notify_planning_revision()',t);
 END LOOP;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.planning_revision;

-- Keep the existing validator private so internal edits can still take effect today.
DO $$ DECLARE d text; BEGIN
 d=pg_get_functiondef('public.save_recurring_journey(jsonb,uuid,text,uuid)'::regprocedure);
 EXECUTE replace(d,'FUNCTION public.save_recurring_journey(','FUNCTION private.save_journey_validated(');
 d=pg_get_functiondef('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)'::regprocedure);
 d=replace(d,'public.save_recurring_journey(payload','private.save_journey_validated(payload');
 d=replace(d, $text$p_values->>'active' IS DISTINCT FROM 'true'$text$, $text$coalesce(p_values->>'active','') NOT IN ('true','false')$text$);
 d=replace(d, 'SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;',
 'SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;
 IF old.last_change_key=p_key AND old.last_change_values=payload THEN RETURN jsonb_build_object(''id'',p_id); END IF;');
 d=replace(d, 'result=private.save_journey_validated(payload,NULL,NULL,p_key);',
 'IF p_values->>''active''=''false'' THEN result=jsonb_build_object(''id'',p_id);
 ELSE result=private.save_journey_validated(payload,NULL,NULL,p_key); END IF;');
 EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION private.save_journey_validated(jsonb,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.save_recurring_journey(p_values jsonb,p_id uuid DEFAULT NULL,p_version text DEFAULT NULL,p_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_id IS NULL AND (p_values->>'valid_from')::date=(now() AT TIME ZONE 'America/El_Salvador')::date THEN
  p_values=p_values||jsonb_build_object('valid_from',(now() AT TIME ZONE 'America/El_Salvador')::date+1);
 END IF;
 RETURN private.save_journey_validated(p_values,p_id,p_version,p_key);
END $$;

CREATE FUNCTION public.save_recurring_journey_day(p_values jsonb,p_id uuid,p_version text,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.staff_recurring_journeys%ROWTYPE; duplicate public.staff_recurring_journeys%ROWTYPE;
 day date=(p_values->>'valid_from')::date; enabled boolean=coalesce((p_values->>'active')::boolean,true);
 payload jsonb=p_values||jsonb_build_object('_single_id',p_id); result jsonb;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(726391054201::bigint);
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede editar jornadas' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_key IS NULL OR day IS NULL OR day<(now() AT TIME ZONE 'America/El_Salvador')::date THEN
  RAISE EXCEPTION 'Selecciona una fecha de hoy o posterior' USING ERRCODE='22023'; END IF;
 SELECT * INTO old FROM public.staff_recurring_journeys WHERE id=p_id FOR UPDATE;
 IF old.last_change_key=p_key AND old.last_change_values=payload THEN
  RETURN jsonb_build_object('id',CASE WHEN enabled THEN p_key ELSE p_id END);
 END IF;
 IF old.id IS NULL OR old.staff_id IS DISTINCT FROM (p_values->>'staff_id')::uuid OR old.closed_on IS NOT NULL
 OR p_version IS DISTINCT FROM (SELECT xmin::text FROM public.staff_recurring_journeys WHERE id=p_id) THEN
  RAISE EXCEPTION 'La jornada cambió. Cierra el editor y vuelve a abrir la fecha actualizada.' USING ERRCODE='40001'; END IF;
 IF NOT (old.effective_period @> day) OR NOT (extract(dow FROM day)::smallint=ANY(old.weekdays)) THEN
  RAISE EXCEPTION 'La fecha no pertenece a esta jornada' USING ERRCODE='22023'; END IF;
 SET CONSTRAINTS ALL DEFERRED;
 UPDATE public.staff_recurring_journeys SET closed_on=day,active=false,last_change_key=p_key,last_change_values=payload WHERE id=p_id;
 -- Resume every original weekday after this occurrence; no rule covers the replaced day.
 IF old.valid_until IS NULL OR old.valid_until>day THEN
  INSERT INTO public.staff_recurring_journeys(id,staff_id,staff_role,weekdays,start_time,end_time,shift_type,breaks,consultations,consulting_room_id,specialty_id,valid_from,valid_until,supersedes,request_values,created_by)
  VALUES(md5(p_key::text||':resume')::uuid,old.staff_id,old.staff_role,old.weekdays,old.start_time,old.end_time,old.shift_type,old.breaks,old.consultations,old.consulting_room_id,old.specialty_id,day+1,old.valid_until,old.id,jsonb_build_object('preserved_from',old.id),auth.uid());
 END IF;
 IF enabled THEN
  result=private.save_journey_validated(payload||jsonb_build_object('weekdays',jsonb_build_array(extract(dow FROM day)::integer),'valid_until',day),NULL,NULL,p_key);
  UPDATE public.staff_recurring_journeys SET supersedes=p_id WHERE id=p_key;
 ELSE result=jsonb_build_object('id',p_id); END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 VALUES(auth.uid(),CASE WHEN enabled THEN 'jornada_fecha_editada' ELSE 'jornada_fecha_desactivada' END,'staff_recurring_journeys',p_id::text,jsonb_build_object('date',day,'operation',p_key));
 PERFORM private.assert_staff_planning();
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_recurring_journey_day(jsonb,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_recurring_journey_day(jsonb,uuid,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
