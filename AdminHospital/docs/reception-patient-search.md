# Recepción — búsqueda de pacientes y expedientes

Implementación con las columnas documentadas en el esquema y extensiones existentes del proyecto:

- `patients`: `id`, `profile_id`, `first_name`, `last_name`, `patient_code`, `dui`, `birth_date`, `phone`, `city`; `email` está definido en `supabase/reception_walkin_contact.sql` y ya era utilizado por el flujo presencial.
- `profiles`: no tiene columna de correo. No se consulta para el buscador ni se solicitan correos de Auth.
- `medical_records`: `id`, `patient_id` único, `record_code`, `opened_at`. Se usa esa relación existente, sin agregar tablas.
- `medical_history`: `id`, `record_id`, `history_type`, `description`, `created_at`, para los antecedentes que la política de recepción permite leer. No se consultan diagnósticos ni consultas clínicas desde la ficha de búsqueda.

Las consultas usan el cliente Supabase de la sesión actual, sin clave de servicio ni bypass de RLS. No se cambió SQL, esquema ni políticas. Esta revisión se basa en los archivos SQL del proyecto; no se inspeccionó una base remota con privilegios administrativos.

La búsqueda comienza con dos caracteres y espera 350 ms para evitar una petición por cada pulsación. Consulta coincidencias parciales y exactas, además del código de expediente, con límites por consulta; combina pacientes sin repetir IDs y muestra hasta 20, ordenados por coincidencia y después por nombre. Cuando se alcanza el límite, pide precisar la búsqueda. Para texto, usa patrones literales con variantes acentuadas y el operador existente [imatch de PostgREST](https://docs.postgrest.org/en/stable/references/api/tables_views.html#pattern-matching), sin extensiones SQL ni cambios de tablas. Tanto la consulta como la clasificación ignoran mayúsculas y tildes. Tolera separadores de documentos y teléfonos, incluido +503. Cancela solicitudes obsoletas y no descarga el catálogo completo al abrir la página.

La relevancia distingue nombre (texto ordinario), correo (incluye `@`), teléfono (numérico), DUI (nueve dígitos o su formato) y expediente/código de paciente (`EXP`/`PAC`). Prioriza el campo detectado y ordena por coincidencia exacta, al inicio y parcial. Si encuentra coincidencias en ese campo, excluye los resultados secundarios accidentales; si no las hay, conserva la búsqueda en los demás campos. Cada tarjeta indica discretamente el campo que produjo la coincidencia. Una consulta separada del campo prioritario evita que los primeros candidatos de otros campos oculten ese conjunto.

La regresión de nombres y correos cruzados se reproduce únicamente con fixtures locales y correos `example.test`. No se consultaron ni cambiaron los dos registros reales descritos por el usuario: no hay una sesión administrativa conectada ni un token autorizado para inspeccionarlos. Un correo diferente del nombre de su titular no prueba una asignación errónea; confirmarla requiere revisión autorizada de esos registros, sin correcciones automáticas.

Los resultados muestran DUI parcialmente oculto, contacto y estado del expediente visible para la cuenta. Abrir expediente vuelve a comprobar el acceso en Supabase y presenta metadatos y hasta diez antecedentes autorizados; no abre el módulo clínico incompleto ni amplía permisos.

Las coincidencias por nombre o teléfono generan advertencias, no vínculos de cuentas. El registro presencial mantiene el control exacto de DUI y la confirmación documental; antes de crear, vuelve a comprobar nombres y contactos y exige revisar posibles duplicados. No se llama a `link_attention_patient` desde el buscador. Se conservan los contratos existentes de vinculación y creación.

Si un paciente ya está registrado pero no dispone de expediente, se permite iniciar la revisión presencial con sus datos sin crear otra persona. **El backend existente rechaza crear otro paciente con el mismo DUI y no ofrece una operación para crear solo el expediente faltante:** ese caso se deriva a revisión administrativa. No se oculta este límite ni se sortea con escrituras directas o cambios de RLS.

Validación esencial: compilación, pruebas de filtros/orden/coincidencias/duplicados/mascarado y ordenamiento de solicitudes. No se hicieron escrituras de prueba sobre pacientes reales. El funcionamiento remoto depende de la sesión autorizada y de que el esquema desplegado corresponda al que ya utiliza el proyecto.
