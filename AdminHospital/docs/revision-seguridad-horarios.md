# Revisión previa de seguridad — horarios y turnos

**No se ejecutó la migración ni se desplegó la corrección de la Edge Function en
Hospital Móviles.** Las consultas al proyecto conectado fueron de solo lectura.
Las instalaciones, registros sintéticos y reversiones se probaron únicamente en Docker.

Proyecto: `uvebpsbbwofthucghccc`, PostgreSQL `17.11.0.018`, estado `ACTIVE_HEALTHY`,
aislamiento predeterminado `read committed`. Captura inicial: 13/11/2026,
01:31:59 en Guatemala (`07:31:59Z`). La consulta final volvió a confirmar el mismo
conteo y huella de consultorios y la ausencia de las cinco columnas y de la nueva RPC.

## 1. Las cinco columnas propuestas

| Tabla | Columna | Definición | Necesidad |
| --- | --- | --- | --- |
| `public.doctor_schedules` | `active` | `boolean NOT NULL DEFAULT true` | Desactivar el horario médico conservando el historial. |
| `public.doctor_schedules` | `consulting_assignment_id` | `uuid NULL REFERENCES public.doctor_consulting_rooms(id) ON DELETE RESTRICT` | Vincular los horarios diarios a su sesión de consultorio, también cuando cruza medianoche; editar o desactivar ambos de forma coherente. |
| `public.doctor_consulting_rooms` | `active` | `boolean NOT NULL DEFAULT true` | Desactivar la sesión sin borrar su registro y liberar su intervalo para otras asignaciones. |
| `public.doctor_consulting_rooms` | `slot_minutes` | `integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 180)` | Guardar la duración de cita y validar duración y alineación al reservar. |
| `public.staff_absences` | `active` | `boolean NOT NULL DEFAULT true` | Desactivar descansos o ausencias sin borrar historia. |

No se añade ninguna columna a `auth.users`, `profiles`, `user_roles`, `staff` ni
`appointments`. Los UUID y vínculos de autenticación se mantienen.

## 2. Preservación de datos

La migración no contiene `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` ni operaciones
de limpieza de filas. No cambia valores de columnas existentes. Los `INSERT` y
`UPDATE` que aparecen dentro de definiciones de RPC se ejecutarán únicamente al
invocar esas RPC después del despliegue, no al crear sus definiciones.

Sí reemplaza **dos restricciones de exclusión**, **tres políticas SELECT** y la
definición de `schedule_appointment`. Esto es modificación de esquema y requiere
aprobación. Se realiza dentro de una transacción, sin exponer un estado intermedio
con restricciones temporalmente quitadas. Se añadieron límites de espera de bloqueo
de 5 segundos y de sentencia de 60 segundos para el despliegue.

Conteos reales al revisar:

| Tabla | Filas |
| --- | ---: |
| `consulting_rooms` | 20 |
| `appointments` | 0 |
| `staff_shifts` | 0 |
| `staff_absences` | 0 |
| `doctor_schedules` | 0 |
| `doctor_consulting_rooms` | 0 |

Hay un doctor y una recepcionista registrados. Se comprobó RLS habilitado en las
nueve tablas de identidad y planificación revisadas.

## 3. Registro de doctores y recepcionistas

Se restauró localmente el contrato de columnas y restricciones capturado del
proyecto, y se usaron las definiciones reales de sus funciones. Después de aplicar
la propuesta **solo localmente**, se comprobó que permanecen idénticas:

- `public.set_employee_role(uuid,hospital_role,boolean)`.
- `public.upsert_staff(uuid,text,text)`.
- Los triggers/funciones de creación de perfil y rol paciente, protección de perfil
  y helpers de identidad, así como cancelación y estados de citas.

`tests/planning-employee-compat.sql` reprodujo las operaciones de base de datos que
usa `manage-employees`: trigger de Auth, perfil, rol, staff, especialidades de doctor,
ausencia de especialidades en recepción, edición y desactivación sin agenda.
Pasó tanto con planificación vacía como con citas confirmadas sintéticas existentes.
No se crearon cuentas reales ni se pidieron contraseñas al administrador.

**Hallazgo confirmado:** la versión 4 desplegada de `manage-employees` puede tomar
un bloqueo de fila de `staff` antes del nuevo bloqueo global. En paralelo, la
programación toma el bloqueo global antes de comprobar la FK de `staff`. Se reprodujo
un deadlock entre esos dos órdenes, que PostgreSQL resuelve abortando una operación.
No hay corrupción, pero puede fallar una edición/recuperación concurrente.

Se preparó en `supabase/functions/manage-employees/index.ts` la adquisición del mismo
bloqueo global **antes** de los bloqueos de filas. Es compatible con la base actual
y con la propuesta. La prueba concurrente corregida terminó ambas operaciones.
Se verificó que esa adquisición y sus comentarios son la única diferencia respecto
al código de la función desplegada; no cambia el flujo Auth ni las validaciones.
**No se desplegó el ajuste:** debe ser un paso previo autorizado antes de habilitar horarios.

Límite de la comprobación: se probó PostgreSQL y se verificaron tipos del servidor;
no se realizó una nueva alta HTTP de Auth Admin API en el proyecto real. Esa prueba
con una sesión administrativa de prueba sigue siendo un control posterior al
despliegue autorizado, no una garantía ya ejecutada.

Desactivar a un doctor que ya tenga sesiones médicas vigentes exigirá resolver
primero esa agenda. Es una restricción nueva intencional para proteger citas,
distinta del registro inicial, que permanece permitido.

## 4. Citas

Actualmente no hay citas reales que transformar. No se altera `appointments` ni se
cambian sus estados, horarios, pacientes o consultorios durante la migración.
`schedule_appointment` conserva nombre, firma y parámetros, pero endurece las
reglas de disponibilidad: jornada, rol/estado de doctor, consultorio, ausencia,
duración y cuadrícula. Es compatibilidad de contrato, no ausencia de cambios de comportamiento.
Las apps deben respetar la duración configurada y volver a validar al reservar.
No hay código Swift/Kotlin en este repositorio para comprobar sus deserializadores;
los clientes deberían seleccionar campos explícitos o tolerar los campos adicionales.

Con citas confirmadas sintéticas se verificó que se rechazan, sin mover ni borrar
la cita: una ausencia coincidente, cambiar la duración, quitar la sesión de consulta
y modificar la jornada que la sostiene. También pasaron las carreras cita/ausencia
en ambos órdenes de confirmación y las citas nocturnas. No hay reprogramación automática.

## 5. RLS y privilegios

No se añade ninguna política de escritura para empleados. Las escrituras de las
cinco tablas de planificación siguen exigiendo `private.has_role('admin')`, cuyo
resultado procede del UUID de la sesión y de un rol activo, no de correo o metadatos.
La RPC administrativa es SECURITY INVOKER y además comprueba explícitamente admin.

Se probaron doctor, recepción, enfermería y paciente contra las cinco tablas:

- Los 20 intentos de INSERT fueron rechazados por RLS.
- Los 20 UPDATE y los 20 DELETE no afectaron filas.
- La RPC de configuración rechazó a los cuatro roles no administrativos.
- Anon no tiene EXECUTE sobre las nuevas RPC comprobadas; authenticated no puede
  llamar directamente al trigger privado de validación.
- Doctor solo lee su programación médica; recepción obtiene disponibilidad sin
  motivos privados de ausencias; la RPC de disponibilidad no devuelve pacientes.

Las funciones privadas usan `search_path=''` y no son ejecutables por PUBLIC,
anon o authenticated. La RPC de disponibilidad es SECURITY DEFINER porque reúne
ocupación y horarios sin exponer filas clínicas; verifica identidad y rol antes de leer.

## 6. Respaldo preparado y verificado

Archivos locales, excluidos de Git por `.private-backups/`:

- `.private-backups/planning-before-20261113T073159Z.dpapi`.
- `.private-backups/planning-before-20261113T073159Z.manifest.json`.
- `.private-backups/employees-edge-before-20261113T075039Z.dpapi`.
- `.private-backups/employees-edge-before-20261113T075039Z.manifest.json`.

El primer respaldo incluye metadata de columnas, restricciones, RLS, grants,
triggers y funciones relevantes, y las filas de las seis tablas de la sección 2.
El segundo guarda el código y metadatos de la versión 4 desplegada de la función
de empleados; no sus secretos de entorno. No se exportaron verificadores de
contraseña de Auth, tokens, historias clínicas ni filas de pacientes.

Cifrado: Windows DPAPI CurrentUser. No se guardó una contraseña ni clave de cifrado
en el repositorio. Se verificó lectura, descifrado y SHA-256, y se restauraron las
filas en PostgreSQL local comprobando sus huellas. El manifiesto contiene las
huellas de fichero y contenido y los conteos de referencia.

**Alcance limitado:** esto es un respaldo lógico del cambio, no un `pg_dump` integral
ni un respaldo completo de Auth/Storage. DPAPI depende de la identidad de Windows
y de sus claves del sistema; copiar el archivo a otro equipo no garantiza poder
descifrarlo. No debe considerarse la única copia de recuperación del hospital.
No pude comprobar la existencia/retención de backups administrados o PITR mediante
las herramientas conectadas. Antes de un despliegue productivo hay que verificar
un respaldo completo restaurable en Supabase Dashboard → Database → Backups.
[Referencia oficial de backups](https://supabase.com/docs/guides/platform/backups).

Para comprobar la copia local sin mostrar su contenido:

```powershell
& .\scripts\Read-PlanningBackup.ps1 -Path .private-backups/planning-before-20261113T073159Z.dpapi
```

## 7. Plan de reversión

`supabase/rollback_staff_planning.sql` está preparado con la definición exacta
de `schedule_appointment` y de las políticas/restricciones capturadas en vivo.
No se ha ejecutado en el proyecto conectado.

1. Si falla la migración antes de COMMIT, PostgreSQL revierte la transacción.
2. Si se confirma pero falla una comprobación antes de usar el módulo: pausar
   escrituras y ejecutar la reversión operativa **con autorización separada**.
   Verifica conteos y huellas de datos; si difieren, aborta sin borrar nada.
3. Esa reversión restaura la RPC anterior, las tres políticas y las dos exclusiones;
   retira los triggers/RPC/validadores nuevos. No usa CASCADE y no elimina filas.
4. **Conserva las cinco columnas nuevas**, evitando pérdida de sus valores.
   Es reversión operativa, no una restauración física idéntica del esquema.
5. Si ya se registraron horarios/citas o cambió un consultorio, se rechaza esta
   reversión automática. Se debe respaldar el estado nuevo y preparar una reparación
   hacia adelante o una reversión específica que conserve datos y citas.
6. El ajuste de bloqueo de la función de empleados puede mantenerse después de
   revertir el SQL: funciona también sobre el esquema anterior. No es necesario
   volver a la versión con el riesgo de bloqueo.

Se probaron las dos condiciones: la reversión inmediata conserva las filas y
restaura función/políticas originales; una fila nueva hace que aborte y esa fila
permanece intacta. No se promete reversión destructiva después de empezar a usar el módulo.

## Compatibilidad, riesgos y condiciones para autorizar

**Compatibilidad estructural confirmada** con la captura actual: columnas y
restricciones coinciden con el contrato local verificado, las funciones requeridas
existen, RLS está habilitado y no hay datos pendientes de transformar.

| Riesgo | Resultado / mitigación |
| --- | --- |
| Deadlock con edición de personal | Reproducido. Ajuste preparado y probado; desplegarlo antes de la migración. |
| Esperas y rendimiento | Bloqueo global conservador y validación de programación; el DDL tiene límites de espera. No se realizó una prueba de carga de producción. |
| Clientes móviles con duración distinta | Se rechaza una cita que no respete la duración/cuadrícula; conservar firma no elimina ese cambio de comportamiento. |
| Restricciones más estrictas | Vigencia finita de hasta 366 días, jornada y rol activos. El preflight debe repetirse si aparecen nuevos datos. |
| Reversión después de uso | El script se detiene para preservar los datos; requiere plan específico hacia adelante. |
| Respaldo completo del sistema | La copia cifrada parcial está comprobada; backup integral/PITR y su restaurabilidad no verificados mediante el conector. |

Archivos preparados:

- `supabase/preflight_staff_planning.sql`: comprobación **solo lectura** de la
  línea base; se probó localmente sobre el respaldo restaurado.
- `supabase/proposed_staff_planning.sql`: propuesta revisada, aún sin ejecutar.
- `supabase/rollback_staff_planning.sql`: reversión operativa protegida.
- `tests/planning-security-review.mjs`: compara contra el respaldo, prueba registro,
  RLS, citas y reversión exclusivamente en Docker.
- `tests/planning-lock-order.mjs`: reproduce el deadlock anterior y comprueba el ajuste.

Pruebas ejecutadas y aprobadas: suite de planificación/concurrencia, revisión sobre
el respaldo restaurado (incluyendo registro con citas confirmadas sintéticas),
regresión del orden de bloqueos, lint, cuatro pruebas de fechas y `deno check`.
Con el contenedor local iniciado, la revisión específica puede repetirse sin
escribir en Supabase:

```powershell
& .\scripts\Read-PlanningBackup.ps1 -Path .private-backups/planning-before-20261113T073159Z.dpapi -AsJson | node tests/planning-security-review.mjs
node tests/planning-lock-order.mjs
```

Orden recomendado tras autorización: verificar backup integral → refrescar respaldo
local/preflight si cambió la línea base → desplegar ajuste de empleados → ventana
breve sin escrituras → aplicar propuesta → verificar datos/RLS/registro HTTP y
advisors → habilitar el uso. No se ejecutó ninguno de esos despliegues durante la revisión.

SHA-256 de la propuesta revisada:
`5d1fa5e18367e4a3acf947c78f789a371c9b1ccf34645ef5c1cdc4736ff8057e`.

SHA-256 de la reversión:
`1151cf1b1731c2b52a1eec06d1749ff08466562a165d248c17f06ef80118acda`.

SHA-256 del código de empleados preparado:
`f3931511da41dc56f688bcc5bc8742a48fbfa3e20081b90070f9a508eae7ff16`.

## Avisos preexistentes del proyecto

La revisión de advisors detectó los mismos avisos previos, no causados por esta
migración: inventario con RLS sin política, `btree_gist` en `public`, 18 funciones
SECURITY DEFINER ejecutables por autenticados y protección contra contraseñas
filtradas deshabilitada. Ser SECURITY DEFINER no prueba por sí solo un acceso
indebido: requiere revisar la autorización de cada función. No se alteraron
configuraciones ajenas al módulo durante esta revisión.

Referencias de remediación:
[RLS sin política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[extensión en public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
[funciones privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
