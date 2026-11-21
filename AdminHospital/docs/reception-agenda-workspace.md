# Agenda integrada de Recepción

Implementación local. No se aplicó SQL ni se desplegó el frontend y no se escribieron pacientes reales.

## Archivos de esta mejora

- `src/pages/ReceptionPage.tsx`: integración de agenda y revisión de solicitudes.
- `src/components/ReceptionAgenda.tsx` y `ReceptionAgenda.css`: agenda diaria y flujo presencial integrado.
- `src/components/ReceptionAppointmentScheduler.tsx`: selección y confirmación compartidas.
- `src/components/ReceptionRecordPreparation.tsx`: preparación de expediente e identidad.
- `src/components/ReceptionPatientDirectory.tsx`: selección reutilizable de un paciente existente.
- `src/lib/reception.ts` y `src/lib/receptionBooking.ts`: contratos, disponibilidad y reintentos.
- `supabase/reception_agenda_workspace.sql`: extensión aditiva pendiente de aplicar.
- `tests/reception-agenda.test.mjs`: comprobaciones locales esenciales.
- `docs/reception-agenda-workspace.md`: entrega y requisitos de integración.

## Flujo

- Agenda diaria con navegación de fecha, indicadores, búsqueda, estados y actualización explícita.
- Solicitudes de iOS dentro de Agenda reutilizan la misma revisión, rechazo, cancelación y verificación de identidad de la bandeja existente. Se comprueba primero `patient_id` / `requester_id → patients.profile_id`; la búsqueda exacta por DUI solo propone candidatos y nunca los vincula automáticamente.
- Nueva cita presencial reutiliza el directorio inteligente. La persona debe verificarse antes de continuar. Un paciente existente conserva su identificador y expediente; el registro nuevo consulta posibles duplicados y exige revisión si encuentra coincidencias.
- Programación compartida: especialidad, fecha local de El Salvador, médico, jornada/consultorio, horas disponibles y resumen antes de confirmar. Las horas ocupadas del médico, sala o paciente y las horas pasadas no pueden seleccionarse. `get_medical_availability` y `schedule_appointment` mantienen la validación final del servidor.
- Solicitudes iOS usan `schedule_appointment` con el ID original. Presenciales usan `reception_walkin_attention` con clave estable. Los reintentos conservan exactamente el payload; se reconcilia el resultado antes de descartar una operación. Solo la clave de operación se conserva en `sessionStorage`; no se guardan allí nombres, documentos, síntomas ni contactos.

## Extensión de Supabase preparada, pendiente de aplicar

Archivo: `supabase/reception_agenda_workspace.sql`. Crea únicamente dos funciones, en una transacción:

1. `reception_specialty_doctors(bigint,date)`: lectura de médicos activos por especialidad, jornadas y consultorios de siete días y periodos no disponibles. No expone motivos de ausencia ni datos Auth. Sin esta extensión, el frontend sigue ofreciendo médicos con horas libres mediante la disponibilidad existente, e informa que el detalle completo de jornadas aún no está habilitado.
2. `reception_prepare_record(jsonb,boolean,uuid,uuid)`: crea solo el expediente faltante o usa `create_walkin_patient` para una persona nueva. Exige verificación explícita, bloquea duplicados por documento, preserva identidad/contactos existentes y delega la vinculación de cuentas a `link_attention_patient`. No concede propiedad por nombre, teléfono o correo. Todas las escrituras son atómicas; si la vinculación falla, se revierte también la creación del expediente.

Ambas funciones restringen ejecución a cuentas autenticadas con rol administrador o recepción. No crean tablas, no cambian RLS y no reemplazan firmas existentes de iOS. La extensión requiere los contratos de planificación y recepción que ya utiliza la aplicación, incluidos `patients.email`, `staff_absences.active`, `doctor_consulting_rooms.active/slot_minutes`, `create_walkin_patient` de siete argumentos y `link_attention_patient`. El último contrato se utiliza en el código existente, pero su definición no está disponible en este repositorio: debe confirmarse en el entorno destino antes de aplicar el SQL.

## Verificación realizada

- Compilación TypeScript/Vite correcta.
- `node --test tests/reception-agenda.test.mjs`: ocho pruebas locales correctas de contratos de programación iOS/presencial, reintentos, disponibilidad, cruces, recuperación, indicadores y protecciones del SQL preparado.
- Las comprobaciones del SQL son de contrato estático; no equivalen a ejecutarlo en PostgreSQL.

## Verificación real pendiente

No se dispone de sesión autenticada administrativa/de recepción ni de un entorno de prueba autorizado conectado. Por tanto, ninguna escritura o disponibilidad del servidor se certifica como verificada en Supabase.

Antes de publicar, aplicar y probar la extensión en un entorno controlado, con datos de prueba y permisos equivalentes a recepción. Casos: solicitud iOS con expediente, solicitud iOS sin expediente, presencial con expediente, presencial sin expediente (paciente existente y nuevo), médico sin horas libres y dos reservas simultáneas del mismo espacio. Comprobar IDs/relaciones originales, una sola cita/solicitud tras reintentos, actualización de agenda, ausencia de modificaciones a cuentas ajenas y rollback ante identidad incompatible. Las pruebas locales no sustituyen estos casos de integración.
