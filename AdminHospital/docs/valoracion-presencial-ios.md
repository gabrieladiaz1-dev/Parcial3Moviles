# Contrato compartido: valoración presencial para hospitalización

## Estado

Aplicada en Supabase `uvebpsbbwofthucghccc`: migración `presential_admission_assessment`, fuente `supabase/presential_admission_assessment.sql`. Panel administrativo implementado y compilado. No se modificó el proyecto iOS ni `clinical-write-integrity.sql`.

**La prueba de base de datos está pendiente:** el conector devolvió HTTP 401 `token_revoked` al intentar ejecutar `tests/presential-admission-assessment.sql`. Requiere reconectar Supabase y ejecutar ese script sintético, que finaliza con ROLLBACK. No se afirma que la prueba haya pasado ni que llegara a ejecutarse en el servidor.

## Panel administrativo

Recepción → Atención presencial → crear/recuperar expediente → verificar documento → Solicitar valoración para hospitalización. Permite elegir un médico activo, motivo y prioridad, enviar y actualizar seguimiento. No crea una cita, cuenta Auth, consulta clínica ni ingreso pendiente de autorización. Solo muestra Continuar al ingreso autorizado y seleccionar cama después de una decisión `approved` con un `admission_id` real.

La tabla nueva `admission_assessments` almacena la solicitud, nota de valoración, versión, decisión y responsables. Era necesario distinguir la valoración pendiente de `hospital_admissions.status='solicitado'`, que ya representa una indicación médica y permite asignar cama. Se reutilizan `patients`, `medical_records`, `care_team_assignments`, `hospital_admissions`, `bed_assignments`, auditoría, notificaciones y las RPC de ingreso y camas existentes. No se duplican expedientes ni consultas.

La asignación temporal dura 24 horas. Se da acceso al expediente mediante `care_team_assignments` y la lógica existente `private.treats_patient`; no se amplía esa función ni la RLS clínica. El rechazo termina esa asignación y no crea ingreso. La aprobación conserva el vínculo asistencial y llama a `doctor_native_admission_request` con el usuario médico auténtico en la misma transacción. La asignación de cama, alta, salida y limpieza siguen el flujo existente. Otros permisos asistenciales legítimos que el médico ya tenga no se eliminan.

No hay escritura directa desde clientes sobre `admission_assessments`: tiene RLS activa y ningún permiso a anon/authenticated. Las RPC privilegiadas exigen roles activos; solo el médico asignado puede guardar y decidir. Recepción ve motivos y estados, sin la nota clínica. Los reintentos idénticos son seguros; versiones desactualizadas y decisiones contradictorias se rechazan. No se permite una segunda valoración pendiente del mismo paciente. Después de expirar, una nueva solicitud cierra la anterior como `expired` sin prolongar el acceso anterior.

## Cambios que debe implementar iOS

Añadir **Pacientes por valorar**, independiente de la lista de citas. No exigir cuenta paciente, `appointment_id` ni `encounter_id`. Usar siempre la sesión del médico; no aceptar el doctor enviado por el cliente como autorización.

### Listar y consultar seguimiento

`admission_assessment_context(p_patient uuid = null, p_offset integer = 0) -> JSON`

Para iOS: `p_patient:null` devuelve únicamente las valoraciones del médico activo autenticado. Retorna `items`, `total`, `has_more`, `next_offset`, `doctors` (vacío para el médico). Páginas de 100; recorrer todas para no perder pendientes y filtrar `status='pending'` para la bandeja. Se priorizan pendientes al seleccionar la página; dentro de la página se ordenan por antigüedad. Cada item contiene:

```text
id, patient_id, patient_name, record_code, doctor_id, doctor_name,
requested_at, reason, priority, status, version, assessment,
decided_by, decided_at, admission_id, access_until
```

Estados: `pending`, `approved`, `rejected`, `expired`. Prioridad: `normal`, `urgente`. La prioridad no sustituye el triaje ni garantiza presencia física del médico.

### Abrir expediente asignado

Reutilizar `doctor_native_chart(p_patient uuid, p_from timestamptz, p_to timestamptz, p_query text)` con el `patient_id` del item y filtros opcionales nulos/texto vacío. Funciona mediante la asignación asistencial, sin cita. La RPC mantiene sus campos e historial previos; la valoración de este flujo se obtiene en `assessment`, no creando una consulta ficticia. Deniega acceso a otros pacientes y a la asignación expirada/rechazada, salvo que exista otro vínculo asistencial legítimo previo.

### Guardar borrador de valoración

`doctor_save_admission_assessment(p_assessment uuid, p_version integer, p_notes text) -> integer`

Retorna la nueva versión. `p_notes` admite hasta 10.000 caracteres. Solo permite solicitudes propias, pendientes y con acceso vigente. Guardar no autoriza hospitalización. Ante conflicto de versión, recargar el item antes de reenviar.

### Aprobar o rechazar

`doctor_decide_admission_assessment(p_assessment uuid, p_version integer, p_decision text, p_notes text, p_kind room_kind = null, p_instructions text = null) -> JSON`

`p_decision` es `approved` o `rejected`. Nota médica obligatoria, máximo 10.000 caracteres. Para aprobar, `p_kind` es `vip` o `semiprivada`; instrucciones opcionales hasta 10.000 caracteres, validadas por la RPC existente. Para rechazar, enviar categoría e instrucciones nulas. Devuelve `{status, admission_id, version}`. Conservar versión y payload para reintentos de red; la aprobación exacta repetida no duplica ingreso ni notificación. El ingreso no crea cama automáticamente.

El médico debe confirmar su decisión en iOS y refrescar seguimiento. Recepción no debe llamar a esta RPC usando credenciales del doctor ni recoger su contraseña. No llamar por separado a la RPC antigua de ingreso para simular la resolución de esta valoración.

### Notificaciones

Tabla `notifications`, `entity_type='admission_assessments'`, `entity_id` igual al ID de valoración, `kind='hospitalizacion'`. Aviso genérico al médico al solicitar; al resolver, aviso al usuario de recepción que la solicitó. Una aprobación apunta a `hospital_admissions` y permite reutilizar su navegación existente. Sin datos clínicos en título/cuerpo. Persistencia en Supabase no equivale a push APNs: iOS debe consumir su bandeja y añadir el destino de valoración si aún no existe.

## RPC administrativa

`reception_request_admission_assessment(p_patient uuid, p_doctor uuid, p_reason text, p_priority text, p_key uuid) -> uuid`

Solo admin/recepción activos, expediente real y doctor activo. Motivo de 1–2.000 caracteres; clave UUID estable por envío. Nunca firma una decisión médica. La sección web consulta `admission_assessment_context` por paciente; tras aprobación abre el mismo componente de hospitalización existente con `admission_id`.
