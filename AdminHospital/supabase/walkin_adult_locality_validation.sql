-- Locality literals generated from src/lib/elSalvadorLocalities.ts; do not maintain a second catalog.
CREATE OR REPLACE FUNCTION public.create_walkin_patient(p_first text, p_last text, p_dui text, p_phone text, p_birth date, p_city text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid; existing public.patients; document text=nullif(trim(p_dui),'');
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;

 IF p_birth IS NULL OR p_birth>((now() AT TIME ZONE 'America/El_Salvador')::date-interval '18 years')::date THEN
  RAISE EXCEPTION 'El paciente debe tener al menos 18 años. Comprueba su fecha de nacimiento' USING ERRCODE='22023',HINT='birth'; END IF;
 IF p_city IS NULL OR NOT (trim(p_city)=ANY(ARRAY['Atiquizaya','El Refugio','San Lorenzo','Turín','Ahuachapán','Apaneca','Concepción de Ataco','Tacuba','Guaymango','Jujutla','San Francisco Menéndez','San Pedro Puxtla','Aguilares','El Paisnal','Guazapa','Apopa','Nejapa','Ilopango','San Martín','Soyapango','Tonacatepeque','Ayutuxtepeque','Mejicanos','San Salvador','Cuscatancingo','Ciudad Delgado','Panchimalco','Rosario de Mora','San Marcos','Santo Tomás','Santiago Texacuangos','Quezaltepeque','San Matías','San Pablo Tacachico','San Juan Opico','Ciudad Arce','Colón','Jayaque','Sacacoyo','Tepecoyo','Talnique','Antiguo Cuscatlán','Huizúcar','Nuevo Cuscatlán','San José Villanueva','Zaragoza','Chiltuipán','Jicalapa','La Libertad','Tamanique','Teotepeque','Comasagua','Santa Tecla','La Palma','Citalá','San Ignacio','Nueva Concepción','Tejutla','La Reina','Agua Caliente','Dulce Nombre de María','El Paraíso','San Francisco Morazán','San Rafael','Santa Rita','San Fernando','Chalatenango','Arcatao','Azacualpa','Comalapa','Concepción Quezaltepeque','El Carrizal','La Laguna','Las Vueltas','Nombre de Jesús','Nueva Trinidad','Ojos de Agua','Potonico','San Antonio de La Cruz','San Antonio Los Ranchos','San Francisco Lempa','San Isidro Labrador','San José Cancasque','San Miguel de Mercedes','San José Las Flores','San Luis del Carmen','Suchitoto','San José Guayabal','Oratorio de Concepción','San Bartolomé Perulapán','San Pedro Perulapán','Cojutepeque','San Rafael Cedros','Candelaria','Monte San Juan','El Carmen','San Cristóbal','Santa Cruz Michapa','San Ramón','El Rosario','Santa Cruz Analquito','Tenancingo','Sensuntepeque','Victoria','Dolores','Guacotecti','San Isidro','Ilobasco','Tejutepeque','Jutiapa','Cinquera','Cuyultitán','Olocuilta','San Juan Talpa','San Luis Talpa','San Pedro Masahuat','Tapalhuaca','San Francisco Chinameca','Jerusalén','Mercedes La Ceiba','Paraíso de Osorio','San Antonio Masahuat','San Emigdio','San Juan Tepezontes','San Luis La Herradura','San Miguel Tepezontes','San Pedro Nonualco','Santa María Ostuma','Santiago Nonualco','San Juan Nonualco','San Rafael Obrajuelo','Zacatecoluca','Anamorós','Bolívar','Concepción de Oriente','El Sauce','Lislique','Nueva Esparta','Pasaquina','Polorós','San José La Fuente','Santa Rosa de Lima','Conchagua','Intipucá','La Unión','Meanguera del Golfo','San Alejo','Yayantique','Yucuaiquín','Santiago de María','Alegría','Berlín','Mercedes Umaña','Jucuapa','El Triunfo','Estanzuelas','San Buenaventura','Nueva Granada','Usulután','Jucuarán','San Dionisio','Concepción Batres','Santa María','Ozatlán','Tecapán','Santa Elena','California','Ereguayquín','Jiquilisco','Puerto El Triunfo','San Agustín','San Francisco Javier','Juayúa','Nahuizalco','Salcoatitán','Santa Catarina Masahuat','Sonsonate','Sonzacate','Nahulingo','San Antonio del Monte','Santo Domingo de Guzmán','Izalco','Armenia','Caluco','San Julián','Cuisnahuat','Santa Isabel Ishuatán','Acajutla','Masahuat','Metapán','Santa Rosa Guachipilín','Texistepeque','Santa Ana','Coatepeque','El Congo','Candelaria de la Frontera','Chalchuapa','El Porvenir','San Antonio Pajonal','San Sebastián Salitrillo','Santiago de La Frontera','Apastepeque','Santa Clara','San Ildefonso','San Esteban Catarina','San Sebastián','Santo Domingo','San Vicente','Guadalupe','Verapaz','Tepetitán','Tecoluca','San Cayetano Istepeque','Ciudad Barrios','Sesori','Nuevo Edén de San Juan','San Gerardo','San Luis de La Reina','Carolina','San Antonio del Mosco','Chapeltique','San Miguel','Comacarán','Uluazapa','Moncagua','Quelepa','Chirilagua','Chinameca','Nueva Guadalupe','Lolotique','San Jorge','San Rafael Oriente','El Tránsito','Arambala','Cacaopera','Corinto','Joateca','Jocoaitique','Meanguera','Perquín','Torola','Chilanga','Delicias de Concepción','El Divisadero','Gualococti','Guatajiagua','Jocoro','Lolotiquillo','Osicala','San Carlos','San Francisco Gotera','San Simón','Sensembra','Sociedad','Yamabal','Yoloaiquín']::text[])) THEN
  RAISE EXCEPTION 'Selecciona una localidad válida de El Salvador en la lista' USING ERRCODE='22023',HINT='city'; END IF;
 IF nullif(trim(p_first),'') IS NULL OR nullif(trim(p_last),'') IS NULL OR length(trim(p_first))>100 OR length(trim(p_last))>100
 OR (p_birth IS NOT NULL AND (p_birth>current_date OR p_birth<(current_date-interval '120 years')::date))
 OR coalesce(length(p_city),0)>120 OR (nullif(trim(p_phone),'') IS NOT NULL AND trim(p_phone)!~'^[0-9]{4}-[0-9]{4}$') THEN
  RAISE EXCEPTION 'Revisa nombres, nacimiento, teléfono (0000-0000) y ciudad' USING ERRCODE='22023'; END IF;
 IF document IS NOT NULL THEN
  IF document!~'^[0-9]{8}-?[0-9]$' THEN RAISE EXCEPTION 'DUI inválido: 00000000-0' USING ERRCODE='22023'; END IF;
  document=replace(document,'-',''); document=left(document,8)||'-'||right(document,1);
  PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||document,0));
  SELECT * INTO existing FROM public.patients WHERE dui=document FOR UPDATE;
  IF FOUND THEN
   IF lower(trim(existing.first_name)) IS DISTINCT FROM lower(trim(p_first)) OR lower(trim(existing.last_name)) IS DISTINCT FROM lower(trim(p_last)) OR existing.birth_date IS DISTINCT FROM p_birth THEN
    RAISE EXCEPTION 'Ya existe un paciente con este DUI. Consulta y verifica su identidad; no crees otro expediente.' USING ERRCODE='23505'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.medical_records WHERE patient_id=existing.id) THEN RAISE EXCEPTION 'El paciente ya existe sin expediente. Requiere revisión administrativa.'; END IF;
   RETURN existing.id;
  END IF;
 END IF;
 INSERT INTO public.patients(first_name,last_name,dui,phone,birth_date,city,registration_source,created_by)
 VALUES(trim(p_first),trim(p_last),document,nullif(trim(p_phone),''),p_birth,nullif(trim(p_city),''),'presencial',auth.uid()) RETURNING id INTO v_id;
 INSERT INTO public.medical_records(patient_id,opened_by) VALUES(v_id,auth.uid());
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id) VALUES(auth.uid(),'registro_presencial','patients',v_id::text);
 RETURN v_id;
END $function$
;
CREATE OR REPLACE FUNCTION public.create_walkin_patient(p_first text, p_last text, p_dui text, p_phone text, p_birth date, p_city text, p_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE patient_id uuid; document text=replace(trim(p_dui),'-',''); contact text=nullif(lower(trim(p_email)),'');
 today date=(now() AT TIME ZONE 'America/El_Salvador')::date;
BEGIN
 IF auth.uid() IS NULL OR NOT(private.has_role('admin') OR private.has_role('recepcionista')) THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;

 IF p_birth IS NULL OR p_birth>((now() AT TIME ZONE 'America/El_Salvador')::date-interval '18 years')::date THEN
  RAISE EXCEPTION 'El paciente debe tener al menos 18 años. Comprueba su fecha de nacimiento' USING ERRCODE='22023',HINT='birth'; END IF;
 IF p_city IS NULL OR NOT (trim(p_city)=ANY(ARRAY['Atiquizaya','El Refugio','San Lorenzo','Turín','Ahuachapán','Apaneca','Concepción de Ataco','Tacuba','Guaymango','Jujutla','San Francisco Menéndez','San Pedro Puxtla','Aguilares','El Paisnal','Guazapa','Apopa','Nejapa','Ilopango','San Martín','Soyapango','Tonacatepeque','Ayutuxtepeque','Mejicanos','San Salvador','Cuscatancingo','Ciudad Delgado','Panchimalco','Rosario de Mora','San Marcos','Santo Tomás','Santiago Texacuangos','Quezaltepeque','San Matías','San Pablo Tacachico','San Juan Opico','Ciudad Arce','Colón','Jayaque','Sacacoyo','Tepecoyo','Talnique','Antiguo Cuscatlán','Huizúcar','Nuevo Cuscatlán','San José Villanueva','Zaragoza','Chiltuipán','Jicalapa','La Libertad','Tamanique','Teotepeque','Comasagua','Santa Tecla','La Palma','Citalá','San Ignacio','Nueva Concepción','Tejutla','La Reina','Agua Caliente','Dulce Nombre de María','El Paraíso','San Francisco Morazán','San Rafael','Santa Rita','San Fernando','Chalatenango','Arcatao','Azacualpa','Comalapa','Concepción Quezaltepeque','El Carrizal','La Laguna','Las Vueltas','Nombre de Jesús','Nueva Trinidad','Ojos de Agua','Potonico','San Antonio de La Cruz','San Antonio Los Ranchos','San Francisco Lempa','San Isidro Labrador','San José Cancasque','San Miguel de Mercedes','San José Las Flores','San Luis del Carmen','Suchitoto','San José Guayabal','Oratorio de Concepción','San Bartolomé Perulapán','San Pedro Perulapán','Cojutepeque','San Rafael Cedros','Candelaria','Monte San Juan','El Carmen','San Cristóbal','Santa Cruz Michapa','San Ramón','El Rosario','Santa Cruz Analquito','Tenancingo','Sensuntepeque','Victoria','Dolores','Guacotecti','San Isidro','Ilobasco','Tejutepeque','Jutiapa','Cinquera','Cuyultitán','Olocuilta','San Juan Talpa','San Luis Talpa','San Pedro Masahuat','Tapalhuaca','San Francisco Chinameca','Jerusalén','Mercedes La Ceiba','Paraíso de Osorio','San Antonio Masahuat','San Emigdio','San Juan Tepezontes','San Luis La Herradura','San Miguel Tepezontes','San Pedro Nonualco','Santa María Ostuma','Santiago Nonualco','San Juan Nonualco','San Rafael Obrajuelo','Zacatecoluca','Anamorós','Bolívar','Concepción de Oriente','El Sauce','Lislique','Nueva Esparta','Pasaquina','Polorós','San José La Fuente','Santa Rosa de Lima','Conchagua','Intipucá','La Unión','Meanguera del Golfo','San Alejo','Yayantique','Yucuaiquín','Santiago de María','Alegría','Berlín','Mercedes Umaña','Jucuapa','El Triunfo','Estanzuelas','San Buenaventura','Nueva Granada','Usulután','Jucuarán','San Dionisio','Concepción Batres','Santa María','Ozatlán','Tecapán','Santa Elena','California','Ereguayquín','Jiquilisco','Puerto El Triunfo','San Agustín','San Francisco Javier','Juayúa','Nahuizalco','Salcoatitán','Santa Catarina Masahuat','Sonsonate','Sonzacate','Nahulingo','San Antonio del Monte','Santo Domingo de Guzmán','Izalco','Armenia','Caluco','San Julián','Cuisnahuat','Santa Isabel Ishuatán','Acajutla','Masahuat','Metapán','Santa Rosa Guachipilín','Texistepeque','Santa Ana','Coatepeque','El Congo','Candelaria de la Frontera','Chalchuapa','El Porvenir','San Antonio Pajonal','San Sebastián Salitrillo','Santiago de La Frontera','Apastepeque','Santa Clara','San Ildefonso','San Esteban Catarina','San Sebastián','Santo Domingo','San Vicente','Guadalupe','Verapaz','Tepetitán','Tecoluca','San Cayetano Istepeque','Ciudad Barrios','Sesori','Nuevo Edén de San Juan','San Gerardo','San Luis de La Reina','Carolina','San Antonio del Mosco','Chapeltique','San Miguel','Comacarán','Uluazapa','Moncagua','Quelepa','Chirilagua','Chinameca','Nueva Guadalupe','Lolotique','San Jorge','San Rafael Oriente','El Tránsito','Arambala','Cacaopera','Corinto','Joateca','Jocoaitique','Meanguera','Perquín','Torola','Chilanga','Delicias de Concepción','El Divisadero','Gualococti','Guatajiagua','Jocoro','Lolotiquillo','Osicala','San Carlos','San Francisco Gotera','San Simón','Sensembra','Sociedad','Yamabal','Yoloaiquín']::text[])) THEN
  RAISE EXCEPTION 'Selecciona una localidad válida de El Salvador en la lista' USING ERRCODE='22023',HINT='city'; END IF;
 IF nullif(trim(p_first),'') IS NULL OR length(trim(p_first))>100 THEN RAISE EXCEPTION 'Escribe los nombres del paciente' USING ERRCODE='22023',HINT='first'; END IF;
 IF nullif(trim(p_last),'') IS NULL OR length(trim(p_last))>100 THEN RAISE EXCEPTION 'Escribe los apellidos del paciente' USING ERRCODE='22023',HINT='last'; END IF;
 IF document IS NULL OR document !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'DUI inválido: 00000000-0' USING ERRCODE='22023',HINT='dui'; END IF;
 IF p_birth IS NULL OR p_birth>today OR p_birth<(today-interval '120 years')::date THEN RAISE EXCEPTION 'Indica una fecha de nacimiento válida, no futura' USING ERRCODE='22023',HINT='birth'; END IF;
 IF p_phone IS NULL OR trim(p_phone)!~'^[2567][0-9]{3}-[0-9]{4}$' THEN RAISE EXCEPTION 'Indica un teléfono salvadoreño de 8 dígitos' USING ERRCODE='22023',HINT='phone'; END IF;
 IF contact IS NOT NULL AND (length(contact)>254 OR contact !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN RAISE EXCEPTION 'Correo inválido. Usa nombre@dominio.com' USING ERRCODE='22023',HINT='email'; END IF;
 IF coalesce(length(trim(p_city)),0)>120 THEN RAISE EXCEPTION 'La ciudad admite hasta 120 caracteres' USING ERRCODE='22023',HINT='city'; END IF;
 document=left(document,8)||'-'||right(document,1);
 PERFORM pg_advisory_xact_lock(hashtextextended('walkin:'||document,0));
 -- The existing six-argument function serializes duplicate DUI, verifies identity,
 -- and creates patients + medical_records + audit atomically. Never calls Auth.
 patient_id=public.create_walkin_patient(p_first,p_last,document,p_phone,p_birth,p_city);
 -- Do not overwrite existing contact data, even on a retried registration.
 IF EXISTS(SELECT 1 FROM public.patients WHERE id=patient_id AND email IS NOT NULL AND email IS DISTINCT FROM contact) THEN
  RAISE EXCEPTION 'El paciente ya está registrado. Recupera su expediente sin sobrescribir sus datos' USING ERRCODE='23505'; END IF;
 UPDATE public.patients SET email=contact WHERE id=patient_id AND email IS NULL AND created_by=auth.uid() AND created_at=now() AND profile_id IS NULL;
 RETURN patient_id;
END $function$
;
NOTIFY pgrst,'reload schema';
