# Laboratorios

Abrir **Laboratorios** en el menú. Administración puede supervisar y asignar permisos en **Personal autorizado**. El personal con autorización activa de laboratorio inicia directamente en este módulo si no tiene acceso administrativo o de recepción.

## Antes de operar

El esquema real no tiene un rol `laboratorio`: utiliza `admin`, `doctor`, `recepcionista`, `enfermera` y `paciente`. Se añadió una autorización específica vinculada al personal existente, con permisos independientes de preparación, validación y publicación. Ser administrador no concede firma clínica. No se crearon empleados ni se otorgaron autorizaciones automáticamente.

El catálogo real tiene nombres y descripciones de exámenes, pero no contenía parámetros, unidades ni rangos. **Catálogo de exámenes** permite que alguien autorizado para validar configure esos datos clínicos. No se sembraron parámetros médicos. Un examen sin configuración estructurada utiliza resultado descriptivo. La configuración se copia al iniciar el procesamiento y los borradores existentes conservan esa versión.

Los límites numéricos solo generan indicadores cuando el validador confirma que son de aplicación general a todos los pacientes. Las referencias que dependan de edad, sexo u otros criterios se registran como texto y no generan cálculos automáticos. No se infiere un rango desde el nombre del examen.

## Flujo

1. Abrir una orden pendiente y **Iniciar procesamiento**.
2. Registrar valores y observaciones por parámetro, o resultado descriptivo cuando corresponda. **Guardar borrador** permite contenido incompleto y no publica.
3. Completar los campos requeridos y **Enviar a validación**.
4. Personal con permiso clínico utiliza **Validar resultados**. Se guarda responsable y fecha.
5. Personal con permiso de publicación confirma **Publicar resultados**, indicando si autoriza también su consulta al paciente. La orden pasa a `completado`.
6. Una versión publicada solo se modifica mediante **Preparar una corrección trazable**, con motivo y nueva validación/publicación. Hasta entonces iOS conserva la versión publicada anterior. El historial mantiene sus versiones y responsables.

Cada `lab_orders` representa **un examen**, según el contrato actual de iOS. Cuando una consulta solicita varios, se muestran las órdenes relacionadas y cuántas están completadas. Completar una no completa las demás.

## Backend y seguridad

Migraciones desplegadas: `laboratory_clinical_workflow` y `laboratory_panel_ios_visibility`. Fuentes: `supabase/laboratory_workflow.sql` y `supabase/laboratory_panel_contract.sql`.

Se reutilizan `lab_orders`, `lab_test_types`, `lab_results`, `lab_result_files`, `lab_delivery_events`, consultas, expedientes, pacientes, personal, roles, notificaciones y auditoría. Solo se añaden `laboratory_authorizations` y `lab_result_drafts`, con RLS. Los borradores separados evitan exponer preparación al cliente que ya consulta `lab_results` con `SELECT *`.

Se conservan los estados `pendiente`, `en_proceso` y `completado`. El borrador tiene etapas internas separadas: preparación, revisión, validación y publicación. El resultado por orden continúa siendo único. Las operaciones comprueban permisos, bloquean la orden y usan versión para rechazar ediciones concurrentes obsoletas.

RPC nuevas principales: `my_laboratory_access`, `laboratory_panel`, `laboratory_order_detail`, `authorize_laboratory_staff`, `configure_laboratory_test`, `start_laboratory_order`, `save_laboratory_draft`, `submit_laboratory_validation`, `validate_laboratory_result`, `publish_laboratory_order`, `correct_laboratory_result`.

`publish_lab_result` conserva su firma, pero ahora exige resultados previamente validados y autorización específica de publicación. `reception_release_lab` también conserva su firma y exige autorización de publicación de laboratorio; el rol de recepción por sí solo ya no publica resultados clínicos. La publicación al paciente de una versión ya publicada puede autorizarse después, sin duplicar entregas ni avisos.

Las políticas de resultados y archivos impiden que doctores o pacientes accedan a borradores. Los doctores requieren relación autorizada con el paciente; los pacientes solo ven sus propios resultados publicados y autorizados. Administración sin autorización clínica ve metadatos para supervisión, sin el contenido del borrador en el módulo. Las configuraciones de referencias no pueden alterarse mediante el CRUD administrativo sin permiso de validación.

La auditoría registra cambios de borrador, firmas, publicaciones y correcciones con instantáneas. El asesor de seguridad conserva los avisos generales previos y añade avisos por las 11 RPC privilegiadas del módulo: ejecución autenticada intencional con autorización interna. [Referencia del asesor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Contrato iOS

Se reutiliza sin cambios de firma `doctor_native_lab(p_encounter, p_test, p_reason, p_key)`. Se corrigieron los joins privilegiados de **`doctor_native_patient_labs` y `doctor_native_workspace`** para devolver únicamente resúmenes validados y publicados; antes no filtraban los borradores.

Las consultas actuales pueden seguir usando `result_summary` y `completed_at`, o leer `lab_results` bajo RLS. El resumen publicado incluye los parámetros y unidades reales, por lo que no es obligatorio cambiar iOS para leerlo. Para presentación estructurada, iOS puede incorporar `result_values`, `parameter_schema`, `published_revision`, `validated_at` y `published_at`. La disponibilidad del paciente continúa dependiendo de `published_to_patient_at`.

Las notificaciones persisten en la tabla compartida `notifications`: orden nueva para personal de laboratorio activo según su preferencia, publicación para el doctor solicitante y aviso al paciente únicamente al autorizar su consulta. Usan `kind='laboratorio'`, `entity_type='lab_orders'` y `entity_id` de la orden, sin contenido clínico. iOS debe consumir su bandeja propia y reconocer ese destino si aún no lo hace; no se cambió el campo de avisos vacío del contrato antiguo `doctor_native_workspace` sin conocer su decodificador. El panel web ya abre la orden desde la campana. No se modificó iOS ni web-preview.

## Verificación

### Cambio vigente: administración gestiona el proceso

Por la nueva indicación del usuario, `admin_laboratory_transport` sustituye el modelo anterior de autorizaciones: únicamente el rol admin activo procesa, valida y publica laboratorios. Se eliminó la pestaña Personal autorizado y se retiraron los endpoints para otorgar funciones de laboratorio o conducción. Las tablas históricas se conservan. `admin_laboratory_notifications` dirige las nuevas solicitudes a administradores activos respetando sus preferencias. Doctores y pacientes mantienen sus consultas de resultados publicados.

En Ambulancias se eliminó Conductores y la selección de personal al asignar una unidad. El administrador revisa, asigna y da seguimiento al servicio; las nuevas asignaciones usan `assigned_staff_id = NULL`, admitido por el esquema existente. Recepción conserva solicitudes y consulta de seguimiento. La auditoría registra la cuenta administradora que ejecuta cada operación.

La prueba vigente es `tests/admin-laboratory-transport.sql`: pasó con datos sintéticos y ROLLBACK, verificando laboratorio completo por admin, traslado sin conductor, permisos de doctor/recepción y lectura del paciente. Los scripts anteriores de laboratorio y traslados documentan el modelo previo de permisos y ya no constituyen la prueba de aceptación vigente.

### Rediseño de solicitudes y finalización guiada

La bandeja prioriza solicitudes reales, con estados compactos, búsqueda visible y filtros avanzados desplegables. Muestra paciente, expediente, examen, médico y fecha/hora con segundos en horario de El Salvador. El detalle incluye nombre, apellidos, DUI, correo y teléfono de solo lectura; los datos ausentes dicen «No registrado». El correo se obtiene dentro de la RPC protegida, sin claves privilegiadas en el navegador.

La migración `supabase/laboratory_guided_completion.sql`, aplicada como `laboratory_guided_completion`, amplía `laboratory_order_detail`, registra transiciones reales en `audit_logs` y añade `complete_laboratory_exam`. Reutiliza guardado, envío, validación y publicación existentes dentro de una única transacción. Rechaza datos incompletos, versiones desactualizadas y permisos insuficientes. La repetición de una publicación idéntica no duplica resultados ni avisos. El responsable de validación de la versión publicada se mantiene separado del responsable de un borrador de corrección.

«Completar examen» puede guardar cambios y finalizar todas las etapas si el usuario tiene los permisos correspondientes. Para funciones separadas se mantienen «Enviar a validación» y «Validar resultados». Un publicador puede finalizar una versión ya validada sin obtener permisos para editarla. Ser administrador sigue sin conceder firma clínica.

La inspección previa encontró cero órdenes, cero resultados y cero autorizaciones activas de laboratorio: no había órdenes ocultas por filtros. El administrador debe autorizar al personal real desde «Personal autorizado» antes de procesar solicitudes; no se concedieron permisos ficticios.

`tests/laboratory-guided-completion.sql` pasó con datos sintéticos y `ROLLBACK`: creación por `doctor_native_lab`, aparición en bandeja, identidad vinculada, procesamiento, rechazo de resultado vacío y de usuarios sin permisos, finalización directa, repetición segura, auditoría de estados, lectura nativa del doctor, lectura del paciente propietario y aislamiento de otro paciente. También inyecta un fallo de notificación durante la publicación y comprueba que no persisten ni el guardado, ni la firma, ni el estado Completada. No crea un expediente adicional.

Compilación de producción y las 16 pruebas locales correctas tras el rediseño. La revisión visual en navegador y el renderizado en el cliente iOS real siguen pendientes. El asesor conserva avisos generales del proyecto y marca la nueva RPC privilegiada como ejecutable por usuarios autenticados: es intencional y exige permisos clínicos internamente. [Referencia del asesor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Prueba manual: abrir Laboratorios, autorizar al personal habilitado, crear una solicitud desde una consulta médica, actualizar la bandeja, pulsar «Abrir solicitud», comprobar identidad, «Marcar En proceso», registrar resultados, guardar borrador o «Completar examen» y confirmar su publicación. Verificar después el expediente del doctor y los resultados del paciente propietario en iOS. No se modificaron iOS ni web-preview.

`tests/laboratory-workflow.sql` completó el flujo con datos sintéticos y `ROLLBACK`: orden por la RPC real del doctor, bandeja, procesamiento, borrador estructurado, envío, validación, publicación, autorización posterior al paciente, notificaciones, corrección y versiones. También verificó aislamiento de pacientes/doctores, ausencia de borradores en ambas RPC nativas y en `SELECT *`, rechazo de firma automática del administrador, rechazo de orden incompleta, unicidad de resultados y estados independientes de exámenes relacionados. El primer intento se detuvo por faltar el tipo de jornada en la preparación sintética; se corrigió el dato de prueba y la comprobación pasó.

Compilación y 16 pruebas locales correctas, incluidas alertas numéricas y navegación desde notificaciones. Pendiente revisión visual en navegador y comprobar las pantallas de iOS con su cliente real. No se alteraron órdenes ni resultados reales en las pruebas ni se publicó el frontend en un alojamiento externo.
