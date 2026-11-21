-- HOSPITAL UNIVERSITARIO - Esquema inicial para un proyecto NUEVO de Supabase
-- Supuestos: 17 camas; VIP asignable por recepción con orden médica; iOS pacientes/doctores;
-- Android recepción/doctores; web administración. Zona horaria de negocio America/El_Salvador.
-- IMPORTANTE: ejecutar como postgres en SQL Editor. No ejecutar sobre un proyecto con tablas homónimas.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TYPE public.hospital_role AS ENUM ('admin','doctor','recepcionista','enfermera','paciente');
CREATE TYPE public.room_kind AS ENUM ('vip','semiprivada');
CREATE TYPE public.bed_state AS ENUM ('disponible','ocupada','limpieza','mantenimiento');
CREATE TYPE public.appointment_state AS ENUM ('programada','confirmada','en_atencion','completada','cancelada','no_asistio');
CREATE TYPE public.request_state AS ENUM ('pendiente','en_revision','agendada','rechazada','cancelada');
CREATE TYPE public.admission_state AS ENUM ('solicitado','asignado','hospitalizado','alta_medica','cerrado','cancelado');
CREATE TYPE public.lab_state AS ENUM ('pendiente','en_proceso','completado');
CREATE TYPE public.ambulance_state AS ENUM ('disponible','en_servicio','en_mantenimiento');
CREATE TYPE public.dispatch_state AS ENUM ('pendiente','autorizada','despachada','finalizada','rechazada','cancelada');

-- IDENTIDAD. El rol no se obtiene de user_metadata modificable por el usuario.
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
 phone text, birth_date date, city text, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_roles (
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 role public.hospital_role NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(user_id,role)
);
CREATE TABLE public.patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
 patient_code text UNIQUE NOT NULL DEFAULT ('PAC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 first_name text NOT NULL, last_name text NOT NULL, dui text UNIQUE,
 phone text, birth_date date, city text,
 registration_source text NOT NULL DEFAULT 'presencial' CHECK (registration_source IN ('ios','presencial')),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES public.profiles(id),
 CHECK (dui IS NULL OR dui ~ '^[0-9]{8}-[0-9]$')
);
CREATE TABLE public.staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid UNIQUE REFERENCES public.profiles(id),
 employee_code text NOT NULL UNIQUE, category text NOT NULL,
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.specialties (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE public.doctor_specialties (
 doctor_id uuid REFERENCES public.staff(id) ON DELETE CASCADE,
 specialty_id bigint REFERENCES public.specialties(id), PRIMARY KEY(doctor_id,specialty_id)
);
CREATE TABLE public.staff_shifts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES public.staff(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 shift_type text NOT NULL DEFAULT 'ordinario', status text NOT NULL DEFAULT 'programado',
 CHECK (ends_at>starts_at), EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE (status <> 'cancelado')
);
CREATE TABLE public.staff_absences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL REFERENCES public.staff(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, reason text,
 CHECK (ends_at>starts_at)
);
CREATE TABLE public.doctor_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id uuid NOT NULL REFERENCES public.staff(id),
 weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_time time NOT NULL, end_time time NOT NULL,
 valid_from date NOT NULL DEFAULT current_date, valid_until date,
 CHECK (end_time>start_time), CHECK(valid_until IS NULL OR valid_until>=valid_from)
);

-- INFRAESTRUCTURA
CREATE TABLE public.hospital_floors(id smallint PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
 floor_id smallint NOT NULL REFERENCES public.hospital_floors(id),
 kind public.room_kind NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.beds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid NOT NULL REFERENCES public.rooms(id),
 code text NOT NULL UNIQUE, state public.bed_state NOT NULL DEFAULT 'disponible'
);
CREATE TABLE public.consulting_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL,
 floor_id smallint REFERENCES public.hospital_floors(id), active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.doctor_consulting_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id uuid NOT NULL REFERENCES public.staff(id),
 consulting_room_id uuid NOT NULL REFERENCES public.consulting_rooms(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 CHECK(ends_at>starts_at),
 EXCLUDE USING gist(consulting_room_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&),
 EXCLUDE USING gist(doctor_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&)
);

-- CITAS
CREATE TABLE public.symptom_catalog(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE TABLE public.appointment_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES public.patients(id),
 specialty_id bigint NOT NULL REFERENCES public.specialties(id),
 preferred_period text NOT NULL CHECK(preferred_period IN ('manana','tarde')),
 reason text NOT NULL, status public.request_state NOT NULL DEFAULT 'pendiente',
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES public.profiles(id)
);
CREATE TABLE public.appointment_request_symptoms (
 request_id uuid REFERENCES public.appointment_requests(id) ON DELETE CASCADE,
 symptom_id bigint REFERENCES public.symptom_catalog(id), PRIMARY KEY(request_id,symptom_id)
);
CREATE TABLE public.appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE REFERENCES public.appointment_requests(id),
 patient_id uuid NOT NULL REFERENCES public.patients(id), doctor_id uuid NOT NULL REFERENCES public.staff(id),
 consulting_room_id uuid NOT NULL REFERENCES public.consulting_rooms(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status public.appointment_state NOT NULL DEFAULT 'programada',
 created_by uuid REFERENCES public.profiles(id), cancellation_reason text,
 cancelled_by uuid REFERENCES public.profiles(id), cancelled_at timestamptz,
 CHECK(ends_at>starts_at),
 EXCLUDE USING gist(doctor_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status IN ('programada','confirmada','en_atencion')),
 EXCLUDE USING gist(consulting_room_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status IN ('programada','confirmada','en_atencion')),
 EXCLUDE USING gist(patient_id WITH =,tstzrange(starts_at,ends_at,'[)') WITH &&) WHERE(status IN ('programada','confirmada','en_atencion'))
);
CREATE TABLE public.appointment_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, appointment_id uuid NOT NULL REFERENCES public.appointments(id),
 old_status public.appointment_state, new_status public.appointment_state NOT NULL,
 actor_id uuid REFERENCES public.profiles(id), changed_at timestamptz NOT NULL DEFAULT now()
);

-- EXPEDIENTE Y CLINICA: separar diagnósticos de antecedentes administrativos
CREATE TABLE public.medical_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL UNIQUE REFERENCES public.patients(id),
 record_code text NOT NULL UNIQUE DEFAULT ('EXP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 opened_at timestamptz NOT NULL DEFAULT now(), opened_by uuid REFERENCES public.profiles(id)
);
CREATE TABLE public.medical_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES public.medical_records(id),
 history_type text NOT NULL, description text NOT NULL,
 recorded_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.clinical_encounters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), record_id uuid NOT NULL REFERENCES public.medical_records(id),
 appointment_id uuid UNIQUE REFERENCES public.appointments(id), doctor_id uuid NOT NULL REFERENCES public.staff(id),
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
CREATE TABLE public.diagnoses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), encounter_id uuid NOT NULL REFERENCES public.clinical_encounters(id),
 diagnosis_code text, description text NOT NULL, notes text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vital_signs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), encounter_id uuid NOT NULL REFERENCES public.clinical_encounters(id),
 weight_kg numeric(6,2) CHECK(weight_kg>0), height_cm numeric(6,2) CHECK(height_cm>0),
 systolic smallint, diastolic smallint, temperature_c numeric(4,1), heart_rate smallint,
 recorded_by uuid NOT NULL REFERENCES public.profiles(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.care_team_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES public.patients(id),
 staff_id uuid NOT NULL REFERENCES public.staff(id), starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz,
 CHECK(ends_at IS NULL OR ends_at>starts_at)
);

-- INGRESOS: una orden del doctor antes de que recepción asigne una cama
CREATE TABLE public.hospital_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES public.patients(id),
 ordered_by uuid NOT NULL REFERENCES public.staff(id), encounter_id uuid REFERENCES public.clinical_encounters(id),
 requested_kind public.room_kind NOT NULL, medical_reason text NOT NULL,
 clinical_instructions text, priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgente')),
 status public.admission_state NOT NULL DEFAULT 'solicitado', ordered_at timestamptz NOT NULL DEFAULT now(),
 medically_discharged_at timestamptz, discharge_notes text,
 UNIQUE(id,patient_id)
);
CREATE UNIQUE INDEX one_active_admission_per_patient ON public.hospital_admissions(patient_id)
 WHERE status IN ('solicitado','asignado','hospitalizado','alta_medica');
CREATE TABLE public.bed_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admission_id uuid NOT NULL REFERENCES public.hospital_admissions(id),
 patient_id uuid NOT NULL REFERENCES public.patients(id), bed_id uuid NOT NULL REFERENCES public.beds(id),
 assigned_by uuid NOT NULL REFERENCES public.profiles(id), assigned_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz, CHECK(released_at IS NULL OR released_at>=assigned_at),
 FOREIGN KEY(admission_id,patient_id) REFERENCES public.hospital_admissions(id,patient_id)
);
CREATE UNIQUE INDEX one_active_patient_bed ON public.bed_assignments(patient_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX one_active_bed_patient ON public.bed_assignments(bed_id) WHERE released_at IS NULL;
CREATE TABLE public.bed_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, bed_id uuid NOT NULL REFERENCES public.beds(id),
 old_state public.bed_state, new_state public.bed_state NOT NULL,
 actor_id uuid REFERENCES public.profiles(id), changed_at timestamptz NOT NULL DEFAULT now()
);

-- LABORATORIO
CREATE TABLE public.lab_test_types (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text UNIQUE NOT NULL,
 description text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.lab_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_code text UNIQUE NOT NULL DEFAULT ('LAB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 encounter_id uuid NOT NULL REFERENCES public.clinical_encounters(id),
 test_type_id bigint NOT NULL REFERENCES public.lab_test_types(id), reason text NOT NULL,
 weight_kg numeric(6,2) CHECK(weight_kg>0), height_cm numeric(6,2) CHECK(height_cm>0),
 status public.lab_state NOT NULL DEFAULT 'pendiente', ordered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.lab_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid UNIQUE NOT NULL REFERENCES public.lab_orders(id),
 summary text NOT NULL, validated_by uuid REFERENCES public.profiles(id), completed_at timestamptz,
 published_to_patient_at timestamptz
);
CREATE TABLE public.lab_result_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), result_id uuid NOT NULL REFERENCES public.lab_results(id),
 storage_path text UNIQUE NOT NULL, mime_type text NOT NULL
);
CREATE TABLE public.lab_delivery_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.lab_orders(id),
 sender_id uuid NOT NULL REFERENCES public.profiles(id), recipient_id uuid REFERENCES public.profiles(id),
 delivery_type text NOT NULL CHECK(delivery_type IN ('a_recepcion','a_paciente')),
 sent_at timestamptz NOT NULL DEFAULT now()
);

-- MEDICAMENTOS
CREATE TABLE public.medications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, presentation text,
 strength text, stock integer NOT NULL DEFAULT 0 CHECK(stock>=0),
 minimum_stock integer NOT NULL DEFAULT 0 CHECK(minimum_stock>=0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.prescriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 prescription_code text UNIQUE NOT NULL DEFAULT ('REC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 encounter_id uuid NOT NULL REFERENCES public.clinical_encounters(id),
 issued_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'pendiente'
 CHECK(status IN ('pendiente','parcial','entregada','anulada'))
);
CREATE TABLE public.prescription_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prescription_id uuid NOT NULL REFERENCES public.prescriptions(id),
 medication_id uuid NOT NULL REFERENCES public.medications(id), dose numeric(10,2) NOT NULL CHECK(dose>0),
 dose_unit text NOT NULL, frequency_hours smallint NOT NULL CHECK(frequency_hours>0),
 route text NOT NULL CHECK(route IN ('oral','inyectable')),
 quantity integer NOT NULL CHECK(quantity>0), observations text
);
CREATE TABLE public.prescription_dispenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prescription_item_id uuid NOT NULL REFERENCES public.prescription_items(id),
 quantity integer NOT NULL CHECK(quantity>0), dispensed_by uuid NOT NULL REFERENCES public.profiles(id),
 dispensed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.inventory_movements (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, medication_id uuid NOT NULL REFERENCES public.medications(id),
 quantity_delta integer NOT NULL CHECK(quantity_delta<>0), reason text NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);

-- AMBULANCIA
CREATE TABLE public.ambulances (
 id smallint PRIMARY KEY CHECK(id=1), code text UNIQUE NOT NULL,
 status public.ambulance_state NOT NULL DEFAULT 'disponible'
);
CREATE TABLE public.ambulance_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES public.patients(id),
 requester_id uuid REFERENCES public.profiles(id), contact_name text NOT NULL, contact_phone text NOT NULL,
 pickup_location text NOT NULL, reason text NOT NULL,
 status public.dispatch_state NOT NULL DEFAULT 'pendiente', requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ambulance_dispatches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE REFERENCES public.ambulance_requests(id),
 ambulance_id smallint NOT NULL REFERENCES public.ambulances(id),
 assigned_staff_id uuid REFERENCES public.staff(id), dispatched_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz
);
CREATE UNIQUE INDEX only_one_active_dispatch ON public.ambulance_dispatches(ambulance_id) WHERE completed_at IS NULL;
CREATE TABLE public.ambulance_status_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ambulance_id smallint NOT NULL REFERENCES public.ambulances(id),
 old_status public.ambulance_state, new_status public.ambulance_state NOT NULL,
 actor_id uuid REFERENCES public.profiles(id), changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.emergency_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, request_id uuid NOT NULL REFERENCES public.ambulance_requests(id),
 event_type text NOT NULL, description text, actor_id uuid REFERENCES public.profiles(id),
 occurred_at timestamptz NOT NULL DEFAULT now()
);

-- COMUNICACION Y AUDITORIA
CREATE TABLE public.announcements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, content text NOT NULL,
 published_at timestamptz, expires_at timestamptz, is_public boolean NOT NULL DEFAULT false,
 created_by uuid REFERENCES public.profiles(id)
);
CREATE TABLE public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES public.profiles(id),
 title text NOT NULL, body text NOT NULL, kind text NOT NULL,
 read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid,
 action text NOT NULL, entity_type text NOT NULL, entity_id text,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now()
);

-- FUNCIONES INTERNAS: esquema no expuesto, sin EXECUTE público.
CREATE FUNCTION private.has_role(p_role public.hospital_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role=p_role AND active) $$;
CREATE FUNCTION private.my_patient(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.patients WHERE id=p_id AND profile_id=(SELECT auth.uid())) $$;
CREATE FUNCTION private.my_staff_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT id FROM public.staff WHERE profile_id=(SELECT auth.uid()) AND active LIMIT 1 $$;
CREATE FUNCTION private.treats_patient(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$
 SELECT private.has_role('doctor') AND EXISTS(
 SELECT 1 FROM public.appointments a WHERE a.patient_id=p_id AND a.doctor_id=private.my_staff_id()
 AND a.status IN ('programada','confirmada','en_atencion','completada')
 UNION ALL SELECT 1 FROM public.clinical_encounters e JOIN public.medical_records m ON m.id=e.record_id
 WHERE m.patient_id=p_id AND e.doctor_id=private.my_staff_id()
 UNION ALL SELECT 1 FROM public.care_team_assignments c WHERE c.patient_id=p_id AND c.staff_id=private.my_staff_id()
 AND c.starts_at<=now() AND (c.ends_at IS NULL OR c.ends_at>now())) $$;
CREATE FUNCTION private.cares_for(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT private.has_role('enfermera') AND EXISTS(
 SELECT 1 FROM public.care_team_assignments WHERE patient_id=p_id AND staff_id=private.my_staff_id()
 AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now())) $$;
CREATE FUNCTION private.encounter_patient(p_encounter uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT m.patient_id FROM public.clinical_encounters e JOIN public.medical_records m ON m.id=e.record_id WHERE e.id=p_encounter $$;
CREATE FUNCTION private.encounter_doctor(p_encounter uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.clinical_encounters WHERE id=p_encounter AND doctor_id=private.my_staff_id()) AND private.has_role('doctor') $$;
CREATE FUNCTION private.can_read_patient(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path='' AS $$ SELECT private.my_patient(p_id) OR private.treats_patient(p_id) OR private.cares_for(p_id) OR private.has_role('admin') OR private.has_role('recepcionista') $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(public.hospital_role),private.my_patient(uuid),private.my_staff_id(),private.treats_patient(uuid),private.cares_for(uuid),private.encounter_patient(uuid),private.encounter_doctor(uuid),private.can_read_patient(uuid) TO authenticated;

-- Alta automática del perfil; NO confiar en role enviado desde iOS.
CREATE FUNCTION private.auth_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.profiles(id,first_name,last_name,phone,birth_date,city)
 VALUES(NEW.id,coalesce(NEW.raw_user_meta_data->>'first_name',''),coalesce(NEW.raw_user_meta_data->>'last_name',''),
 NEW.raw_user_meta_data->>'phone',NULLIF(NEW.raw_user_meta_data->>'birth_date','')::date,NEW.raw_user_meta_data->>'city');
 -- Todo registro público obtiene exclusivamente rol paciente.
 -- Las cuentas del personal se crean por backend y el administrador asigna su rol posteriormente.
 INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,'paciente');
 RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION private.auth_new_user();

-- Funciones RPC expuestas: las operaciones de negocio no dependen de UPDATE directo.
CREATE FUNCTION public.register_patient(p_dui text,p_phone text DEFAULT NULL,p_city text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_p public.profiles%ROWTYPE;
BEGIN
 IF NOT private.has_role('paciente') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 SELECT * INTO v_p FROM public.profiles WHERE id=auth.uid();
 IF v_p.first_name='' OR v_p.last_name='' OR v_p.birth_date IS NULL THEN RAISE EXCEPTION 'Perfil incompleto'; END IF;
 IF EXISTS(SELECT 1 FROM public.patients WHERE profile_id=auth.uid()) THEN RAISE EXCEPTION 'Paciente ya registrado'; END IF;
 INSERT INTO public.patients(profile_id,first_name,last_name,dui,phone,birth_date,city,registration_source)
 VALUES(auth.uid(),v_p.first_name,v_p.last_name,p_dui,coalesce(p_phone,v_p.phone),v_p.birth_date,coalesce(p_city,v_p.city),'ios') RETURNING id INTO v_id;
 INSERT INTO public.medical_records(patient_id) VALUES(v_id);
 RETURN v_id;
END $$;
CREATE FUNCTION public.create_walkin_patient(p_first text,p_last text,p_dui text,p_phone text,p_birth date,p_city text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT (private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF nullif(trim(p_first),'') IS NULL OR nullif(trim(p_last),'') IS NULL THEN RAISE EXCEPTION 'Nombre obligatorio'; END IF;
 INSERT INTO public.patients(first_name,last_name,dui,phone,birth_date,city,registration_source,created_by)
 VALUES(p_first,p_last,p_dui,p_phone,p_birth,p_city,'presencial',auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.medical_records(patient_id,opened_by) VALUES(v_id,auth.uid());
 RETURN v_id;
END $$;
CREATE FUNCTION public.cancel_appointment(p_id uuid,p_reason text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a public.appointments%ROWTYPE;
BEGIN
 SELECT * INTO v_a FROM public.appointments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cita inexistente'; END IF;
 IF NOT (private.my_patient(v_a.patient_id) OR private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF v_a.status NOT IN ('programada','confirmada') THEN RAISE EXCEPTION 'La cita no puede cancelarse'; END IF;
 UPDATE public.appointments SET status='cancelada',cancelled_at=now(),cancelled_by=auth.uid(),cancellation_reason=p_reason WHERE id=p_id;
 INSERT INTO public.appointment_status_history(appointment_id,old_status,new_status,actor_id)
 VALUES(p_id,v_a.status,'cancelada',auth.uid());
END $$;
CREATE FUNCTION public.schedule_appointment(p_patient uuid,p_doctor uuid,p_room uuid,p_start timestamptz,p_end timestamptz,p_request uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_weekday integer; v_local_start timestamp; v_local_end timestamp;
BEGIN
 IF NOT (private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_start<=now() OR p_end<=p_start THEN RAISE EXCEPTION 'Horario inválido'; END IF;
 v_local_start=p_start AT TIME ZONE 'America/El_Salvador'; v_local_end=p_end AT TIME ZONE 'America/El_Salvador';
 v_weekday=extract(dow from v_local_start);
 IF v_local_start::date<>v_local_end::date THEN RAISE EXCEPTION 'Cita fuera de jornada'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.doctor_schedules s WHERE s.doctor_id=p_doctor AND s.weekday=v_weekday
 AND v_local_start::date>=s.valid_from AND (s.valid_until IS NULL OR v_local_start::date<=s.valid_until)
 AND v_local_start::time>=s.start_time AND v_local_end::time<=s.end_time) THEN RAISE EXCEPTION 'Doctor fuera de horario'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_absences WHERE staff_id=p_doctor AND tstzrange(starts_at,ends_at,'[)') && tstzrange(p_start,p_end,'[)')) THEN RAISE EXCEPTION 'Doctor ausente'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.doctor_consulting_rooms WHERE doctor_id=p_doctor AND consulting_room_id=p_room
 AND starts_at<=p_start AND ends_at>=p_end) THEN RAISE EXCEPTION 'Consultorio no asignado'; END IF;
 IF p_request IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointment_requests WHERE id=p_request AND patient_id=p_patient AND status IN ('pendiente','en_revision')) THEN RAISE EXCEPTION 'Solicitud inválida'; END IF;
 INSERT INTO public.appointments(request_id,patient_id,doctor_id,consulting_room_id,starts_at,ends_at,created_by)
 VALUES(p_request,p_patient,p_doctor,p_room,p_start,p_end,auth.uid()) RETURNING id INTO v_id;
 IF p_request IS NOT NULL THEN UPDATE public.appointment_requests SET status='agendada',reviewed_by=auth.uid() WHERE id=p_request; END IF;
 INSERT INTO public.appointment_status_history(appointment_id,new_status,actor_id) VALUES(v_id,'programada',auth.uid());
 RETURN v_id;
END $$;
CREATE FUNCTION public.request_admission(p_patient uuid,p_kind public.room_kind,p_reason text,p_instructions text DEFAULT NULL,p_encounter uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT private.treats_patient(p_patient) OR NOT private.has_role('doctor') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_encounter IS NOT NULL AND (private.encounter_patient(p_encounter) IS DISTINCT FROM p_patient OR NOT private.encounter_doctor(p_encounter)) THEN RAISE EXCEPTION 'Atención inválida'; END IF;
 INSERT INTO public.hospital_admissions(patient_id,ordered_by,encounter_id,requested_kind,medical_reason,clinical_instructions)
 VALUES(p_patient,private.my_staff_id(),p_encounter,p_kind,p_reason,p_instructions) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.assign_bed(p_admission uuid,p_bed uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a public.hospital_admissions%ROWTYPE; v_b public.beds%ROWTYPE; v_kind public.room_kind; v_id uuid;
BEGIN
 IF NOT (private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 SELECT * INTO v_a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND OR v_a.status<>'solicitado' THEN RAISE EXCEPTION 'Ingreso no asignable'; END IF;
 SELECT * INTO v_b FROM public.beds WHERE id=p_bed FOR UPDATE;
 IF NOT FOUND OR v_b.state<>'disponible' THEN RAISE EXCEPTION 'Cama no disponible'; END IF;
 SELECT kind INTO v_kind FROM public.rooms WHERE id=v_b.room_id AND active;
 IF v_kind IS DISTINCT FROM v_a.requested_kind THEN RAISE EXCEPTION 'Tipo de habitación incompatible'; END IF;
 INSERT INTO public.bed_assignments(admission_id,patient_id,bed_id,assigned_by)
 VALUES(p_admission,v_a.patient_id,p_bed,auth.uid()) RETURNING id INTO v_id;
 UPDATE public.beds SET state='ocupada' WHERE id=p_bed;
 UPDATE public.hospital_admissions SET status='hospitalizado' WHERE id=p_admission;
 INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(p_bed,'disponible','ocupada',auth.uid());
 RETURN v_id;
END $$;
CREATE FUNCTION public.medical_discharge(p_admission uuid,p_notes text DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a public.hospital_admissions%ROWTYPE;
BEGIN
 SELECT * INTO v_a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND OR v_a.status<>'hospitalizado' OR v_a.ordered_by<>private.my_staff_id() OR NOT private.has_role('doctor') THEN RAISE EXCEPTION 'Alta no autorizada'; END IF;
 UPDATE public.hospital_admissions SET status='alta_medica',medically_discharged_at=now(),discharge_notes=p_notes WHERE id=p_admission;
END $$;
CREATE FUNCTION public.release_bed(p_admission uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a public.hospital_admissions%ROWTYPE; v_bed uuid;
BEGIN
 IF NOT (private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 SELECT * INTO v_a FROM public.hospital_admissions WHERE id=p_admission FOR UPDATE;
 IF NOT FOUND OR v_a.status<>'alta_medica' THEN RAISE EXCEPTION 'Falta alta médica'; END IF;
 SELECT bed_id INTO v_bed FROM public.bed_assignments WHERE admission_id=p_admission AND released_at IS NULL FOR UPDATE;
 IF v_bed IS NULL THEN RAISE EXCEPTION 'Sin cama activa'; END IF;
 UPDATE public.bed_assignments SET released_at=now() WHERE admission_id=p_admission AND released_at IS NULL;
 UPDATE public.beds SET state='limpieza' WHERE id=v_bed;
 UPDATE public.hospital_admissions SET status='cerrado' WHERE id=p_admission;
 INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(v_bed,'ocupada','limpieza',auth.uid());
END $$;
CREATE FUNCTION public.set_bed_state(p_bed uuid,p_state public.bed_state) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old public.bed_state;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_state='ocupada' THEN RAISE EXCEPTION 'Ocupación solo mediante asignación'; END IF;
 SELECT state INTO v_old FROM public.beds WHERE id=p_bed FOR UPDATE;
 IF NOT FOUND OR v_old='ocupada' OR EXISTS(SELECT 1 FROM public.bed_assignments WHERE bed_id=p_bed AND released_at IS NULL) THEN RAISE EXCEPTION 'Cama ocupada'; END IF;
 UPDATE public.beds SET state=p_state WHERE id=p_bed;
 INSERT INTO public.bed_status_history(bed_id,old_state,new_state,actor_id) VALUES(p_bed,v_old,p_state,auth.uid());
END $$;
CREATE FUNCTION public.dispense_item(p_item uuid,p_qty integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_i public.prescription_items%ROWTYPE; v_p public.prescriptions%ROWTYPE; v_given integer;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF p_qty<=0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
 SELECT * INTO v_i FROM public.prescription_items WHERE id=p_item FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento no encontrado'; END IF;
 SELECT * INTO v_p FROM public.prescriptions WHERE id=v_i.prescription_id FOR UPDATE;
 IF v_p.status IN ('entregada','anulada') THEN RAISE EXCEPTION 'Receta cerrada'; END IF;
 SELECT coalesce(sum(quantity),0) INTO v_given FROM public.prescription_dispenses WHERE prescription_item_id=p_item;
 IF v_given+p_qty>v_i.quantity THEN RAISE EXCEPTION 'Excede cantidad prescrita'; END IF;
 UPDATE public.medications SET stock=stock-p_qty WHERE id=v_i.medication_id AND stock>=p_qty;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuficiente'; END IF;
 INSERT INTO public.prescription_dispenses(prescription_item_id,quantity,dispensed_by) VALUES(p_item,p_qty,auth.uid());
 INSERT INTO public.inventory_movements(medication_id,quantity_delta,reason,actor_id) VALUES(v_i.medication_id,-p_qty,'dispensacion',auth.uid());
 UPDATE public.prescriptions SET status=CASE WHEN NOT EXISTS(
 SELECT 1 FROM public.prescription_items i WHERE i.prescription_id=v_p.id AND
 (SELECT coalesce(sum(d.quantity),0) FROM public.prescription_dispenses d WHERE d.prescription_item_id=i.id)<i.quantity)
 THEN 'entregada' ELSE 'parcial' END WHERE id=v_p.id;
END $$;
CREATE FUNCTION public.dispatch_ambulance(p_request uuid,p_staff uuid DEFAULT NULL) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_a public.ambulances%ROWTYPE; v_r public.ambulance_requests%ROWTYPE; v_id uuid;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 SELECT * INTO v_a FROM public.ambulances WHERE id=1 FOR UPDATE;
 SELECT * INTO v_r FROM public.ambulance_requests WHERE id=p_request FOR UPDATE;
 IF NOT FOUND OR v_r.status<>'pendiente' OR v_a.status<>'disponible' THEN RAISE EXCEPTION 'Despacho no disponible'; END IF;
 INSERT INTO public.ambulance_dispatches(request_id,ambulance_id,assigned_staff_id) VALUES(p_request,1,p_staff) RETURNING id INTO v_id;
 UPDATE public.ambulances SET status='en_servicio' WHERE id=1;
 UPDATE public.ambulance_requests SET status='despachada' WHERE id=p_request;
 INSERT INTO public.ambulance_status_history(ambulance_id,old_status,new_status,actor_id) VALUES(1,'disponible','en_servicio',auth.uid());
 INSERT INTO public.emergency_logs(request_id,event_type,actor_id) VALUES(p_request,'despachada',auth.uid());
 RETURN v_id;
END $$;
CREATE FUNCTION public.complete_dispatch(p_dispatch uuid,p_maintenance boolean DEFAULT false) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_d public.ambulance_dispatches%ROWTYPE;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 PERFORM 1 FROM public.ambulances WHERE id=1 FOR UPDATE;
 SELECT * INTO v_d FROM public.ambulance_dispatches WHERE id=p_dispatch FOR UPDATE;
 IF NOT FOUND OR v_d.completed_at IS NOT NULL THEN RAISE EXCEPTION 'Despacho no activo'; END IF;
 UPDATE public.ambulance_dispatches SET completed_at=now() WHERE id=p_dispatch;
 UPDATE public.ambulance_requests SET status='finalizada' WHERE id=v_d.request_id;
 UPDATE public.ambulances SET status=CASE WHEN p_maintenance THEN 'en_mantenimiento'::public.ambulance_state ELSE 'disponible'::public.ambulance_state END WHERE id=1;
 INSERT INTO public.ambulance_status_history(ambulance_id,old_status,new_status,actor_id)
 VALUES(1,'en_servicio',CASE WHEN p_maintenance THEN 'en_mantenimiento'::public.ambulance_state ELSE 'disponible'::public.ambulance_state END,auth.uid());
 INSERT INTO public.emergency_logs(request_id,event_type,actor_id) VALUES(v_d.request_id,'finalizada',auth.uid());
END $$;

CREATE FUNCTION public.update_appointment_status(p_id uuid,p_state public.appointment_state) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.appointments%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.appointments WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cita inexistente'; END IF;
 IF NOT ((private.has_role('doctor') AND v.doctor_id=private.my_staff_id()) OR private.has_role('recepcionista') OR private.has_role('admin')) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF NOT ((v.status='programada' AND p_state IN ('confirmada','en_atencion','no_asistio')) OR
 (v.status='confirmada' AND p_state IN ('en_atencion','no_asistio')) OR
 (v.status='en_atencion' AND p_state='completada')) THEN RAISE EXCEPTION 'Transición inválida'; END IF;
 UPDATE public.appointments SET status=p_state WHERE id=p_id;
 INSERT INTO public.appointment_status_history(appointment_id,old_status,new_status,actor_id) VALUES(p_id,v.status,p_state,auth.uid());
END $$;
-- Operaciones administrativas y de laboratorio. Se exponen como RPC verificadas.
CREATE FUNCTION public.set_employee_role(p_user uuid,p_role public.hospital_role,p_active boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.has_role('admin') OR p_role='paciente' THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user) THEN RAISE EXCEPTION 'Usuario inexistente'; END IF;
 INSERT INTO public.user_roles(user_id,role,active) VALUES(p_user,p_role,p_active)
 ON CONFLICT(user_id,role) DO UPDATE SET active=excluded.active;
 UPDATE public.user_roles SET active=false WHERE user_id=p_user AND role='paciente';
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id)
 VALUES(auth.uid(),'asignar_rol','user_roles',p_user::text);
END $$;
CREATE FUNCTION public.upsert_staff(p_profile uuid,p_code text,p_category text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile) THEN RAISE EXCEPTION 'Perfil inexistente'; END IF;
 INSERT INTO public.staff(profile_id,employee_code,category) VALUES(p_profile,p_code,p_category)
 ON CONFLICT(profile_id) DO UPDATE SET category=excluded.category
 RETURNING id INTO v_id;
 RETURN v_id;
END $$;
CREATE FUNCTION public.publish_lab_result(p_order uuid,p_summary text,p_to_patient boolean DEFAULT false)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_state public.lab_state;
BEGIN
 IF NOT private.has_role('admin') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 SELECT status INTO v_state FROM public.lab_orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Orden inexistente'; END IF;
 INSERT INTO public.lab_results(order_id,summary,validated_by,completed_at,published_to_patient_at)
 VALUES(p_order,p_summary,auth.uid(),now(),CASE WHEN p_to_patient THEN now() END)
 ON CONFLICT(order_id) DO UPDATE SET summary=excluded.summary,validated_by=excluded.validated_by,
 completed_at=excluded.completed_at,published_to_patient_at=excluded.published_to_patient_at RETURNING id INTO v_id;
 UPDATE public.lab_orders SET status='completado' WHERE id=p_order;
 INSERT INTO public.lab_delivery_events(order_id,sender_id,delivery_type) VALUES(p_order,auth.uid(),CASE WHEN p_to_patient THEN 'a_paciente' ELSE 'a_recepcion' END);
 RETURN v_id;
END $$;
CREATE FUNCTION public.reception_release_lab(p_order uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.has_role('recepcionista') THEN RAISE EXCEPTION 'No autorizado'; END IF;
 UPDATE public.lab_results SET published_to_patient_at=now() WHERE order_id=p_order AND completed_at IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Resultado no preparado'; END IF;
 INSERT INTO public.lab_delivery_events(order_id,sender_id,delivery_type) VALUES(p_order,auth.uid(),'a_paciente');
END $$;
CREATE FUNCTION public.add_inventory(p_medication uuid,p_quantity integer,p_reason text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.has_role('admin') OR p_quantity<=0 THEN RAISE EXCEPTION 'No autorizado'; END IF;
 UPDATE public.medications SET stock=stock+p_quantity WHERE id=p_medication;
 IF NOT FOUND THEN RAISE EXCEPTION 'Medicamento inexistente'; END IF;
 INSERT INTO public.inventory_movements(medication_id,quantity_delta,reason,actor_id)
 VALUES(p_medication,p_quantity,p_reason,auth.uid());
END $$;
-- Los catálogos, turnos y recursos se gestionan con políticas administrativas específicas.
-- Trigger de protección de identidad: el usuario solo puede editar campos de contacto, no su identidad clínica.
CREATE FUNCTION private.protect_profile() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user='authenticated' AND (OLD.first_name IS DISTINCT FROM NEW.first_name OR OLD.last_name IS DISTINCT FROM NEW.last_name OR OLD.birth_date IS DISTINCT FROM NEW.birth_date) THEN
 RAISE EXCEPTION 'Identidad solo modificable por personal autorizado'; END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER protect_profile BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.protect_profile();

-- Datos semilla
INSERT INTO public.hospital_floors VALUES (2,'Segunda planta'),(3,'Tercera planta');
INSERT INTO public.rooms(code,floor_id,kind)
 SELECT 'VIP-'||n,3,'vip'::public.room_kind FROM generate_series(301,305) n
 UNION ALL SELECT 'HAB-'||n,2,'semiprivada'::public.room_kind FROM generate_series(201,206) n;
INSERT INTO public.beds(room_id,code)
 SELECT r.id,r.code||'-A' FROM public.rooms r
 UNION ALL SELECT r.id,r.code||'-B' FROM public.rooms r WHERE r.kind='semiprivada';
INSERT INTO public.specialties(name) VALUES ('Medicina general'),('Cardiología'),('Neurología'),('Alergología'),('Pediatría'),('Medicina de emergencia'),('Medicina interna');
INSERT INTO public.symptom_catalog(name) VALUES ('Fiebre'),('Dolor de cabeza'),('Tos'),('Dolor de pecho'),('Mareo'),('Dificultad respiratoria'),('Dolor abdominal'),('Alergia');
INSERT INTO public.lab_test_types(name,description) VALUES ('Hemograma completo','Análisis de sangre'),('Examen general de orina','Análisis de orina'),('Glucosa','Glucemia'),('Perfil lipídico','Colesterol y triglicéridos'),('Prueba de embarazo','Detección');
INSERT INTO public.ambulances(id,code,status) VALUES (1,'AMB-001','disponible');

-- RLS: denegación por defecto. Solo se conceden operaciones explícitas.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (
 'profiles','user_roles','patients','staff','specialties','doctor_specialties','staff_shifts','staff_absences','doctor_schedules',
 'hospital_floors','rooms','beds','consulting_rooms','doctor_consulting_rooms','symptom_catalog','appointment_requests',
 'appointment_request_symptoms','appointments','appointment_status_history','medical_records','medical_history',
 'clinical_encounters','diagnoses','vital_signs','care_team_assignments','hospital_admissions','bed_assignments',
 'bed_status_history','lab_test_types','lab_orders','lab_results','lab_result_files','lab_delivery_events',
 'medications','prescriptions','prescription_items','prescription_dispenses','inventory_movements',
 'ambulances','ambulance_requests','ambulance_dispatches','ambulance_status_history','emergency_logs',
 'announcements','notifications','audit_logs') LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.tablename);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t.tablename);
 END LOOP;
END $$;

-- Catálogos públicos sin datos personales
GRANT SELECT ON public.specialties,public.symptom_catalog,public.lab_test_types,public.hospital_floors,public.rooms,public.beds,public.announcements TO anon,authenticated;
CREATE POLICY specialties_read ON public.specialties FOR SELECT TO anon,authenticated USING(active);
CREATE POLICY symptoms_read ON public.symptom_catalog FOR SELECT TO anon,authenticated USING(active);
CREATE POLICY labtypes_read ON public.lab_test_types FOR SELECT TO anon,authenticated USING(active);
CREATE POLICY floors_read ON public.hospital_floors FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY rooms_read ON public.rooms FOR SELECT TO anon,authenticated USING(active);
-- Exponer solamente estado físico de camas, sin identidad del paciente.
CREATE POLICY beds_read ON public.beds FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY announcements_read ON public.announcements FOR SELECT TO anon,authenticated
 USING(is_public AND published_at<=now() AND (expires_at IS NULL OR expires_at>now()));

-- Acceso a identidad
GRANT SELECT ON public.profiles,public.user_roles,public.patients,public.staff,public.doctor_specialties,
 public.staff_shifts,public.staff_absences,public.doctor_schedules,public.consulting_rooms,public.doctor_consulting_rooms TO authenticated;
GRANT UPDATE(phone,city) ON public.profiles TO authenticated;
CREATE POLICY profile_read ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid() OR private.has_role('admin'));
CREATE POLICY profile_contact ON public.profiles FOR UPDATE TO authenticated USING(id=auth.uid()) WITH CHECK(id=auth.uid());
CREATE POLICY role_read ON public.user_roles FOR SELECT TO authenticated USING(user_id=auth.uid() OR private.has_role('admin'));
CREATE POLICY patients_read ON public.patients FOR SELECT TO authenticated USING(private.can_read_patient(id));
CREATE POLICY staff_read ON public.staff FOR SELECT TO authenticated USING(true);
CREATE POLICY doctor_specialties_read ON public.doctor_specialties FOR SELECT TO authenticated USING(true);
CREATE POLICY shifts_read ON public.staff_shifts FOR SELECT TO authenticated USING(private.has_role('admin') OR staff_id=private.my_staff_id());
CREATE POLICY absences_read ON public.staff_absences FOR SELECT TO authenticated USING(private.has_role('admin') OR staff_id=private.my_staff_id() OR private.has_role('recepcionista'));
CREATE POLICY schedules_read ON public.doctor_schedules FOR SELECT TO authenticated USING(true);
CREATE POLICY consulting_read ON public.consulting_rooms FOR SELECT TO authenticated USING(true);
CREATE POLICY doctor_rooms_read ON public.doctor_consulting_rooms FOR SELECT TO authenticated USING(true);

GRANT INSERT,UPDATE,DELETE ON public.specialties,public.symptom_catalog,public.lab_test_types,
 public.staff_shifts,public.staff_absences,public.doctor_schedules,public.doctor_specialties,
 public.consulting_rooms,public.doctor_consulting_rooms,public.announcements TO authenticated;
GRANT INSERT,UPDATE(name,presentation,strength,minimum_stock,active) ON public.medications TO authenticated;
GRANT INSERT ON public.medications TO authenticated;

GRANT UPDATE(first_name,last_name,dui,phone,birth_date,city) ON public.patients TO authenticated;
CREATE POLICY patient_admin_update ON public.patients FOR UPDATE TO authenticated USING(private.has_role('admin') OR private.has_role('recepcionista')) WITH CHECK(private.has_role('admin') OR private.has_role('recepcionista'));
CREATE POLICY profile_admin_update ON public.profiles FOR UPDATE TO authenticated USING(private.has_role('admin')) WITH CHECK(private.has_role('admin'));
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['specialties','symptom_catalog','lab_test_types','staff_shifts','staff_absences','doctor_schedules','doctor_specialties','consulting_rooms','doctor_consulting_rooms','announcements','medications'] LOOP
 EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK(private.has_role(''admin''))',n||'_admin_insert',n);
 EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING(private.has_role(''admin'')) WITH CHECK(private.has_role(''admin''))',n||'_admin_update',n);
 IF n <> 'medications' THEN EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING(private.has_role(''admin''))',n||'_admin_delete',n); END IF;
 END LOOP;
END $$;
-- Solicitudes: paciente crea la suya; recepción administra el flujo mediante operaciones autorizadas.
GRANT SELECT,INSERT ON public.appointment_requests TO authenticated;
GRANT SELECT,INSERT ON public.appointment_request_symptoms TO authenticated;
CREATE POLICY req_read ON public.appointment_requests FOR SELECT TO authenticated
 USING(private.my_patient(patient_id) OR private.has_role('recepcionista') OR private.has_role('admin') OR private.treats_patient(patient_id));
CREATE POLICY req_insert ON public.appointment_requests FOR INSERT TO authenticated WITH CHECK(private.my_patient(patient_id) AND status='pendiente' AND reviewed_by IS NULL);
CREATE POLICY req_sym_read ON public.appointment_request_symptoms FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.appointment_requests r WHERE r.id=request_id));
CREATE POLICY req_sym_insert ON public.appointment_request_symptoms FOR INSERT TO authenticated
 WITH CHECK(EXISTS(SELECT 1 FROM public.appointment_requests r WHERE r.id=request_id AND private.my_patient(r.patient_id) AND r.status='pendiente'));
GRANT SELECT ON public.appointments,public.appointment_status_history TO authenticated;
CREATE POLICY appointment_read ON public.appointments FOR SELECT TO authenticated
 USING(private.my_patient(patient_id) OR private.treats_patient(patient_id) OR private.has_role('recepcionista') OR private.has_role('admin'));
CREATE POLICY appointment_history_read ON public.appointment_status_history FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.appointments a WHERE a.id=appointment_id));

-- Expedientes: recepción solo puede leer expediente y antecedentes, nunca diagnósticos.
GRANT SELECT ON public.medical_records,public.medical_history,public.clinical_encounters,public.diagnoses,public.vital_signs,public.care_team_assignments TO authenticated;
CREATE POLICY records_read ON public.medical_records FOR SELECT TO authenticated USING(private.can_read_patient(patient_id));
CREATE POLICY history_read ON public.medical_history FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.medical_records m WHERE m.id=record_id AND private.can_read_patient(m.patient_id)));
CREATE POLICY encounters_read ON public.clinical_encounters FOR SELECT TO authenticated
 USING(private.my_patient(private.encounter_patient(id)) OR private.treats_patient(private.encounter_patient(id)) OR private.cares_for(private.encounter_patient(id)));
CREATE POLICY diagnoses_read ON public.diagnoses FOR SELECT TO authenticated
 USING(private.my_patient(private.encounter_patient(encounter_id)) OR private.treats_patient(private.encounter_patient(encounter_id)));
CREATE POLICY vitals_read ON public.vital_signs FOR SELECT TO authenticated
 USING(private.my_patient(private.encounter_patient(encounter_id)) OR private.treats_patient(private.encounter_patient(encounter_id)) OR private.cares_for(private.encounter_patient(encounter_id)));
CREATE POLICY team_read ON public.care_team_assignments FOR SELECT TO authenticated
 USING(private.has_role('admin') OR private.treats_patient(patient_id) OR private.cares_for(patient_id));
-- Inserción clínica solo para doctor tratante; enfermería para signos vitales de sus pacientes.
GRANT INSERT ON public.clinical_encounters,public.diagnoses,public.vital_signs,public.medical_history TO authenticated;
CREATE POLICY encounters_insert ON public.clinical_encounters FOR INSERT TO authenticated
 WITH CHECK(doctor_id=private.my_staff_id() AND private.has_role('doctor') AND EXISTS(
 SELECT 1 FROM public.medical_records m WHERE m.id=record_id AND private.treats_patient(m.patient_id)));
CREATE POLICY diagnoses_insert ON public.diagnoses FOR INSERT TO authenticated WITH CHECK(private.encounter_doctor(encounter_id));
CREATE POLICY vitals_insert ON public.vital_signs FOR INSERT TO authenticated WITH CHECK(recorded_by=auth.uid() AND
 (private.encounter_doctor(encounter_id) OR private.cares_for(private.encounter_patient(encounter_id))));
CREATE POLICY history_insert ON public.medical_history FOR INSERT TO authenticated WITH CHECK(recorded_by=auth.uid() AND EXISTS(
 SELECT 1 FROM public.medical_records m WHERE m.id=record_id AND (private.treats_patient(m.patient_id) OR private.cares_for(m.patient_id))));

-- Hospitalización: el doctor ordena vía RPC, recepción asigna vía RPC.
GRANT SELECT ON public.hospital_admissions,public.bed_assignments,public.bed_status_history TO authenticated;
CREATE POLICY admission_read ON public.hospital_admissions FOR SELECT TO authenticated
 USING(private.my_patient(patient_id) OR private.treats_patient(patient_id) OR private.has_role('recepcionista') OR private.has_role('admin') OR private.cares_for(patient_id));
CREATE POLICY bedassign_read ON public.bed_assignments FOR SELECT TO authenticated
 USING(private.my_patient(patient_id) OR private.treats_patient(patient_id) OR private.has_role('recepcionista') OR private.has_role('admin') OR private.cares_for(patient_id));
CREATE POLICY bedhistory_read ON public.bed_status_history FOR SELECT TO authenticated USING(private.has_role('admin') OR private.has_role('recepcionista'));

-- Laboratorios: resultados clínicos sin acceso directo para recepción.
GRANT SELECT ON public.lab_orders,public.lab_results,public.lab_result_files,public.lab_delivery_events TO authenticated;
GRANT INSERT ON public.lab_orders TO authenticated;
CREATE POLICY laborder_read ON public.lab_orders FOR SELECT TO authenticated USING(
 private.my_patient(private.encounter_patient(encounter_id)) OR private.treats_patient(private.encounter_patient(encounter_id)) OR private.has_role('recepcionista') OR private.has_role('admin'));
CREATE POLICY laborder_insert ON public.lab_orders FOR INSERT TO authenticated WITH CHECK(private.encounter_doctor(encounter_id) AND status='pendiente');
CREATE POLICY labresult_read ON public.lab_results FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM public.lab_orders o WHERE o.id=order_id AND
 (private.treats_patient(private.encounter_patient(o.encounter_id)) OR
 (published_to_patient_at IS NOT NULL AND private.my_patient(private.encounter_patient(o.encounter_id))))));
CREATE POLICY labfile_read ON public.lab_result_files FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM public.lab_results r JOIN public.lab_orders o ON o.id=r.order_id WHERE r.id=result_id AND
 (private.treats_patient(private.encounter_patient(o.encounter_id)) OR
 (r.published_to_patient_at IS NOT NULL AND private.my_patient(private.encounter_patient(o.encounter_id))))));
CREATE POLICY labdelivery_read ON public.lab_delivery_events FOR SELECT TO authenticated USING(
 sender_id=auth.uid() OR recipient_id=auth.uid() OR private.has_role('admin') OR private.has_role('recepcionista'));

-- Recetas y farmacia
GRANT SELECT ON public.medications,public.prescriptions,public.prescription_items,public.prescription_dispenses TO authenticated;
GRANT INSERT ON public.prescriptions,public.prescription_items TO authenticated;
CREATE POLICY medications_read ON public.medications FOR SELECT TO authenticated USING(true);
CREATE POLICY prescription_read ON public.prescriptions FOR SELECT TO authenticated USING(
 private.my_patient(private.encounter_patient(encounter_id)) OR private.treats_patient(private.encounter_patient(encounter_id)) OR private.has_role('admin'));
CREATE POLICY prescription_insert ON public.prescriptions FOR INSERT TO authenticated WITH CHECK(private.encounter_doctor(encounter_id) AND status='pendiente');
CREATE POLICY prescription_items_read ON public.prescription_items FOR SELECT TO authenticated USING(EXISTS(
 SELECT 1 FROM public.prescriptions p WHERE p.id=prescription_id));
CREATE POLICY prescription_items_insert ON public.prescription_items FOR INSERT TO authenticated WITH CHECK(EXISTS(
 SELECT 1 FROM public.prescriptions p WHERE p.id=prescription_id AND private.encounter_doctor(p.encounter_id) AND p.status='pendiente'));
CREATE POLICY dispense_read ON public.prescription_dispenses FOR SELECT TO authenticated USING(private.has_role('admin') OR EXISTS(
 SELECT 1 FROM public.prescription_items i JOIN public.prescriptions p ON p.id=i.prescription_id WHERE i.id=prescription_item_id
 AND (private.my_patient(private.encounter_patient(p.encounter_id)) OR private.treats_patient(private.encounter_patient(p.encounter_id)))));

-- Ambulancia: el paciente ve solo sus solicitudes; despacho restringido.
GRANT SELECT,INSERT ON public.ambulance_requests TO authenticated;
GRANT SELECT ON public.ambulances,public.ambulance_dispatches,public.ambulance_status_history,public.emergency_logs TO authenticated;
CREATE POLICY ambulance_read ON public.ambulances FOR SELECT TO authenticated USING(true);
CREATE POLICY ambreq_read ON public.ambulance_requests FOR SELECT TO authenticated USING(
 requester_id=auth.uid() OR (patient_id IS NOT NULL AND private.my_patient(patient_id)) OR private.has_role('recepcionista') OR private.has_role('admin') OR (patient_id IS NOT NULL AND private.treats_patient(patient_id)));
CREATE POLICY ambreq_insert ON public.ambulance_requests FOR INSERT TO authenticated WITH CHECK(
 status='pendiente' AND requester_id=auth.uid() AND
 ((private.has_role('paciente') AND patient_id IS NOT NULL AND private.my_patient(patient_id)) OR
 private.has_role('recepcionista') OR private.has_role('admin') OR
 (private.has_role('doctor') AND patient_id IS NOT NULL AND private.treats_patient(patient_id))));
CREATE POLICY dispatch_read ON public.ambulance_dispatches FOR SELECT TO authenticated USING(private.has_role('admin') OR private.has_role('recepcionista') OR EXISTS(
 SELECT 1 FROM public.ambulance_requests r WHERE r.id=request_id AND (r.requester_id=auth.uid() OR (r.patient_id IS NOT NULL AND private.my_patient(r.patient_id)))));
CREATE POLICY ambulance_history_read ON public.ambulance_status_history FOR SELECT TO authenticated USING(private.has_role('admin'));
CREATE POLICY emergency_read ON public.emergency_logs FOR SELECT TO authenticated USING(private.has_role('admin') OR private.has_role('recepcionista'));

GRANT SELECT,UPDATE(read_at) ON public.notifications TO authenticated;
CREATE POLICY notification_read ON public.notifications FOR SELECT TO authenticated USING(recipient_id=auth.uid());
CREATE POLICY notification_update ON public.notifications FOR UPDATE TO authenticated USING(recipient_id=auth.uid()) WITH CHECK(recipient_id=auth.uid());
CREATE POLICY audit_admin_read ON public.audit_logs FOR SELECT TO authenticated USING(private.has_role('admin'));
GRANT SELECT ON public.audit_logs TO authenticated;

-- RPC autorizadas. Por defecto PostgreSQL concede EXECUTE a PUBLIC: revocar explícitamente.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_patient(text,text,text),public.create_walkin_patient(text,text,text,text,date,text),
 public.cancel_appointment(uuid,text),public.schedule_appointment(uuid,uuid,uuid,timestamptz,timestamptz,uuid),
 public.request_admission(uuid,public.room_kind,text,text,uuid),public.assign_bed(uuid,uuid),
 public.medical_discharge(uuid,text),public.release_bed(uuid),public.set_bed_state(uuid,public.bed_state),
 public.dispense_item(uuid,integer),public.dispatch_ambulance(uuid,uuid),public.complete_dispatch(uuid,boolean),
 public.update_appointment_status(uuid,public.appointment_state),
 public.set_employee_role(uuid,public.hospital_role,boolean),public.upsert_staff(uuid,text,text),
 public.publish_lab_result(uuid,text,boolean),public.reception_release_lab(uuid),public.add_inventory(uuid,integer,text)
 TO authenticated;

-- Índices de consulta
CREATE INDEX patients_name_idx ON public.patients(lower(last_name),lower(first_name));
CREATE INDEX appointments_doctor_start_idx ON public.appointments(doctor_id,starts_at);
CREATE INDEX appointments_patient_start_idx ON public.appointments(patient_id,starts_at);
CREATE INDEX appointment_requests_status_idx ON public.appointment_requests(status,created_at);
CREATE INDEX lab_orders_encounter_idx ON public.lab_orders(encounter_id);
CREATE INDEX clinical_encounters_record_idx ON public.clinical_encounters(record_id);
CREATE INDEX hospital_admissions_status_idx ON public.hospital_admissions(status,ordered_at);
CREATE INDEX ambulance_requests_status_idx ON public.ambulance_requests(status,requested_at);

COMMIT;
-- FIN. Operaciones administrativas de altas de empleados, carga de resultados y gestión de catálogos
-- requieren backend seguro (Auth Admin API / Edge Functions) o SQL privilegiado; ver guía adjunta.
