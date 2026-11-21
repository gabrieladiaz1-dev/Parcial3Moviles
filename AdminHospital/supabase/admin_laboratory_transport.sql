-- Administration owns laboratory processing and ambulance operations.
CREATE OR REPLACE FUNCTION private.lab_permission(p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND private.has_role('admin') AND p_permission IN ('any','process','validate','publish')
$$;
CREATE OR REPLACE FUNCTION private.transport_operator(p_dispatch uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND private.has_role('admin')
$$;
CREATE OR REPLACE FUNCTION public.authorize_laboratory_staff(p_staff uuid,p_process boolean,p_validate boolean,p_publish boolean,p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'El laboratorio es gestionado por administracion' USING ERRCODE='42501'; END $$;
CREATE OR REPLACE FUNCTION public.authorize_panel_driver(p_staff uuid,p_authorized boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'La asignacion de conductores no forma parte del panel' USING ERRCODE='42501'; END $$;
DO $$
DECLARE sig text; source text; changed text;
BEGIN
 FOREACH sig IN ARRAY ARRAY['public.review_medical_transport(uuid,text,text,text)','public.dispatch_ambulance(uuid,uuid)'] LOOP
  source=pg_get_functiondef(sig::regprocedure);
  changed=replace(source,'NOT(private.has_role(''admin'') OR private.has_role(''recepcionista''))','NOT private.has_role(''admin'')');
  IF source=changed THEN RAISE EXCEPTION 'Inspect transport permissions: %',sig; END IF;
  EXECUTE changed;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.assign_medical_transport(p_request uuid,p_ambulance smallint,p_staff uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.ambulance_requests; a public.ambulances; v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(901407021::bigint);
 SELECT * INTO r FROM public.ambulance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 SELECT id INTO v FROM public.ambulance_dispatches WHERE request_id=p_request AND ambulance_id=p_ambulance AND assigned_staff_id IS NULL AND completed_at IS NULL;
 IF v IS NOT NULL AND r.status='despachada' THEN RETURN v; END IF;
 IF r.status NOT IN ('pendiente','autorizada') OR nullif(trim(r.destination),'') IS NULL THEN RAISE EXCEPTION 'La solicitud debe estar pendiente y tener destino confirmado'; END IF;
 IF r.patient_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=r.patient_id) THEN RAISE EXCEPTION 'Falta un expediente válido'; END IF;
 SELECT * INTO a FROM public.ambulances WHERE id=p_ambulance FOR UPDATE;
 IF NOT FOUND OR NOT a.active OR a.status<>'disponible' OR EXISTS(SELECT 1 FROM public.ambulance_dispatches WHERE ambulance_id=p_ambulance AND completed_at IS NULL) THEN RAISE EXCEPTION 'La ambulancia ya no está disponible'; END IF;
 IF p_staff IS NOT NULL THEN RAISE EXCEPTION 'La asignacion de personal no forma parte de este proceso'; END IF;
 INSERT INTO public.ambulance_dispatches(request_id,ambulance_id,assigned_staff_id) VALUES(r.id,a.id,p_staff) RETURNING id INTO v;
 UPDATE public.ambulances SET status='en_servicio' WHERE id=a.id;
 UPDATE public.ambulance_requests SET status='despachada' WHERE id=r.id;
 RETURN v;
END $$;

