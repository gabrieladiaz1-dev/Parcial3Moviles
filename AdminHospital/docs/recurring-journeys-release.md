# Jornadas fijas y consultorios permanentes

## Edici?n desde hoy ? 19/11/2026

El formulario inicia en la fecha actual del hospital y permite asignar, editar la jornada completa o editar un d?a desde hoy. Las jornadas futuras tambi?n pueden adelantarse a hoy mediante `recurring_advance_start` (aplicada y definici?n remota verificada). La versi?n sustituida conserva su fecha inicial y se cierra en esa misma fecha con vigencia vac?a; al editar un d?a, los restantes conservan su inicio original. El frontend confirma estas fechas al releer. La desactivaci?n conserva la regla de ma?ana o posterior.

Se aplic? `recurring_same_day_editing` al proyecto `uvebpsbbwofthucghccc` mediante MCP autenticado. Se reley? la definici?n publicada de `save_recurring_journey_scope` y se confirm? que ?nicamente cambiaron el l?mite de fecha (`effective<today`) y su mensaje. Se conservan las validaciones de citas, conflictos, versiones y permisos. No se modificaron empleados ni se realizaron guardados de prueba sobre jornadas reales.

Frontend compilado y 14 pruebas locales aprobadas, con comprobaciones de fecha m?nima e inicial para asignaci?n, jornada completa y d?a. Esto verifica el formulario y la definici?n remota; no certifica un guardado real de empleado ni una publicaci?n del frontend en hosting.

## Edición recurrente por día — despliegue real

Se aplicó mediante MCP al proyecto `uvebpsbbwofthucghccc` la migración incremental **`recurring_weekday_editing`**, desde `supabase/recurring_weekday_editing.sql`. No se volvió a ejecutar la migración inicial. No se cambiaron políticas RLS ni los contratos antiguos de lectura, disponibilidad, alta y edición por fecha.

La nueva RPC `save_recurring_journey_scope` permite:

- `p_weekday` entre 0 y 6: cerrar la versión anterior, conservar los otros días con su configuración original y guardar exclusivamente el día seleccionado como una nueva regla semanal indefinida.
- `p_weekday = null`: cerrar atómicamente las versiones vigentes del empleado y reemplazar la jornada completa, verificando todos sus identificadores y versiones.
- `p_preview = true`: ejecutar validaciones dentro de una subtransacción y revertirla sin guardar, incluyendo cambios y auditoría. El frontend la utiliza antes del guardado definitivo; el servidor vuelve a validar al guardar.

Se añadió una columna generada de días y se adaptaron las exclusiones: un empleado puede tener configuraciones simultáneas en días distintos; un consultorio continúa reservado frente a cualquier otro doctor durante toda su vigencia. Las validaciones existentes de citas, descansos y consultorios se reutilizan y se amplió la comprobación de superposiciones nocturnas. No se crean excepciones por fecha ni se cambian citas automáticamente.

La interfaz muestra **Editar día** en las siete columnas y **Editar jornada completa**. Abre un diálogo sobre el mismo calendario, identifica el día que se repetirá y mantiene AM/PM. El frontend confirma posteriormente la versión guardada y la conservación de los otros días.

### Verificación en Supabase

Con doctor y recepcionista exclusivamente temporales, usando Auth y las RPC públicas con sesión ADMIN:

- Jornada inicial de siete días, 8:00 AM–4:00 PM.
- Sábado cambiado a 8:00 AM–12:00 PM y comprobado en las semanas 0, 4 y 12.
- Los otros seis días conservaron horas, atención, descansos y consultorio.
- Disponibilidad del doctor: 8 citas de media hora los sábados; 98 en total por semana tras el cambio, excluyendo los almuerzos de los demás días.
- Jornada completa cambiada a lunes–viernes, 9:00 AM–3:00 PM, verificada inmediatamente y ocho semanas después: 55 citas semanales con almuerzo excluido.
- Historial inicial conservado, con cuatro definiciones y tres versiones anteriores cerradas después de ambos cambios.
- Previsualización sin persistencia y reintento idempotente sin duplicados.
- Cuentas, jornadas y consultorio temporales limpiados; cero cuentas temporales restantes. No se modificaron personas ni citas reales.

Backend desplegado y probado. Frontend implementado y compilado, con 27 pruebas esenciales aprobadas. Se revisaron `package.json`, configuración Vite, archivos de proveedores y remotos Git. Los repositorios públicos `gabrieladiaz1-dev/AdminHospital` y `centDV/Hospital-IOS-Frontend` no mostraron workflows, GitHub Pages ni despliegues registrados; no se encontró destino de hosting ni una URL pública verificable. No se creó otro alojamiento. ADMIN local iniciado en `http://127.0.0.1:5173/`, con proyecto Supabase correcto y jornadas habilitadas. No afirmar que una publicación pública contiene estos cambios.

Archivos de esta ampliación: `StaffShiftsPage.tsx`, `StaffWeekCalendar.tsx`, `RecurringJourneyForm.tsx`, `JourneyEditorDialog.tsx`, `planning.ts`, `planningPersistence.ts`, la migración incremental, los scripts `Inspect-RecurringEditing.mjs`, `Deploy-RecurringWeekdayEditing.mjs`, `Test-RecurringWeekdayLive.mjs` y las pruebas de integración y formulario.

## Entrega inicial (referencia histórica)

Estado: el usuario confirmó que la migración **ya fue aplicada** desde su entorno administrativo al proyecto `uvebpsbbwofthucghccc`. No volver a ejecutarla. Esta entrega termina la integración del frontend con los RPC existentes y su sesión autenticada. No se modificaron tablas ni se ejecutaron migraciones durante esta integración.

## Cambios visibles

- **Asignar jornada** abre directamente un formulario por secciones: empleado, días y vigencia, horario, descansos y atención médica. No muestra el calendario ni programaciones ajenas.
- **Consultar jornadas** conserva el calendario semanal de un solo empleado, con lunes a domingo y horarios AM/PM.
- Entrada, salida, descansos y atención usan selectores independientes de hora (1–12), minutos y AM/PM. `4 PM` se envía al backend como `16:00`, sin mostrar «16 PM».
- Para recepción se ocultan consultorios, especialidades y atención médica.
- El consultorio de un doctor queda reservado durante toda la vigencia de la definición, incluso en descansos, noches y días libres. Se cambia desde la jornada o desde **Consultorios → Cambiar asignación**.
- Los conflictos y jornadas vigentes se advierten antes de guardar. La comprobación definitiva se realiza en PostgreSQL.

## Inspección y necesidad del esquema

Las estructuras actuales representan `staff_shifts`, `staff_absences` y `doctor_consulting_rooms` mediante fechas e instantes concretos. `doctor_schedules` representa únicamente ventanas médicas; la planificación existente exige vigencia finita y cobertura mediante jornadas por fecha. No permite expresar por sí sola una jornada laboral indefinida de recepción, descansos recurrentes, reserva permanente de consultorio e historial efectivo común.

La migración mínima se encuentra en **`supabase/recurring_staff_journeys.sql`**. Añade una tabla de versiones, `staff_recurring_journeys`, con días recurrentes, horas, descansos, atención, consultorio, especialidad y vigencia. Las ocurrencias se calculan en PostgreSQL para el intervalo solicitado; no se insertan filas nuevas cada semana y no se simula recurrencia en el navegador.

La tabla nueva tiene RLS habilitado y acceso directo revocado para `anon` y `authenticated`. No se cambia ninguna política de tablas existentes. Su acceso se limita a RPC con comprobación administrativa. Esto protege el nuevo almacenamiento y evita escrituras que omitan las validaciones.

## Historial y compatibilidad

- Un cambio cierra la vigencia efectiva anterior y crea una versión vinculada mediante `supersedes`. La configuración original se conserva.
- Desactivar establece `closed_on`; las consultas históricas siguen calculando los periodos anteriores al cierre.
- Las ediciones y desactivaciones se aplican desde mañana o una fecha posterior. Esto evita reinterpretar las horas transcurridas del día actual. La vigencia inicial puede comenzar hoy o después.
- Las jornadas antiguas por fecha **no se convierten ni modifican automáticamente**. Si coinciden con la nueva definición, el servidor rechaza la superposición. El administrador debe elegir una vigencia sin cruces o revisar explícitamente esa programación.
- `save_staff_planning` y `save_staff_planning_set` conservan sus contratos y siguen atendiendo excepciones y ediciones por fecha.
- `schedule_appointment` no cambia. Usa el validador existente, ahora compatible con ambas fuentes; las exclusiones originales de médico, consultorio y paciente siguen vigentes.
- `get_medical_availability` y `read_staff_planning` conservan firmas y campos anteriores. Se amplían con disponibilidad recurrente y metadatos de versiones. La lectura devuelve identificadores de proyección estables y el ADMIN nuevo los dirige a la edición de la definición, nunca a una fila temporal inexistente.
- Las funciones ampliadas se reemplazan **en el mismo OID** mediante `CREATE OR REPLACE`, conservando dependencias; sus implementaciones previas se copian a funciones privadas para reutilizar el comportamiento por fecha.
- El mismo bloqueo transaccional de planificación, restricciones de exclusión, control de versión y claves idempotentes protegen guardados simultáneos y reintentos.
- Se rechazan cambios que dejen citas vigentes fuera de disponibilidad. No se cancelan, reprograman ni borran citas automáticamente.

## Archivos de esta entrega

- `src/pages/StaffShiftsPage.tsx`: separación de consulta/asignación, acceso a versiones y reserva fija en consultorios.
- `src/components/RecurringJourneyForm.tsx` y `.css`: formulario de jornada recurrente y resumen.
- `src/components/FriendlyTimeField.tsx`: selector AM/PM, reutilizado también en la edición antigua.
- `src/lib/recurringJourney.ts`: validación del formulario y vigencias.
- `src/lib/planning.ts`: tipos y contrato `save_recurring_journey`.
- `src/lib/planningGroups.ts`: identificación de proyecciones y separación de excepciones por fecha.
- `supabase/recurring_staff_journeys.sql`: migración.
- `tests/recurring-journey.test.mjs` y `tests/staff-week.test.mjs`: pruebas locales de lógica y renderizado.
- `tests/recurring-journeys.database.sql`, `tests/recurring-appointments.database.sql` y `tests/recurring-exceptions.database.sql`: pruebas PostgreSQL con datos sintéticos.

## Verificación efectuada

`npm.cmd run build` y 19 pruebas locales de interfaz/lógica correctas. Ejecución:

```powershell
node --test --test-concurrency=1 tests/recurring-journey.test.mjs tests/staff-week.test.mjs
```

Migración ejecutada desde cero en PostgreSQL 17 mediante un contenedor **local con `--network none`**, sin puertos publicados ni conexión a Supabase. Orden de preparación de la base local:

1. `tests/planning-local-auth.sql`.
2. `supabase/hospital_universitario_supabase.sql`.
3. `supabase/proposed_staff_planning.sql`.
4. `supabase/fix_staff_planning_selection.sql`.
5. `supabase/recurring_staff_journeys.sql`.
6. Los tres archivos `tests/recurring-*.database.sql`, en el orden indicado arriba.

Los scripts iniciales son exclusivamente para una base local vacía: **no aplicar el esquema inicial ni los fixtures sobre Supabase**.

Se verificó con SQL real:

- Jornada de recepción de lunes a sábado visible al inicio y 364 días después.
- Jornada médica y exclusión de almuerzo y días libres de la disponibilidad.
- Reserva exclusiva del consultorio, incluso si otro doctor elige días distintos.
- Reintento idempotente sin versiones duplicadas.
- Cambio de consultorio desde una fecha efectiva, conservando la versión anterior.
- Persistencia tras `COMMIT`, sin materializar jornadas semanales en las tablas por fecha.
- Guardado de una cita mediante `schedule_appointment` y exclusión del espacio ocupado.
- Rechazo de citas duplicadas, descansos y horas fuera de jornada.
- Rechazo atómico de ediciones o desactivaciones incompatibles con citas existentes.
- Desactivación futura sin eliminar citas ni relaciones.
- Excepción real por fecha aplicada al horario recurrente.
- Protección de cambios superpuestos con la salida de un turno nocturno.
- Disponibilidad y guardado antiguos por fecha funcionando junto a las nuevas reglas.
- Acceso administrativo y rechazo de guardados desde recepción/acceso directo a la tabla.

## Integración final del ADMIN

- Configuración comprobada: URL `https://uvebpsbbwofthucghccc.supabase.co`, clave de tipo publicable y escrituras de planificación habilitadas en `.env.local`. No se imprime ni se incorpora una clave administrativa al frontend.
- `src/lib/planningRpc.ts` utiliza el cliente Supabase compartido con la sesión de `AuthGate`. Comprueba que exista sesión antes de invocar RPC; el SDK adjunta y renueva el JWT del usuario. No se sustituyen credenciales por la clave pública como Authorization ni se omiten permisos.
- Asignar, editar y desactivar utilizan `save_recurring_journey` con `p_values`, `p_id`, `p_version` y la misma `p_key` en reintentos.
- Consultar jornadas usa `read_staff_planning` con `p_from` y `p_until`. Se eliminó la lectura alternativa que ocultaba una RPC inexistente devolviendo listas vacías de horarios.
- Los errores distinguen autenticación, permisos de función, RLS, red, clave pública, firma RPC, versión concurrente y conflictos de horarios. Conservan operación y código, sin registrar credenciales ni datos de empleados.
- `src/lib/planningPersistence.ts` exige leer nuevamente la versión después de guardar. Confirma empleado, días, horas, descansos, atención, consultorio, especialidad y vigencia. En edición también confirma el cierre efectivo de la versión anterior; en desactivación confirma el cierre y que esa versión no proyecte nuevas jornadas posteriores.
- Para jornadas indefinidas, verifica ocurrencias en una semana cuatro semanas después. Para doctores consulta `get_medical_availability` con el mismo doctor y consultorio. Una lista vacía puede ser válida si el horario está ocupado por citas o ausencias.
- El formulario solo muestra éxito y actualiza el calendario después de estas confirmaciones. Si una lectura falla tras aceptar el guardado, conserva la operación pendiente y su clave para reintentar, evitando un segundo envío distinto.
- Se retiró el mensaje que atribuía automáticamente los problemas a una migración pendiente. Un contrato `recurring_ready` ausente se identifica como problema concreto de la respuesta de lectura; hay un botón para actualizar los datos.

Se añadieron cinco pruebas específicas en `tests/planning-integration.test.mjs` y pasó la compilación. Estas pruebas verifican el transporte autenticado, errores y confirmación posterior, y no sustituyen un guardado remoto autenticado.

El usuario eligió completar la integración con **verificación automática desde ADMIN**, sin proporcionar una sesión de prueba para el agente. Por ello no se certifica una escritura autenticada remota ejecutada por el agente. No se requiere acceso PostgreSQL ni volver a desplegar la migración para utilizar esta integración.
