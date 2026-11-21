-- A real assessment assignment, not an appointment or clinical encounter.
CREATE TABLE public.admission_assessments (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES public.patients(id),
 doctor_id uuid NOT NULL REFERENCES public.staff(id), team_assignment_id uuid NOT NULL UNIQUE REFERENCES public.care_team_assignments(id),
 requested_by uuid NOT NULL REFERENCES public.profiles(id), requested_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000), priority text NOT NULL CHECK(priority IN ('normal','urgente')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired')),
 assessment text NOT NULL DEFAULT '' CHECK(length(assessment)<=10000), version integer NOT NULL DEFAULT 0,
 decided_by uuid REFERENCES public.profiles(id), decided_at timestamptz,
 admission_id uuid UNIQUE REFERENCES public.hospital_admissions(id),
 CHECK((status='approved' AND admission_id IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
 OR (status='rejected' AND admission_id IS NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
 OR (status IN ('pending','expired') AND admission_id IS NULL AND decided_by IS NULL AND decided_at IS NULL))
);
CREATE UNIQUE INDEX one_pending_admission_assessment ON public.admission_assessments(patient_id) WHERE status='pending';
CREATE INDEX admission_assessment_doctor_queue ON public.admission_assessments(doctor_id,requested_at) WHERE status='pending';
ALTER TABLE public.admission_assessments ENABLE ROW LEVEL SECURITY;
-- Read through scoped RPCs: reception gets decision metadata, never the clinical note.
REVOKE ALL ON public.admission_assessments FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.reception_request_admission_assessment(p_patient uuid,p_doctor uuid,p_reason text,p_priority text,p_key uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.admission_assessments; team uuid; doc_user uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR nullif(trim(p_reason),'') IS NULL OR length(p_reason)>2000 OR p_priority IS NULL OR p_priority NOT IN ('normal','urgente') THEN RAISE EXCEPTION 'Completa motivo y prioridad'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('admission-assessment:'||p_patient::text,0));
 SELECT * INTO r FROM public.admission_assessments WHERE id=p_key;
 IF FOUND THEN
  IF r.patient_id IS DISTINCT FROM p_patient OR r.doctor_id IS DISTINCT FROM p_doctor OR r.reason IS DISTINCT FROM trim(p_reason) OR r.priority IS DISTINCT FROM p_priority OR r.requested_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'El envío ya existe con otros datos'; END IF;
  RETURN r.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=p_patient) THEN RAISE EXCEPTION 'Expediente inexistente'; END IF;
 SELECT s.profile_id INTO doc_user FROM public.staff s WHERE s.id=p_doctor AND s.active AND s.category='doctor' AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.role='doctor' AND u.active) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona un médico activo'; END IF;
 UPDATE public.admission_assessments a SET status='expired',version=version+1 WHERE a.patient_id=p_patient AND a.status='pending' AND EXISTS(SELECT 1 FROM public.care_team_assignments c WHERE c.id=a.team_assignment_id AND c.ends_at<=now());
 IF EXISTS(SELECT 1 FROM public.admission_assessments WHERE patient_id=p_patient AND status='pending') THEN RAISE EXCEPTION 'Este paciente ya tiene una valoración pendiente. Consulta su seguimiento.'; END IF;
 IF EXISTS(SELECT 1 FROM public.hospital_admissions WHERE patient_id=p_patient AND status IN ('solicitado','asignado','hospitalizado','alta_medica')) THEN RAISE EXCEPTION 'El paciente ya tiene un ingreso activo. Continúa desde Hospitalización.'; END IF;
 INSERT INTO public.care_team_assignments(patient_id,staff_id,starts_at,ends_at) VALUES(p_patient,p_doctor,now()-interval '1 microsecond',now()+interval '24 hours') RETURNING id INTO team;
 INSERT INTO public.admission_assessments(id,patient_id,doctor_id,team_assignment_id,requested_by,reason,priority) VALUES(p_key,p_patient,p_doctor,team,auth.uid(),trim(p_reason),p_priority);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'solicitar_valoracion_ingreso','admission_assessments',p_key::text,jsonb_build_object('patient_id',p_patient,'doctor_id',p_doctor));
 INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key) VALUES(doc_user,'Valoración presencial pendiente','Tienes una solicitud de valoración asignada.','hospitalizacion','admission_assessments',p_key::text,'assessment:'||p_key::text||':requested') ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 RETURN p_key;
END $$;

CREATE FUNCTION public.admission_assessment_context(p_patient uuid DEFAULT NULL,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE reception boolean=private.has_role('admin') OR private.has_role('recepcionista'); doctor uuid; items jsonb; total bigint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF NOT reception THEN doctor=private.native_doctor_id(); END IF;
 IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Paginacion invalida'; END IF;
 SELECT count(*) INTO total FROM public.admission_assessments a WHERE (reception OR a.doctor_id=doctor) AND (p_patient IS NULL OR a.patient_id=p_patient);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.requested_at,x.id),'[]') INTO items FROM (
  SELECT a.id,a.patient_id,concat_ws(' ',p.first_name,p.last_name) patient_name,m.record_code,a.doctor_id,concat_ws(' ',dp.first_name,dp.last_name) doctor_name,
   a.requested_at,a.reason,a.priority,CASE WHEN a.status='pending' AND c.ends_at<=now() THEN 'expired' ELSE a.status END status,
   a.version,a.decided_by,a.decided_at,a.admission_id,c.ends_at access_until,
   CASE WHEN NOT reception AND a.doctor_id=doctor THEN a.assessment ELSE NULL END assessment
  FROM public.admission_assessments a JOIN public.patients p ON p.id=a.patient_id JOIN public.medical_records m ON m.patient_id=p.id
  JOIN public.staff ds ON ds.id=a.doctor_id JOIN public.profiles dp ON dp.id=ds.profile_id JOIN public.care_team_assignments c ON c.id=a.team_assignment_id
  WHERE (reception OR a.doctor_id=doctor) AND (p_patient IS NULL OR a.patient_id=p_patient)
  ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,a.requested_at,a.id LIMIT 100 OFFSET p_offset
 )x;
 RETURN jsonb_build_object('items',items,'total',total,'has_more',total>p_offset+100,'next_offset',CASE WHEN total>p_offset+100 THEN p_offset+100 END,'doctors',CASE WHEN reception THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',concat_ws(' ',p.first_name,p.last_name),'code',s.employee_code) ORDER BY p.last_name),'[]') FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id WHERE s.active AND s.category='doctor' AND EXISTS(SELECT 1 FROM public.user_roles u WHERE u.user_id=s.profile_id AND u.role='doctor' AND u.active)) ELSE '[]'::jsonb END);
END $$;

CREATE FUNCTION public.doctor_save_admission_assessment(p_assessment uuid,p_version integer,p_notes text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE doctor uuid=private.native_doctor_id(); a public.admission_assessments;
BEGIN
 SELECT * INTO a FROM public.admission_assessments WHERE id=p_assessment AND doctor_id=doctor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Valoración no asignada' USING ERRCODE='42501'; END IF;
 IF a.status<>'pending' OR NOT EXISTS(SELECT 1 FROM public.care_team_assignments WHERE id=a.team_assignment_id AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())) THEN RAISE EXCEPTION 'La valoración ya no está pendiente o el acceso expiró'; END IF;
 IF a.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'La valoración cambió. Actualiza antes de guardar' USING ERRCODE='40001'; END IF;
 IF p_notes IS NULL OR length(p_notes)>10000 THEN RAISE EXCEPTION 'Valoración inválida'; END IF;
 UPDATE public.admission_assessments SET assessment=trim(p_notes),version=version+1 WHERE id=a.id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'guardar_valoracion_ingreso','admission_assessments',a.id::text,jsonb_build_object('version',a.version+1));
 RETURN a.version+1;
END $$;

CREATE FUNCTION public.doctor_decide_admission_assessment(p_assessment uuid,p_version integer,p_decision text,p_notes text,p_kind public.room_kind DEFAULT NULL,p_instructions text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE doctor uuid=private.native_doctor_id(); a public.admission_assessments; admission uuid;
BEGIN
 SELECT * INTO a FROM public.admission_assessments WHERE id=p_assessment AND doctor_id=doctor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Valoración no asignada' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') OR nullif(trim(p_notes),'') IS NULL OR length(p_notes)>10000 THEN RAISE EXCEPTION 'Registra la valoración y una decisión válida'; END IF;
 IF a.status=p_decision AND a.assessment=trim(p_notes) AND a.version=p_version+1 THEN
  IF p_decision='approved' AND NOT EXISTS(SELECT 1 FROM public.hospital_admissions WHERE id=a.admission_id AND requested_kind IS NOT DISTINCT FROM p_kind AND clinical_instructions IS NOT DISTINCT FROM nullif(trim(p_instructions),'')) THEN RAISE EXCEPTION 'La decisión ya fue registrada con otros datos'; END IF;
  RETURN jsonb_build_object('status',a.status,'admission_id',a.admission_id,'version',a.version);
 END IF;
 IF a.status<>'pending' OR a.version IS DISTINCT FROM p_version OR NOT EXISTS(SELECT 1 FROM public.care_team_assignments WHERE id=a.team_assignment_id AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())) THEN RAISE EXCEPTION 'La valoración cambió, expiró o ya fue resuelta'; END IF;
 IF p_decision='approved' THEN
  admission=public.doctor_native_admission_request(a.patient_id,p_kind,a.reason,p_instructions,a.priority,NULL,a.id);
  UPDATE public.care_team_assignments SET ends_at=NULL WHERE id=a.team_assignment_id;
 ELSE
  UPDATE public.care_team_assignments SET ends_at=now() WHERE id=a.team_assignment_id;
 END IF;
 UPDATE public.admission_assessments SET status=p_decision,assessment=trim(p_notes),decided_by=auth.uid(),decided_at=now(),admission_id=admission,version=version+1 WHERE id=a.id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'decidir_valoracion_ingreso','admission_assessments',a.id::text,jsonb_build_object('decision',p_decision,'admission_id',admission,'version',a.version+1));
 INSERT INTO public.notifications(recipient_id,title,body,kind,entity_type,entity_id,event_key) VALUES(a.requested_by,'Valoración presencial resuelta','El médico registró una decisión. Consulta el seguimiento.','hospitalizacion',CASE WHEN admission IS NULL THEN 'admission_assessments' ELSE 'hospital_admissions' END,coalesce(admission,a.id)::text,'assessment:'||a.id::text||':decided') ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING;
 RETURN jsonb_build_object('status',p_decision,'admission_id',admission,'version',a.version+1);
END $$;
REVOKE ALL ON FUNCTION public.reception_request_admission_assessment(uuid,uuid,text,text,uuid),public.admission_assessment_context(uuid,integer),public.doctor_save_admission_assessment(uuid,integer,text),public.doctor_decide_admission_assessment(uuid,integer,text,text,public.room_kind,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reception_request_admission_assessment(uuid,uuid,text,text,uuid),public.admission_assessment_context(uuid,integer),public.doctor_save_admission_assessment(uuid,integer,text),public.doctor_decide_admission_assessment(uuid,integer,text,text,public.room_kind,text) TO authenticated;
