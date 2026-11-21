# Atención presencial

Recepción → Atención presencial. Acceso exclusivo a roles activos `admin` y `recepcionista`, comprobado en las RPC. Al entrar aparece directamente Crear expediente de nuevo paciente. Todos los campos son editables y el DUI se comprueba en segundo plano, sin bloquear ni borrar el formulario. Un expediente existente se recupera sin duplicarlo ni modificar su identidad. Se exige confirmación del documento para continuar.

## Registro real

Se conserva `create_walkin_patient(text,text,text,text,date,text)` para los clientes existentes. La ampliación con siete argumentos añade `p_email text` sin valores por defecto ambiguos: guarda el contacto en `patients.email`, validado y normalizado, sin Auth ni cambios de titularidad. Un reintento no sobrescribe contactos existentes. Crea `patients` y `medical_records` en una transacción, sin usuario Auth ni contraseña y con `profile_id = NULL`. Campos editables reales: nombres, apellidos, DUI, fecha de nacimiento, teléfono, correo y ciudad. El DUI es obligatorio para este recorrido; nombres y apellidos son obligatorios en el modelo. Nacimiento, teléfono y ciudad son opcionales. Los identificadores, códigos, fecha y responsable los genera el servidor. El esquema no almacena sexo, dirección detallada ni contacto de emergencia: no se piden ni se ocultan dentro de otro campo. No se captura historia clínica firmada desde recepción.

Se normaliza el DUI antes de guardar, se conservan las restricciones únicas existentes y se serializa la creación por documento. Un reintento con el mismo DUI, nombres y nacimiento devuelve el paciente existente; discrepancias no sobrescriben identidad. La validación del teléfono sigue el formato de pacientes usado por iOS, `0000-0000`; nacimiento no futuro y hasta 120 años. Un paciente existente sin expediente requiere revisión administrativa, no un segundo paciente.

## Citas, atención próxima e ingreso

La nueva RPC de orquestación `reception_walkin_attention(p_patient uuid, p_key uuid, p_values jsonb)` reutiliza `appointment_requests`, `schedule_appointment` y `hospital_admissions`. No modifica las RPC clínicas ni `clinical-write-integrity.sql`. No se alteran políticas RLS.

`p_values` contiene `mode` (`scheduled`, `immediate`), `specialty_id`, `doctor_id`, `room_id`, `starts_at`, `ends_at`, `reason`, `symptoms`, `priority` (`normal`, `urgente`), `identity_confirmed: true`.

La especialidad y el médico deben estar activos. La disponibilidad se consulta con `get_medical_availability` y se vuelve a validar con `schedule_appointment`; se conservan restricciones contra solapamiento y el bloqueo de programación. La solicitud y su cita se guardan atómicamente. Se guarda el motivo en `reason`, síntomas en `other_symptoms` y el contexto de recepción/prioridad en `applicant_data.walkin`, un campo JSON real ya existente. No se crean columnas clínicas ficticias. `requester_id` es NULL porque no hay una cuenta paciente solicitante. La clave UUID se conserva para reintentar el mismo envío; un contenido distinto con la misma clave se rechaza.

Atención inmediata significa reservar una próxima disponibilidad de hoy, dentro de dos horas. No garantiza atención sin espera. La cita queda `programada`; recepción no inicia ni completa una consulta. Si no existe disponibilidad, se ofrece buscar una cita programada y se indica activar el protocolo asistencial ante urgencia. Cambiar prioridad no crea disponibilidad ni constituye triaje.

El modo `admission` de esta RPC está bloqueado en el servidor, incluso si recepción envía `medical_indication_confirmed: true`. Para hospitalizar, el doctor debe emitir la solicitud mediante las RPC existentes desde su sesión autenticada. Luego recepción asigna cama en Hospitalización. No se acepta una casilla de recepción como autorización médica. No se alteran las solicitudes médicas existentes ni la migración clínica.

## Vinculación futura con iOS

No se implementa vinculación automática ni una búsqueda pública por DUI. El mecanismo existente permite que una cuenta paciente solicite atención antes de tener `patients.profile_id` vinculado:

1. iOS crea la cuenta Auth y completa el perfil, sin crear otro paciente automáticamente si ya existe un expediente presencial.
2. Llama a `my_attention_context()` para datos de su propia cuenta, no para buscar expedientes ajenos.
3. Envía `submit_my_attention_request(p_key uuid, p_specialty bigint, p_period text, p_reason text, p_symptoms bigint[], p_other text, p_missing jsonb)`. `p_period` acepta `manana`, `tarde`, `indiferente`; los síntomas deben ser IDs activos. `p_missing` solo admite los campos faltantes `first_name`, `last_name`, `birth_date`, `phone`, `dui` como cadenas. El DUI debe enviarse normalizado como `00000000-0`. La RPC actual exige nacimiento y teléfono completos para esa solicitud.
4. Recepción abre la solicitud, busca el expediente y comprueba el documento físicamente. Solo entonces ejecuta `link_attention_patient(p_request uuid, p_patient uuid, p_identity_confirmed boolean)`.
5. Esa RPC comprueba DUI y nacimiento, cuenta/expediente no vinculados a otra identidad y confirmación por personal autorizado. Tras el vínculo, la RLS permite a esa cuenta leer su expediente y citas anteriores. Antes no los expone.

**Bloqueos reales:** el repositorio iOS debe permitir enviar esa solicitud sin exigir primero `register_patient`; esa RPC no recupera un expediente existente y chocaría con la unicidad del DUI. No debe resolverse devolviendo datos por coincidencia de documento. Si el expediente presencial carece de nacimiento o hay discrepancias, el enlace existente se bloquea correctamente: falta un procedimiento administrativo específico de corrección de identidad, con evidencia y auditoría. La vinculación remota independiente de una solicitud de atención tampoco existe; requeriría un canal verificado diseñado aparte, no una contraseña o comprobación improvisada. No se modificó iOS.

## Verificación

`tests/reception-walkin.sql` pasó con datos sintéticos y ROLLBACK: registro sin cuenta, persistencia de correo y ciudad, validaciones de correo/teléfono/nacimiento, DUI normalizado y reintentos, cita y rechazo de doble reserva, bloqueo del ingreso desde recepción, solicitud de ingreso desde el doctor autenticado y vinculación futura con RLS. La compilación pasó. No se verificó visualmente el navegador.

El asesor posterior conserva los avisos previos y señala la nueva RPC privilegiada ejecutable por autenticados; su ejecución es intencional y exige rol activo de recepción/admin internamente. [Referencia del asesor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
