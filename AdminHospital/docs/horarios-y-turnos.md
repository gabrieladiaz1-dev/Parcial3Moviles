# Horarios y turnos — Hospital Móviles

## Vista completa de la programación

La pantalla inicia en **Toda la programación** y muestra por empleado todas las fechas persistidas que devuelve el contrato actual (`saved_shifts`, `saved_consultations` y `saved_absences`). Cada día incluye entrada/salida, atención médica y consultorio cuando corresponda, y descansos. No hace falta navegar por semanas. Los filtros de empleado, día y fechas son opcionales; el calendario semanal sigue disponible como vista secundaria. **Editar día** conserva las fechas originales del resto de la programación; **Administrar grupos de fechas** permite editar o desactivar grupos con las reglas existentes.

El [plan de despliegue vigente](despliegue-horarios.md) incorpora modo de consulta
por bandera explícita, staging separado y la prueba final pendiente. La existencia
de las RPC ya no habilita por sí sola la escritura del panel.

La [revisión previa de seguridad](revision-seguridad-horarios.md) documenta el
respaldo cifrado, la reversión probada y el ajuste de concurrencia de empleados
que debe desplegarse antes de autorizar la ejecución de la propuesta.

## Estado y aprobación pendiente

Proyecto inspeccionado: `uvebpsbbwofthucghccc`.

Se registraron **20 consultorios activos**, `CONS-01` a `CONS-20`, usando la tabla
existente. El piso quedó sin asignar para no inventar una ubicación. El script
idempotente es `supabase/seed_consulting_rooms.sql`.

La interfaz está implementada en el menú **Horarios y turnos**, con calendario,
filtros, jornadas, guardias nocturnas, descansos, ausencias, consultas médicas y
gestión de consultorios. Desde **Personal hospitalario** se puede abrir el módulo
con el empleado seleccionado, también después de un registro exitoso.

**La escritura sigue bloqueada en el proyecto conectado**, porque el usuario pidió
no modificar el esquema sin aprobación. El archivo revisable es
`supabase/proposed_staff_planning.sql`; solo se ejecutó en PostgreSQL local aislado.
No ejecutes el esquema inicial completo sobre la base actual.

## Inspección del esquema real

| Tabla | Columnas existentes relevantes | Restricciones y acceso actuales |
| --- | --- | --- |
| `staff` | `id`, `profile_id`, `employee_code`, `category`, `active` | Código y perfil únicos; FK a `profiles` |
| `staff_shifts` | `id`, `staff_id`, `starts_at`, `ends_at`, `shift_type`, `status` | Fin posterior al inicio; exclusión de solapamientos salvo `cancelado`; admin modifica, empleado lee lo propio |
| `staff_absences` | `id`, `staff_id`, `starts_at`, `ends_at`, `reason` | Fin posterior al inicio; admin modifica |
| `doctor_schedules` | `id`, `doctor_id`, `weekday`, `start_time`, `end_time`, `valid_from`, `valid_until` | Día 0–6; fin posterior al inicio; fechas coherentes; admin modifica |
| `doctor_consulting_rooms` | `id`, `doctor_id`, `consulting_room_id`, `starts_at`, `ends_at` | Exclusiones de doctor y consultorio; admin modifica |
| `consulting_rooms` | `id`, `code`, `floor_id`, `active` | Código único; FK opcional a `hospital_floors`; admin modifica |
| `appointments` | `id`, `doctor_id`, `consulting_room_id`, `patient_id`, `starts_at`, `ends_at`, `status`, entre otras | Exclusiones por doctor, consultorio y paciente en citas vigentes |

Se verificaron columnas, FK, checks, exclusiones, privilegios, triggers, RLS y
definiciones de `schedule_appointment`, `cancel_appointment` y
`update_appointment_status`. Las siete tablas tienen RLS habilitado.

Al inspeccionar no había jornadas, ausencias, consultas, asignaciones ni citas.
Había un doctor y una recepcionista. El selector incluye cualquier categoría real
en `staff`, incluidas enfermería y otras futuras categorías existentes.

## Cambios SQL que requieren aprobación

No se proponen tablas nuevas ni se eliminan datos. Se propone:

1. **Cinco columnas nuevas**:
   - `doctor_schedules.active`: desactivar conservando historial.
   - `doctor_schedules.consulting_assignment_id`: FK a la sesión de consultorio
     que originó el horario; permite editar ambos de forma atómica.
   - `doctor_consulting_rooms.active`: desactivar sesiones sin borrarlas.
   - `doctor_consulting_rooms.slot_minutes`: duración de citas, 30 por defecto,
     entre 5 y 180 minutos.
   - `staff_absences.active`: desactivar ausencias y descansos conservando historial.
2. Sustituir las dos exclusiones existentes de consultorio para considerar solo
   asignaciones activas; añadir exclusión de ausencias activas del mismo empleado.
3. Exigir vigencia finita a horarios médicos activos, hasta 366 días. La interfaz
   programa lotes de hasta 84 fechas concretas. No crea una recurrencia infinita.
4. Añadir validaciones diferidas y un bloqueo transaccional compartido entre
   programación y citas. Las consultas deben estar cubiertas por jornada laboral;
   doctor, rol y consultorio deben estar activos. Un cambio no puede invalidar
   citas programadas, confirmadas o en atención que aún no hayan terminado.
5. Actualizar `schedule_appointment` **conservando firma y parámetros** para
   verificar jornadas, horarios médicos, consultorio, descansos, ausencias,
   duración y alineación de citas. Incluye citas que cruzan medianoche.
6. Crear RPC `save_staff_planning`, `read_staff_planning` y
   `get_medical_availability` con permisos explícitos.
7. Ajustar tres políticas de lectura: doctores consultan su propia programación;
   recepción consulta horarios y consultorios médicos, pero no motivos privados
   de ausencias ajenas. Admin conserva su acceso. Los turnos laborales siguen
   siendo visibles para admin y para el propio empleado.

El SQL corre dentro de una transacción. Si los datos existentes no cumplen las
nuevas reglas, debe fallar y hacer rollback, sin intentar corregirlos a escondidas.
Una segunda ejecución completa falla de forma segura: no es un script de reinicio.

## Seguridad y concurrencia

Las escrituras del frontend usan una RPC **SECURITY INVOKER**: se aplican los grants
y RLS existentes, además de exigir `admin` activo por UUID. No hay secretos en React.
Cada edición compara `xmin` con la versión leída y rechaza registros modificados
por otra operación. Esto evita sobrescribir silenciosamente a otro administrador.

Las funciones internas de comprobación están en `private`, con `search_path=''`
y sin permiso de ejecución para PUBLIC, anon o authenticated. Las ejecutan los
triggers. La RPC de disponibilidad necesita lectura privilegiada para reunir
disponibilidad y ocupación sin exponer pacientes: verifica usuario y rol y devuelve
solo doctor, nombre del doctor, consultorio, inicio, fin y duración.

El bloqueo transaccional serializa las modificaciones de planificación y citas;
los chequeos se ejecutan sobre el estado final antes de confirmar. También cubre
escrituras SQL directas a las tablas involucradas. Las operaciones requieren
aislamiento READ COMMITTED; otros niveles se rechazan, evitando lecturas antiguas
tras esperar un bloqueo. Las exclusiones GiST siguen reforzando los solapamientos.
Es una decisión conservadora para esta instalación; con mayor volumen conviene
medir latencias antes de evolucionar a bloqueos por recursos.

Un descanso puede estar dentro de la jornada y de la sesión médica: quita intervalos
de la disponibilidad. Si coincide con una cita vigente, se rechaza. No se mueve
ni cancela ninguna cita automáticamente. El operador debe realizar una
reprogramación explícita, usando el flujo autorizado de cancelación y nueva cita,
y después cambiar la programación. Una sesión sin citas puede desactivarse y
reactivarse; las versiones anteriores de sus horarios permanecen inactivas.

## Uso del panel después de aprobar el SQL

1. Registrar al empleado y pulsar **Asignar horario laboral**, o usar **Horarios**
   en su fila.
2. Asignar jornada indicando rango de fechas, días y entrada/salida. Una salida
   anterior a la entrada significa día siguiente (por ejemplo, 22:00–06:00).
3. Para doctores, crear consulta dentro de esa jornada, seleccionar consultorio
   y duración de cita. La sesión debe contener un número entero de citas.
4. Registrar descansos o ausencias. Son intervalos diarios seleccionados dentro
   del rango, no una ausencia continua de varios días.
5. Seleccionar un bloque del calendario para editar o desactivar una fecha.
   La repetición crea fechas independientes; no edita otras fechas a escondidas.
6. Consultar **Disponibilidad médica** para ver intervalos libres por doctor y
   consultorio. La reserva debe validar de nuevo para evitar carreras.
7. En **Consultorios**, editar código, piso y estado, o registrar más consultorios.
   No hay un tope artificial de 20. Se rechaza desactivar uno con sesiones vigentes.

Todas las fechas se muestran en `America/Guatemala` (UTC−6), sin depender de la
zona horaria del navegador. Los instantes se guardan como `timestamptz`. Las consultas
nocturnas se dividen internamente en horarios médicos diarios vinculados a una
misma sesión; se mantiene una sola asignación de consultorio a través de medianoche.

## Contrato para iOS y Android

Este repositorio contiene el panel React; no contiene archivos Swift ni Kotlin.
Queda preparado el contrato de Supabase, no pantallas móviles nuevas.
Las apps usan el JWT de su usuario y la clave publicable, nunca service_role.

- **Doctor**: obtener su fila `staff` por `profile_id = auth.uid()`; leer
  `staff_shifts` con `staff_id`, excluyendo `status = 'cancelado'`; leer
  `doctor_schedules` y `doctor_consulting_rooms` con `doctor_id` y `active = true`.
  Filtrar fechas al rango deseado. RLS restringe la lectura al propio doctor.
- **Recepción Android**: llamar `get_medical_availability` con `p_from`, `p_until`
  y opcionalmente `p_doctor` y `p_room`; el máximo es 31 días por consulta.
  El resultado excluye citas ocupadas y descansos/ausencias, sin revelar sus motivos.
- Para agendar, enviar un intervalo devuelto por esa RPC a `schedule_appointment`
  mediante sus parámetros existentes. No insertar citas directamente desde la app.
- Las sesiones de doctores y recepción no pueden ejecutar cambios de planificación.

Ejemplo del contrato RPC (equivalente en los SDK Swift/Kotlin):

```ts
const { data, error } = await supabase.rpc('get_medical_availability', {
  p_from: '2026-12-01T00:00:00-06:00',
  p_until: '2026-12-08T00:00:00-06:00',
  p_doctor: null,
  p_room: null,
})
// data: doctor_id, doctor_name, consulting_room_id, room_code,
//       starts_at, ends_at, slot_minutes
```

## Pruebas reproducibles

Se probó en un contenedor local PostgreSQL 17, con el esquema original y un stub
mínimo de Auth. No se añadieron pacientes ni citas de prueba al proyecto conectado.

```powershell
npm.cmd run build
npm.cmd run lint
node --test tests/planning-dates.test.mjs
```

Las pruebas SQL y de concurrencia están en `tests/planning-database.sql` y
`tests/planning-concurrency.mjs`. Para repetirlas, iniciar un contenedor dedicado:

```powershell
docker run --detach --name hospital-planning-test --label hospital.planning-test=true --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine
node tests/planning-concurrency.mjs
```

El script crea una base local aleatoria, instala el esquema y la propuesta, ejecuta
pruebas SQL y elimina solo esa base. El contenedor puede retirarse al terminar.
No requiere claves ni contraseñas del proyecto real. Los fixtures de Auth son
exclusivamente locales y no sustituyen una prueba de autenticación HTTP real.

Resultados aprobados:

- Compilación, lint y cuatro pruebas de fechas (zona horaria, semana, medianoche,
  repetición y límites).
- Jornada de doctor, recepción y enfermería; guardias nocturnas.
- Consulta fuera de jornada y solapamientos de doctor/consultorio rechazados.
- Disponibilidad según duración y cuadrícula; exclusión de descansos y citas.
- Protección de citas confirmadas frente a ausencia, cambio de duración y desactivación.
- Consulta que cruza medianoche y cita que termina exactamente a medianoche.
- Desactivación/reactivación sin revivir versiones anteriores; gestión de consultorios.
- Rollback completo de lotes y rechazo de versión desactualizada.
- RLS de doctor, privacidad de ausencias ante recepción, prohibición de escrituras
  a doctores/recepción y disponibilidad no autorizada para enfermería.
- Dos sesiones concurrentes reales: cita primero → ausencia rechazada; ausencia
  primero → cita rechazada. Se comprobó que la segunda esperaba el bloqueo.

**Pendiente tras aprobar:** aplicar la propuesta en Supabase, recargar el contrato
PostgREST, revisar advisors y realizar una prueba HTTP con sesión administrativa.
El frontend detectará las RPC para lectura. La edición exige además
`VITE_STAFF_PLANNING_ENABLED=true` y recompilar/publicar después de aprobar las
comprobaciones; el valor seguro por omisión es `false`.

Referencias: [RLS en Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security),
[triggers diferidos en PostgreSQL](https://www.postgresql.org/docs/17/sql-createtrigger.html).
