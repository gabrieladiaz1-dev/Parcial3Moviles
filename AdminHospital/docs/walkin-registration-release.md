# Atención presencial y vinculación posterior con iOS

## Mejora del formulario: edad, localidad y revisión

Se aplicó la migración incremental `walkin_adult_locality_validation` en `uvebpsbbwofthucghccc`. Solo amplía las dos firmas de `create_walkin_patient`: exige nacimiento con al menos 18 años y localidad válida del catálogo existente. No cambia `register_patient`, citas, hospitalización ni RLS. Los literales SQL de localidades se generan desde `src/lib/elSalvadorLocalities.ts`; no existe un segundo catálogo mantenido manualmente ni una tabla nueva.

El formulario presenta tarjetas de identidad y contacto con campos amplios, iconos, ayudas y errores inline. Reutiliza `EmployeeBirthDate` y `EmployeeCity`, con etiquetas accesibles opcionales y modo estricto de ciudad. El calendario dispone de mes y año; se corrigió su mes inicial vacío. La edad se calcula automáticamente y los menores quedan bloqueados. Ciudad ahora es obligatoria y debe corresponder al catálogo; correo sigue siendo opcional.

Teléfono y DUI se limitan a 8 y 9 dígitos, con guiones automáticos, bloqueo de letras al escribir y normalización al pegar. `advanceFormOnEnter` se comparte con el registro de empleados: avanza entre campos, respeta el calendario y el combobox, y nunca envía el formulario. Tab y Shift+Tab conservan el comportamiento nativo.

«Crear expediente» abre un diálogo de revisión con nombres, DUI, nacimiento, edad y contacto, sin crear registros. Ofrece «Volver a editar» y «Confirmar y crear expediente» con verificación de identidad. El guardado conserva las RPC transaccionales y las comprobaciones de duplicados originales.

Verificación real: 17 años rechazados y 18 aceptados en Supabase; ciudad inexistente rechazada también en el contrato antiguo de seis argumentos. Edge aislado comprobó límites numéricos, edad, futuro, selección de localidad con flechas/Enter, avance con Enter sin registrar, revisión sin persistencia (comprobada por SQL), confirmación explícita, expediente y continuación a cita. Todos los datos temporales se limpiaron. La vinculación iOS y las restricciones de propiedad pasaron nuevamente como regresión.

Compilación y 21 pruebas esenciales aprobadas. Lint sin errores; conserva advertencias previas de otros módulos. Archivos principales de esta mejora: `WalkinRegistration.tsx`, `WalkinRegistration.css`, `WalkinReview.tsx`, `EmployeeFields.tsx`, `EmployeesPage.tsx`, `walkin.ts`, `formKeyboard.ts`, `walkin_adult_locality_validation.sql`, su script de despliegue y las pruebas de formulario/navegador.

Los apartados siguientes describen la entrega inicial; la ciudad opcional y la edad mínima de aquella entrega quedan sustituidas por estas validaciones.

Implementado en el ADMIN local y publicado en Supabase `uvebpsbbwofthucghccc` mediante MCP. Migración incremental aplicada: **`walkin_patient_registration`**, archivo `supabase/walkin_patient_registration.sql`. No se crearon tablas, perfiles ficticios ni políticas RLS nuevas. No se desplegaron Edge Functions: no fueron necesarias.

## Flujo del ADMIN

Recepción → Atención presencial permite buscar por nombre, apellido, DUI o teléfono. Reutiliza la búsqueda autorizada y su relevancia; cada resultado muestra código de paciente y si tiene expediente. La selección recupera el registro existente y exige verificación documental para continuar su atención. Un paciente existente sin expediente disponible requiere revisión; no se crea otra persona.

El formulario de paciente nuevo exige nombres, apellidos, DUI, nacimiento y teléfono. Correo y ciudad son opcionales. El teléfono y el DUI se formatean automáticamente. Las fechas imposibles o futuras, teléfonos inválidos y errores de correo se muestran junto al campo. Antes de crear se repite la búsqueda exacta por DUI y se revisan posibles coincidencias por nombre/contacto. Esas coincidencias nunca vinculan cuentas.

La RPC guarda paciente, expediente y auditoría en una sola transacción. El actor se obtiene de `auth.uid()`, no del navegador. `profile_id` queda NULL; los códigos los generan los defaults actuales. No se llama a Auth ni se asignan contraseñas. La confirmación exige releer un paciente con exactamente un expediente. Si falla únicamente esa lectura, el formulario conserva el ID y reintenta confirmar sin volver a crear.

La confirmación muestra nombre, DUI, código de paciente, expediente, origen y fecha. Ofrece abrir expediente, agendar cita y continuar atención presencial; se conserva la solicitud de valoración ya existente. El expediente se abre con los permisos y límites de recepción existentes.

## RPC y contratos

- `create_walkin_patient(p_first text,p_last text,p_dui text,p_phone text,p_birth date,p_city text,p_email text) → uuid`: firma conservada; validación individual por campo. Exige sesión y rol admin/recepcionista, fecha y teléfono válidos. Reutiliza la implementación transaccional de seis argumentos, el bloqueo por DUI y las restricciones UNIQUE. No sobrescribe datos de contacto de registros existentes.
- `create_walkin_patient(text,text,text,text,date,text)`: implementación existente conservada.
- `register_patient(p_dui text,p_phone text DEFAULT NULL,p_city text DEFAULT NULL) → uuid`: firma conservada, ahora recupera el paciente presencial existente en lugar de intentar duplicarlo. Exige rol paciente, cuenta Auth con correo confirmado, perfil con identidad completa, mismo nombre y apellidos normalizados por mayúsculas/espacios y fecha de nacimiento exacta. Un DUI conocido, teléfono o correo de contacto por sí solos no autorizan la vinculación. Rechaza cuentas bloqueadas y DUI vinculados a otra cuenta.

Al vincular un presencial cambia únicamente `patients.profile_id` y añade la auditoría. Conserva `patient_id`, código de paciente, expediente, código, origen y datos personales originales. La repetición de la operación desde la misma cuenta es idempotente. Si el DUI no existe, mantiene el alta iOS con expediente atómico. No concede INSERT ni escritura de propiedad a clientes. Se verificó que `authenticated` no puede modificar `profile_id` ni `created_by`.

## Verificación real con datos sintéticos

| Prueba | Resultado |
| --- | --- |
| Crear presencial sin cuenta Auth ni perfil falso | Aprobada |
| Crear expediente automáticamente | Aprobada: un expediente, actor de recepción y códigos generados |
| Relación paciente–expediente | Aprobada: `medical_records.patient_id` conserva el ID creado |
| Dos creaciones simultáneas del mismo DUI | Aprobada: ambas devuelven el mismo ID y un solo expediente |
| Recuperar paciente existente | Aprobada: búsqueda por DUI devuelve el registro original |
| Repetir creación sin duplicar expediente | Aprobada: mismo ID y código |
| Alta Auth de prueba como futuro cliente iOS y vinculación | Aprobada mediante Auth real y la RPC compartida |
| Mantener el mismo `patient_id` | Aprobada |
| Mantener el mismo `record_code` | Aprobada |
| Intentar reasignar DUI vinculado a otra cuenta | Rechazada correctamente |
| Usuario paciente intenta crear un presencial | Rechazado con 42501 |
| Identidad distinta intenta vincular y leer el expediente | Vinculación rechazada y lectura RLS vacía |
| Escritura arbitraria de `profile_id`/`created_by` desde recepción | Rechazada |
| Nacimiento futuro y correo inválido | Rechazados con 22023 |
| Interfaz real en Edge aislado | Aprobada: errores inline, creación, códigos, apertura de expediente, continuación a cita y ancho móvil |
| Limpieza final | Cero pacientes y cuentas de prueba restantes; se eliminaron solo identidades y registros marcados por cada ejecución |

Compilación aprobada y 14 pruebas locales esenciales de formulario, normalización y búsqueda aprobadas. El navegador utilizó un contexto aislado y sesiones temporales; su perfil de prueba se retiró. No se cambiaron pacientes reales.

## Pendiente en el repositorio iOS

No se tuvo acceso al código de Hospital-Universitario y no se modificó. El contrato SQL está desplegado y fue probado mediante el API, no mediante una compilación iOS.

El cliente iOS debe crear Auth normalmente enviando `first_name`, `last_name`, `birth_date` en sus metadatos de registro para que el trigger existente cree el perfil completo; confirmar su correo y llamar a `register_patient(p_dui,p_phone,p_city)` con su propia sesión. Debe usar el UUID devuelto, no insertar directamente `patients` o `medical_records`, ni reemplazar códigos. Debe mostrar los errores de identidad y dirigir al paciente a recepción cuando no coincidan los datos. Si ya hace esto, no cambia la firma de su llamada; hay que comprobarlo en ese repositorio.

## Archivos

- `src/components/WalkinRegistration.tsx`: búsqueda, formulario, duplicados y confirmación.
- `src/pages/WalkinReception.tsx`: integración y conservación de las operaciones de atención.
- `src/pages/WalkinReception.css`: resultados, errores y confirmación responsiva.
- `src/components/ReceptionPatientDirectory.tsx`: reutilización del diálogo autorizado de expediente.
- `src/lib/reception.ts`: lectura confirmada y errores de campo.
- `src/lib/walkin.ts`: validaciones y formato.
- `supabase/walkin_patient_registration.sql`: RPC compatibles.
- `scripts/Inspect-WalkinContracts.mjs`, `scripts/Inspect-WalkinWritePermissions.mjs`, `scripts/Deploy-WalkinRegistration.mjs`: inspección y publicación autorizadas.
- `scripts/Test-WalkinRegistrationLive.mjs`, `scripts/lib/walkinBrowser.mjs`: aceptación remota/UI y limpieza acotada. Requieren autorización explícita para futuras pruebas con escrituras.
- `tests/walkin-registration.test.mjs`: pruebas locales pertinentes.

ADMIN disponible en `http://127.0.0.1:5173/`. No se configuró alojamiento nuevo ni se afirma una publicación pública del frontend.
