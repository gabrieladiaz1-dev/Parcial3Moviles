# Recepción Android · Hospital Móviles

## Referencias de solo lectura

ADMIN: C:/Users/Abiga/OneDrive/Desktop/Hospital-IOS-Frontend.
Contratos consultados: src/lib/reception.ts, hospitalization.ts, walkin.ts; src/pages/ReceptionPage.tsx,
WalkinReception.tsx, AdmissionAssessment.tsx, HospitalizationPage.tsx; docs/recepcion.md,
atencion-presencial.md y hospitalizacion.md.

iOS: C:/Users/Abiga/OneDrive/Desktop/Hospital-Universitario.
Referencia visual: Design/HospitalPalette.swift, HospitalTheme.swift y Patient/PatientDashboardView.swift.
Solo se escribió en Android. No se aplicó SQL ni se modificó Auth/RLS/backend en esta intervención.

## Arquitectura y acceso

Una Activity por sección, base ReceptionDeskActivity con XML y ViewBinding; sin Compose ni WebView.
Las pantallas dependen de ReceptionDeskRepository, creado por AppContainer.
SupabaseReceptionDeskRepository usa la URL/Publishable Key local y el token de SessionManager.
No utiliza service_role, secretos, perfiles alternativos ni datos de demostración.
Las nuevas rutas se usan exclusivamente por recepción. Doctor, enfermería y login se conservan.
Las actividades son internas, requieren sesión de recepción y mantienen FLAG_SECURE.
Los datos de formularios no se guardan en preferencias ni se registran en logs.

## Operaciones implementadas

| Sección | Contratos y comportamiento |
| --- | --- |
| Inicio | Totales exactos por estado con count=exact. Acceso a las cinco secciones y cierre de sesión existente. |
| Solicitudes | appointment_requests: pendientes/en revisión por defecto, filtro por estado, orden ascendente/descendente, paginación de 100 por estado, búsqueda sobre registros cargados. Catálogo real de especialidades. Detalle, síntomas, solicitud programada y motivo de cierre. |
| Revisión y vínculo | review_attention_request, búsqueda por DUI, consulta de medical_records.record_code, comparación de nombre/DUI/nacimiento, confirmación explícita, link_attention_patient, create_attention_patient. Bloqueo de vínculo visible a otra cuenta; nunca se sobrescribe identidad. |
| Programación desde solicitud | Especialidad real, get_medical_availability, filtrado por doctor_specialties y solapamientos de paciente/consultorio, preferencia de mañana/tarde, filtro de médico, reception_doctor_day, confirmación y schedule_appointment con p_request. |
| Pacientes | Consulta por DUI completo normalizado, contacto y código de expediente; ausencia de expediente requiere revisión administrativa, sin crear duplicados. No se expone escritura clínica. |
| Agenda | reception_agenda por día de El Salvador. Paciente, médico, consultorio, horario y estado; hasta 200 según contrato ADMIN. La agenda ADMIN actual es de consulta y no permite a recepción iniciar/completar una consulta. |
| Presencial | Formulario directo: nombres, apellidos, DUI, nacimiento, teléfono, correo y ciudad. Consulta de DUI en segundo plano (450 ms) sin bloquear ni borrar campos. Búsqueda repetida al guardar. create_walkin_patient de siete argumentos, recuperación de registro existente y comprobación de expediente. No crea Auth. |
| Atención presencial posterior | reception_walkin_attention con UUID de idempotencia, scheduled/immediate, motivo/síntomas/prioridad, especialidad/horario real e identidad confirmada. Atención próxima solo hoy/dentro de dos horas, según servidor; nunca marca consulta realizada. |
| Valoración presencial | admission_assessment_context paginado, selección real de médico activo, reception_request_admission_assessment con UUID, motivo y prioridad. Seguimiento de decisión y acceso al ingreso aprobado; Android recepción no emite la decisión médica. |
| Hospitalización | reception_hospital_inventory: habitaciones/camas/ocupación/estados. reception_admissions paginada (25) por las cuatro vistas ADMIN. Filtros de estado, categoría, búsqueda y habitación en inventario. |
| Ingreso | reception_hospital_detail con orden médica/expediente/historial. reception_review_admission, verificación explícita y reception_admission_availability. reception_resolve_admission para asignar cama compatible o rechazar con motivo. |
| Salida y limpieza | release_bed únicamente tras alta_medica con autorización médica registrada. complete_hospital_bed_cleaning devuelve la cama a disponible después de confirmar limpieza. Inventario editable exclusivamente por ADMIN, como en la web; no se expone en recepción. |

## Validaciones y límites

DUI: nueve cifras con o sin guion, normalizado a 00000000-0.
Nacimiento opcional, válido, no futuro y dentro de 120 años. Teléfono opcional 0000-0000.
Correo opcional validado; longitudes iguales al formulario web.
El servidor mantiene la decisión final sobre disponibilidad, permisos, identidad, duplicados y estado.
Las RPC de negocio se reutilizan; no se reemplazan sus validaciones por escritura directa.
Errores de contrato inexistente identifican el nombre de RPC/tabla; no hay fallback simulado.
Los mensajes de validación del negocio devueltos por las RPC se muestran como datos del servidor, sin escribirlos en logs.
Cambiar dispositivo/proceso pierde la sesión en memoria del login existente; este módulo no cambia su política.

## Verificación y pendientes

:app:assembleDebug ejecutado correctamente y APK instalado en emulator-5554.
git diff --check correcto.
No se generaron pacientes de prueba ni se modificaron registros clínicos reales.
La revisión en vivo de lecturas/navegación y de todas las escrituras bajo rol recepción aún requiere cuenta
y una prueba supervisada. Compilación y revisión de contratos locales no acreditan el despliegue de cada
RPC en el servidor. Si falta una RPC, la pantalla informa el bloqueo exacto y requiere confirmación de
su contrato/despliegue; no aplica migraciones automáticamente.

El usuario pidió mejorar la primera interfaz instalada; se reemplazó el listado de botones por
tarjetas de acceso con iconos, métricas en cuadrícula, navegación inferior y botones primarios/secundarios.
La protección de capturas se conservó tras un rechazo de la revisión automática a retirarla.
