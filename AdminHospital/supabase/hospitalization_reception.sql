-- Compatible extension of the shared native iOS admission contract. No seeds.
ALTER TABLE public.beds ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.beds ADD COLUMN IF NOT EXISTS operational_reason text;
ALTER TABLE public.hospital_admissions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.hospital_admissions ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.hospital_admissions ADD COLUMN IF NOT EXISTS medically_discharged_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.hospital_admissions ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.hospital_admissions ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.profiles(id);

CREATE OR REPLACE FUNCTION private.hospital_inventory_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 VALUES(auth.uid(),'inventario_hospitalario',TG_TABLE_NAME,NEW.id::text,
 jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,'after',to_jsonb(NEW)));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.hospital_inventory_audit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hospital_bed_inventory_audit AFTER INSERT OR UPDATE ON public.beds FOR EACH ROW EXECUTE FUNCTION private.hospital_inventory_audit();
CREATE TRIGGER hospital_room_inventory_audit AFTER INSERT OR UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION private.hospital_inventory_audit();

CREATE OR REPLACE FUNCTION public.assign_bed(p_admission uuid,p_bed uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hospital_admissions; b public.beds; k public.room_kind; v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 IF a.status='hospitalizado' THEN
  SELECT id INTO v FROM public.bed_assignments WHERE admission_id=a.id AND bed_id=p_bed AND released_at IS NULL;
  IF v IS NOT NULL THEN RETURN v; END IF;
 END IF;
 IF a.status<>'solicitado' THEN RAISE EXCEPTION 'Este ingreso ya no está pendiente'; END IF;
 PERFORM 1 FROM public.patients p JOIN public.medical_records m ON m.patient_id=p.id WHERE p.id=a.patient_id FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'El paciente no tiene un expediente válido'; END IF;
 -- Lock room before bed, matching inventory operations.
 SELECT r.kind INTO k FROM public.rooms r JOIN public.beds x ON x.room_id=r.id WHERE x.id=p_bed AND r.active FOR UPDATE OF r;
 IF k IS DISTINCT FROM a.requested_kind THEN RAISE EXCEPTION 'La habitación no está activa o su categoría no coincide'; END IF;
 SELECT * INTO b FROM public.beds WHERE id=p_bed FOR UPDATE;
 IF NOT FOUND OR NOT b.active OR b.state<>'disponible' OR EXISTS(SELECT 1 FROM public.bed_assignments WHERE bed_id=p_bed AND released_at IS NULL) THEN RAISE EXCEPTION 'La cama ya no está disponible. Actualiza la consulta.'; END IF;
 IF EXISTS(SELECT 1 FROM public.bed_assignments WHERE patient_id=a.patient_id AND released_at IS NULL) THEN RAISE EXCEPTION 'El paciente ya tiene una cama asignada'; END IF;
 INSERT INTO public.bed_assignments(admission_id,patient_id,bed_id,assigned_by) VALUES(a.id,a.patient_id,b.id,auth.uid()) RETURNING id INTO v;
 UPDATE public.beds SET state='ocupada' WHERE id=b.id;
 UPDATE public.hospital_admissions SET status='hospitalizado' WHERE id=a.id;
 INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(b.id,b.state,'ocupada',auth.uid());
 RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.medical_discharge(p_admission uuid,p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hospital_admissions; d uuid=private.native_doctor_id();
BEGIN
 SELECT * INTO a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND OR a.ordered_by<>d THEN RAISE EXCEPTION 'Alta no autorizada' USING ERRCODE='42501'; END IF;
 IF a.status='alta_medica' AND a.discharge_notes IS NOT DISTINCT FROM nullif(trim(p_notes),'') THEN RETURN; END IF;
 IF a.status<>'hospitalizado' OR coalesce(length(p_notes),0)>10000 THEN RAISE EXCEPTION 'La hospitalización no admite un alta médica'; END IF;
 UPDATE public.hospital_admissions SET status='alta_medica',medically_discharged_at=now(),medically_discharged_by=auth.uid(),discharge_notes=nullif(trim(p_notes),'') WHERE id=a.id;
END $$;

CREATE OR REPLACE FUNCTION public.release_bed(p_admission uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hospital_admissions; b uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ingreso inexistente'; END IF;
 IF a.status='cerrado' AND a.closed_at IS NOT NULL THEN RETURN; END IF;
 -- Legacy medical discharges remain valid with their existing timestamp and audit.
 IF a.status<>'alta_medica' OR a.medically_discharged_at IS NULL THEN RAISE EXCEPTION 'Falta la autorización de alta médica del doctor'; END IF;
 SELECT bed_id INTO b FROM public.bed_assignments WHERE admission_id=a.id AND released_at IS NULL FOR UPDATE;
 IF b IS NULL THEN RAISE EXCEPTION 'No hay una cama activa para este ingreso'; END IF;
 PERFORM 1 FROM public.beds WHERE id=b FOR UPDATE;
 UPDATE public.bed_assignments SET released_at=now() WHERE admission_id=a.id AND released_at IS NULL;
 UPDATE public.beds SET state='limpieza' WHERE id=b;
 UPDATE public.hospital_admissions SET status='cerrado',closed_at=now(),closed_by=auth.uid() WHERE id=a.id;
 INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(b,'ocupada','limpieza',auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.reception_admission_availability(p_admission uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hospital_admissions; v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.hospital_admissions WHERE id=p_admission;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('bed_id',b.id,'bed',b.code,'room_id',r.id,'room',r.code,'category',r.kind,'floor',f.name) ORDER BY r.code,b.code),'[]') INTO v
 FROM public.beds b JOIN public.rooms r ON r.id=b.room_id JOIN public.hospital_floors f ON f.id=r.floor_id
 WHERE a.status='solicitado' AND r.active AND b.active AND r.kind=a.requested_kind AND b.state='disponible'
 AND NOT EXISTS(SELECT 1 FROM public.bed_assignments x WHERE x.bed_id=b.id AND x.released_at IS NULL);
 RETURN jsonb_build_object('beds',v,'checked_at',now(),'reservation',false);
END $$;

CREATE FUNCTION public.reception_review_admission(p_admission uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hospital_admissions;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND OR a.status<>'solicitado' THEN RAISE EXCEPTION 'Solo se revisan solicitudes pendientes'; END IF;
 IF a.reviewed_at IS NOT NULL THEN RETURN; END IF;
 UPDATE public.hospital_admissions SET reviewed_at=now(),reviewed_by=auth.uid() WHERE id=a.id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'revision_ingreso','hospital_admissions',a.id::text,jsonb_build_object('status','solicitado','label','En revisión'));
END $$;

CREATE OR REPLACE FUNCTION public.reception_admissions(p_offset integer DEFAULT 0,p_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR (p_status IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(enum_range(NULL::public.admission_state)) s WHERE s::text=p_status)) THEN RAISE EXCEPTION 'Filtro inválido'; END IF;
 v=private.native_admission_rows(NULL,p_offset,p_status);
 RETURN jsonb_set(v,'{items}',(SELECT coalesce(jsonb_agg(x.item||jsonb_build_object('reviewed_at',a.reviewed_at,'medically_discharged_at',a.medically_discharged_at,'closed_at',a.closed_at) ORDER BY x.ord),'[]') FROM jsonb_array_elements(v->'items') WITH ORDINALITY x(item,ord) JOIN public.hospital_admissions a ON a.id=(x.item->>'id')::uuid));
END $$;

CREATE FUNCTION public.reception_hospital_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('is_admin',private.has_role('admin'),
 'categories',(SELECT jsonb_agg(k::text) FROM unnest(enum_range(NULL::public.room_kind)) k),
 'floors',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.id),'[]') FROM public.hospital_floors f),
 'rooms',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.code),'[]') FROM public.rooms r),
 'beds',(SELECT coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('assignment',(
 SELECT jsonb_build_object('admission_id',x.admission_id,'patient_name',concat_ws(' ',p.first_name,p.last_name),'assigned_at',x.assigned_at)
 FROM public.bed_assignments x JOIN public.patients p ON p.id=x.patient_id WHERE x.bed_id=b.id AND x.released_at IS NULL)) ORDER BY b.code),'[]') FROM public.beds b));
END $$;

CREATE FUNCTION public.reception_hospital_detail(p_admission uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.hospital_admissions;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.hospital_admissions WHERE id=p_admission;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud inexistente'; END IF;
 RETURN to_jsonb(a)||jsonb_build_object('record_number',(SELECT record_code FROM public.medical_records WHERE patient_id=a.patient_id),
 'patient_name',(SELECT concat_ws(' ',first_name,last_name) FROM public.patients WHERE id=a.patient_id),
 'doctor_name',(SELECT concat_ws(' ',p.first_name,p.last_name) FROM public.staff s JOIN public.profiles p ON p.id=s.profile_id WHERE s.id=a.ordered_by),
 'discharged_by_name',(SELECT concat_ws(' ',first_name,last_name) FROM public.profiles WHERE id=a.medically_discharged_by),
 'closed_by_name',(SELECT concat_ws(' ',first_name,last_name) FROM public.profiles WHERE id=a.closed_by),
 'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('bed',b.code,'room',r.code,'category',r.kind,'assigned_at',x.assigned_at,'released_at',x.released_at) ORDER BY x.assigned_at),'[]') FROM public.bed_assignments x JOIN public.beds b ON b.id=x.bed_id JOIN public.rooms r ON r.id=b.room_id WHERE x.admission_id=a.id),
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('action',h.action,'status',h.metadata->>'status','reason',h.metadata->>'reason','label',h.metadata->>'label','at',h.occurred_at,'actor',concat_ws(' ',p.first_name,p.last_name)) ORDER BY h.occurred_at,h.id),'[]') FROM public.audit_logs h LEFT JOIN public.profiles p ON p.id=h.actor_id WHERE h.entity_type='hospital_admissions' AND h.entity_id=a.id::text AND h.action IN ('estado_ingreso','revision_ingreso')));
END $$;

CREATE FUNCTION public.save_hospital_room(p_code text,p_floor smallint,p_kind public.room_kind,p_active boolean,p_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede modificar habitaciones' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_code),'') IS NULL OR length(p_code)>50 OR p_floor IS NULL OR p_kind IS NULL OR p_active IS NULL THEN RAISE EXCEPTION 'Completa código, planta, categoría y estado'; END IF;
 IF p_id IS NULL THEN INSERT INTO public.rooms(code,floor_id,kind,active) VALUES(trim(p_code),p_floor,p_kind,p_active) RETURNING id INTO v;
 ELSE
  PERFORM 1 FROM public.rooms WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Habitación inexistente'; END IF;
  IF EXISTS(SELECT 1 FROM public.bed_assignments a JOIN public.beds b ON b.id=a.bed_id WHERE b.room_id=p_id AND a.released_at IS NULL) THEN RAISE EXCEPTION 'La habitación tiene una hospitalización activa'; END IF;
  UPDATE public.rooms SET code=trim(p_code),floor_id=p_floor,kind=p_kind,active=p_active WHERE id=p_id RETURNING id INTO v;
 END IF;
 RETURN v;
END $$;

CREATE FUNCTION public.save_hospital_bed(p_room uuid,p_code text,p_state public.bed_state,p_active boolean,p_reason text DEFAULT NULL,p_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v uuid; old_b public.beds;
BEGIN
 IF auth.uid() IS NULL OR NOT private.has_role('admin') THEN RAISE EXCEPTION 'Solo administración puede modificar camas' USING ERRCODE='42501'; END IF;
 IF nullif(trim(p_code),'') IS NULL OR length(p_code)>50 OR p_active IS NULL OR p_state IS NULL OR p_state='ocupada' OR coalesce(length(p_reason),0)>2000 THEN RAISE EXCEPTION 'Revisa los datos de la cama. La ocupación requiere un ingreso.'; END IF;
 IF (NOT p_active OR p_state='mantenimiento') AND nullif(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Indica el motivo de mantenimiento o desactivación'; END IF;
 -- Existing beds cannot move between rooms; preserve historical location.
 PERFORM 1 FROM public.rooms WHERE id=p_room FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Habitación inexistente'; END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.beds(room_id,code,state,active,operational_reason) VALUES(p_room,trim(p_code),p_state,p_active,nullif(trim(p_reason),'')) RETURNING id INTO v;
  INSERT INTO public.bed_status_history(bed_id,new_state,actor_id) VALUES(v,p_state,auth.uid());
 ELSE
  SELECT * INTO old_b FROM public.beds WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR old_b.room_id<>p_room THEN RAISE EXCEPTION 'La cama no existe en esta habitación'; END IF;
  IF old_b.state='ocupada' OR EXISTS(SELECT 1 FROM public.bed_assignments WHERE bed_id=p_id AND released_at IS NULL) THEN RAISE EXCEPTION 'No se puede modificar una cama ocupada'; END IF;
  UPDATE public.beds SET code=trim(p_code),state=p_state,active=p_active,operational_reason=nullif(trim(p_reason),'') WHERE id=p_id RETURNING id INTO v;
  IF old_b.state IS DISTINCT FROM p_state THEN INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(v,old_b.state,p_state,auth.uid()); END IF;
 END IF;
 RETURN v;
END $$;

CREATE FUNCTION public.complete_hospital_bed_cleaning(p_bed uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.beds;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.beds WHERE id=p_bed FOR UPDATE;
 IF NOT FOUND OR NOT b.active OR EXISTS(SELECT 1 FROM public.bed_assignments WHERE bed_id=p_bed AND released_at IS NULL) THEN RAISE EXCEPTION 'La cama no se puede habilitar'; END IF;
 IF b.state='disponible' THEN RETURN; END IF;
 IF b.state<>'limpieza' THEN RAISE EXCEPTION 'Solo puedes confirmar la limpieza de una cama pendiente'; END IF;
 UPDATE public.beds SET state='disponible',operational_reason=NULL WHERE id=p_bed;
 INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(p_bed,'limpieza','disponible',auth.uid());
END $$;

REVOKE ALL ON FUNCTION public.reception_review_admission(uuid),public.reception_hospital_inventory(),public.reception_hospital_detail(uuid),public.save_hospital_room(text,smallint,public.room_kind,boolean,uuid),public.save_hospital_bed(uuid,text,public.bed_state,boolean,text,uuid),public.complete_hospital_bed_cleaning(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reception_review_admission(uuid),public.reception_hospital_inventory(),public.reception_hospital_detail(uuid),public.save_hospital_room(text,smallint,public.room_kind,boolean,uuid),public.save_hospital_bed(uuid,text,public.bed_state,boolean,text,uuid),public.complete_hospital_bed_cleaning(uuid) TO authenticated;
