# Plan de despliegue de Horarios y turnos

## Estado y límites de autorización

Producción: Hospital Móviles, `uvebpsbbwofthucghccc`.
**No hay autorización para migrar, desplegar funciones ni modificar datos reales.**
Este documento es un procedimiento futuro: ninguna de sus acciones sobre proyectos
Supabase se ejecutó durante su preparación. Tampoco se volvió a instalar la
migración en Docker, respetando la pausa solicitada.

El usuario confirmó que solo el panel React funciona; iOS existe pero está pendiente
de revisión y Android todavía no está desarrollado. Por tanto, no hay clientes
móviles operativos certificados ni una integración móvil que pueda declararse probada.

## 1. Ajuste de concurrencia preparado

`supabase/functions/manage-employees/index.ts` adquiere
`pg_advisory_xact_lock(726391054201)` antes de bloquear filas de roles o empleados.
La adquisición usa una función incorporada de PostgreSQL: no requiere las columnas
ni las RPC de horarios. Es compatible con la estructura anterior y con la nueva.

La comparación de solo lectura con el código desplegado confirmó versión 4 y que
la única diferencia del archivo preparado es esa adquisición y sus comentarios.
No cambia Auth Admin API, contraseñas, perfiles, asignación de roles o especialidades.

Pruebas ya realizadas en la revisión anterior: reproducción del deadlock con el
orden viejo; ambas operaciones concurrentes completadas con el orden corregido;
registro de ambos tipos de empleados bajo el esquema propuesto, incluso con citas
confirmadas sintéticas; validación de tipos Deno. El código mantiene la misma huella.
No equivale a una prueba HTTP integral de la función nueva en Supabase staging,
que sigue pendiente de autorización e infraestructura.

## 2. Controles locales de publicación preparados

Se añadió `VITE_STAFF_PLANNING_ENABLED=false` como valor de ejemplo y valor seguro
por omisión. El panel puede leer la programación, pero no abre formularios ni envía
escrituras desde su adaptador hasta que el valor sea exactamente `true`.
La existencia de la RPC ya no habilita automáticamente la edición.

Es un **control del despliegue web**, no una política de seguridad ni un bloqueo
de API. RLS y la comprobación admin siguen siendo la autorización. No detiene
llamadas directas, pestañas con versiones antiguas ni otros escritores: para la
ventana se debe coordinar una pausa real de las operaciones de escritura.

Vite incorpora estas variables al compilar: cambiarlas en el servidor sin reconstruir
el bundle no cambia lo publicado. El registro de empleados no depende de esta bandera.
No se modificó `.env.local` ni se publicaron los cambios locales.

La compilación de producción conserva el proyecto fijado. Una compilación con modo
`staging` requiere un `VITE_STAGING_SUPABASE_PROJECT_REF` distinto de producción y
rechaza la URL productiva. También usa almacenamiento de sesión separado.
`.env.staging.example` es la plantilla de `.env.staging.local`; no contiene secretos.

- Producción: `npm.cmd run build`, artefacto `dist/`.
- Staging: `npm.cmd run build:staging`, artefacto **`dist-staging/`**.
- No publicar el artefacto de staging en la dirección de producción.

## 3. Orden exacto de despliegue, solo tras autorización

| Paso | Acción | Condición para avanzar |
| --- | --- | --- |
| 0 | Confirmar respaldo integral y restaurarlo en un entorno aislado según `respaldo-integral-supabase.md`. | Evidencia del backup, restauración, RPO/RTO y controles de aislamiento. Si no existe, detenerse. |
| 1 | Ensayar en staging la Edge Function corregida **antes** de cambiar el esquema. | Alta/edición de empleados por HTTP y sesión admin válidas sobre el esquema anterior. No usar la cuenta ni claves del proyecto productivo. |
| 2 | En staging, instalar la propuesta; verificar RLS, esquema, concurrencia y registro HTTP, y realizar la prueba final descrita abajo. Ensayar el rollback en una copia desechable separada de la línea base, o conservar la evidencia local anterior. | No diferencias no explicadas ni errores. No usar para aceptación un entorno al que ya se aplicó el rollback. |
| 3 | Registrar huellas de artefactos y preparar la compilación productiva en modo de consulta (`VITE_STAFF_PLANNING_ENABLED=false`). | Compilación y pruebas aprobadas; sin cambios de contraseña ni de claves. |
| 4 | Tras autorización productiva específica, publicar primero el frontend en modo de consulta y coordinar pausa de escrituras de personal, agenda y consultorios. Cerrar/recargar pestañas antiguas y dejar terminar solicitudes en curso. | Todos los escritores identificados; si no puede asegurarse esa pausa, detener el cambio. La bandera por sí sola no basta. |
| 5 | Respaldar la versión realmente desplegada de la función y desplegar **solo** `manage-employees` corregida, incluyendo su configuración y dependencias fijadas. | Función activa y sin errores de arranque, identidad o rol. El esquema todavía es el anterior; el bloqueo nuevo funciona igualmente. |
| 6 | Actualizar el respaldo lógico y comparar la línea base; ejecutar el preflight de solo lectura. | Mismas estructuras y datos revisados. Si cambió algo, actualizar/revisar también el rollback y sus huellas antes de continuar. |
| 7 | Ejecutar `proposed_staff_planning.sql` una sola vez y en una transacción. | COMMIT confirmado. Si falla una sentencia, no continuar ni reintentar automáticamente. Los límites de bloqueo/sentencia son 5/60 segundos por sentencia, no una garantía de duración total. |
| 8 | Mantener el panel en consulta y comprobar columnas, restricciones, RLS, RPC, recarga de PostgREST, roles, versión de función y huellas de datos antiguos. | Ninguna modificación inesperada en filas anteriores. Evaluar advisors. Este es el punto de decisión antes de permitir uso real. |
| 9 | Si la comprobación falla, mantener la pausa y aplicar solo la reversión autorizada si la línea base coincide. Si pasa, reconstruir/publicar con `VITE_STAFF_PLANNING_ENABLED=true`, confirmar la versión en navegador y reabrir las operaciones. | Autorización de apertura, registro de resultados y observación de errores/latencias. |

No ejecutar primero SQL manteniendo la Edge Function vieja: reintroduciría el
orden de bloqueo que ya produjo un deadlock local. Si se desplegó la función nueva
pero el SQL no se puede aplicar, puede mantenerse la función corregida: es compatible
con la base anterior. No volver a la función vieja mientras estén activos los
triggers de planificación. La configuración JWT del gateway se conserva: la
función autentica y comprueba admin dentro de su código.

Si se pierde la respuesta de red alrededor de COMMIT, inspeccionar el esquema y
los datos antes de decidir qué pasó. No ejecutar otra vez a ciegas la propuesta.
La publicación SQL es atómica, pero el despliegue del frontend, la función y el
DDL son pasos separados: no existe una transacción que cubra los tres servicios.

## 4. Respaldo integral: pendiente de comprobación

El conector disponible no ofrece listado de backups/PITR ni certifica una restauración.
Un proyecto saludable y el respaldo parcial `.private-backups/` no son pruebas de
un backup integral. No se creó un proyecto, se activó PITR ni se ejecutó una restauración.

Seguir `docs/respaldo-integral-supabase.md`. Se debe aportar un identificador y punto
recuperable, alcance, fecha, evidencias de restauración y RPO/RTO observados. No
registrar contraseñas, tokens, claves de servicio o de cifrado en documentos o Git.

## 5. Qué recupera el rollback y qué no

La reversión operativa probada restaura la definición anterior de
`schedule_appointment`, las tres políticas SELECT y las dos exclusiones originales;
retira los triggers, RPC y validadores nuevos. Conserva los permisos existentes
de la función reemplazada. No elimina filas ni usa CASCADE.

No elimina las cinco columnas añadidas ni su FK/check de duración, no vuelve a
desplegar frontend o Edge Functions y no restaura Auth, Storage o configuración de
proyecto. El ajuste de bloqueo puede conservarse sobre el esquema anterior.

El script contiene huellas de la línea base anterior. Si ya hay horarios, citas
o consultorios modificados, **se niega a ejecutar la reversión**, evitando borrar
el trabajo nuevo o restaurar exclusiones incompatibles con el historial inactivo.
En ese caso hay que respaldar el estado actual y preparar una reparación hacia
adelante o una reversión específica con autorización adicional. Restaurar un
backup completo es una medida de desastre distinta; puede perder cambios posteriores
al punto elegido y afectar la disponibilidad, por lo que no es la primera respuesta.

Como conserva las cinco columnas, **no se puede volver a ejecutar sin más la misma
propuesta después del rollback**: sus ADD COLUMN no son idempotentes. Una nueva
puesta en marcha exigiría una migración específica revisada, o restaurar la línea
base en el entorno de ensayo. No borrar columnas para forzar el reintento.

## 6. Contrato de agenda para futuros clientes

La firma conservada es:

```sql
public.schedule_appointment(
 p_patient uuid, p_doctor uuid, p_room uuid,
 p_start timestamptz, p_end timestamptz, p_request uuid DEFAULT NULL
) RETURNS uuid
```

Los nombres, orden, tipos, parámetro opcional y retorno UUID se mantienen.
`p_doctor` sigue siendo **staff.id**, no `profiles.id`; `p_room` es UUID del
consultorio, no `CONS-01`. Los instantes deben enviarse con zona horaria explícita.
El cliente debe enviar el intervalo completo obtenido de `get_medical_availability`
y volver a manejar conflictos al reservar: una consulta de disponibilidad no bloquea un turno.

Cambios de comportamiento que iOS/Android deberán implementar:

| Caso | Resultado esperado |
| --- | --- |
| Duración distinta de `slot_minutes` o comienzo fuera de cuadrícula | Rechazo; usar inicio y fin devueltos por disponibilidad. |
| Doctor sin jornada, inactivo, sin rol activo, ausente o en descanso | No disponible o rechazo al guardar. |
| Consultorio no asignado, inactivo u ocupado | Rechazo; actualizar disponibilidad. |
| Lectura directa de horarios | Filtrar `active=true`; en turnos laborales excluir `cancelado`. RLS limita el doctor a sus propios horarios. |
| Recepción lee razones de ausencias ajenas | Ya no están disponibles. Debe usar la RPC de disponibilidad. |
| Modelos estrictos con `select('*')` | Seleccionar campos explícitos o tolerar los cinco campos nuevos donde correspondan. |
| Consulta nocturna o final exactamente a medianoche | Manejar cambio de fecha y mostrarlo; la nueva RPC permite intervalos válidos que cruzan medianoche. |

Errores previstos: `23P01` por solapamiento, `P0001` por regla de negocio, `42501`
por permisos, `PGRST202` mientras una RPC no esté instalada/en caché, `22P02` por
UUID inválido, `40P01` por deadlock y `55P03`/`57014` por bloqueo o cancelación.
No reintentar una creación sin comprobar si la anterior se confirmó; recargar datos
y conservar una explicación clara. El ajuste elimina la carrera reproducida,
pero no prueba la ausencia de todo deadlock posible con escritores desconocidos.

No hay Swift/Kotlin disponible ni aplicaciones móviles operativas para ensayar.
**No se certifica compatibilidad de una app instalada**. El contrato queda preparado
para la revisión futura de iOS y el desarrollo de Android. Esto no bloquea por sí
solo el módulo web, según el estado de aplicaciones confirmado por el usuario.
La página web antigua de Citas todavía tiene adaptadores pendientes; no debe usarse
como prueba integral de reserva ni considerarse conectada a esta RPC por este trabajo.

## 7. Prueba final preparada, todavía no ejecutada

Archivo: `tests/planning-acceptance.mjs`. No ejecuta migraciones ni crea cuentas,
pacientes o citas. Antes de cualquier solicitud rechaza el ref/host de producción,
exige proyecto staging explícito y `PLANNING_ACCEPTANCE_ALLOW_WRITES=staging-only`.
También comprueba un JWT de administrador contra Auth y el rol activo en PostgreSQL.

Preparación del entorno, siempre con autorización independiente:

1. En staging aislado, completar restauración y despliegue según los pasos anteriores.
2. Crear con la Edge Function dos empleados **sintéticos**, con códigos que empiecen
   `STG-PLAN-`: un doctor con especialidad y una recepcionista. No usar empleados
   reales copiados por la restauración. Proporcionar contraseñas solo al formulario/Auth.
3. Comprobar `CONS-01` activo y libre en la fecha futura elegida. Si staging no tiene
   el catálogo, prepararlo allí con autorización; el script no lo crea a escondidas.
4. Configurar `.env.staging.local` con URL, ref y clave publicable de staging. Mantener
   el token admin solo en el entorno del proceso desde una sesión de prueba.
5. Definir `PLANNING_ACCEPTANCE_DOCTOR_ID`, `PLANNING_ACCEPTANCE_RECEPTIONIST_ID`,
   `PLANNING_ACCEPTANCE_ADMIN_TOKEN`, `PLANNING_ACCEPTANCE_ALLOW_WRITES`; opcionalmente
   `PLANNING_ACCEPTANCE_DATE` y `PLANNING_ACCEPTANCE_ROOM_CODE`.

```powershell
# FUTURO: solo con staging autorizado y sesión de prueba en el entorno del proceso.
node --env-file=.env.staging.local tests/planning-acceptance.mjs
```

| Operación | Entrada | Resultado que comprueba el script |
| --- | --- | --- |
| Jornada de doctor | Fecha futura, 08:00–16:00 | Fila activa en `staff_shifts`. |
| Consulta y consultorio | Mismo doctor/fecha, CONS-01, 09:00–12:00, 30 minutos | Sesión activa y horario médico vinculado; seis intervalos libres. |
| Turno de recepcionista | Misma fecha, 22:00–06:00 | Turno de ocho horas con salida al día siguiente. |
| Lectura final | RPC del panel y disponibilidad | IDs, estados, consultorio, duración y fechas coherentes. |

Verificar visualmente esos tres bloques con la compilación de staging y los filtros.
Tras el ensayo no deben existir pacientes ni citas nuevos. El script deja los
registros sintéticos de staging para inspección y muestra sus IDs. Cada RPC confirma
su propia transacción: si falla un paso, los anteriores pueden existir. Inspeccionar
los IDs y corregir/desactivar desde staging antes de repetir; no hay borrado automático.
Ese ensayo **no se debe ejecutar en producción**, y su guard impide apuntarlo allí.
La apertura productiva se verifica primero con lecturas; cualquier alta real posterior
necesita estar incluida expresamente en la autorización de uso.

## 8. Disponibilidad y pérdida de información

No se puede garantizar riesgo cero ni cero interrupciones. El DDL toma bloqueos;
puede haber solicitudes esperando, rechazadas o canceladas. La pausa debe ser
anunciada y su duración medida en el ensayo; los límites de sentencia no son una
promesa de tiempo total. El bloqueo global necesita observación de carga real.

La propuesta no elimina datos y la reversión rechaza cambios de línea base, pero
una restauración de desastre solo recupera hasta el punto disponible. Faltan
RPO/RTO reales mientras no se pruebe un backup integral. No aprobar el despliegue
solo porque existe una copia parcial o porque las pruebas locales pasaron.

Riesgos pendientes: backup integral sin verificar; prueba HTTP completa de la
función preparada en staging; ensayo final y de restauración; latencias bajo carga;
control de todos los escritores y pestañas durante la ventana. La revisión móvil
queda como trabajo futuro, no como compatibilidad ya certificada.

## Artefactos fijados y comprobaciones de esta preparación

- Edge Function preparada SHA-256: `f3931511da41dc56f688bcc5bc8742a48fbfa3e20081b90070f9a508eae7ff16`.
- SQL propuesto SHA-256: `5d1fa5e18367e4a3acf947c78f789a371c9b1ccf34645ef5c1cdc4736ff8057e`.
- Rollback SHA-256: `1151cf1b1731c2b52a1eec06d1749ff08466562a165d248c17f06ef80118acda`.

Estas tres huellas coinciden con la revisión anterior. En esta preparación solo
se compilaron/verificaron archivos locales y se consultó en lectura el código
desplegado. Se aprobaron lint, compilaciones de producción/staging y ocho pruebas
de fechas/aislamiento de proyectos, incluida la negativa del ensayo a ejecutarse
contra producción antes de cualquier solicitud de red. El ensayo HTTP final solo
tiene esa prueba negativa y comprobación de sintaxis, no un
resultado PASS de ejecución. No se iniciaron migraciones, despliegues, restauraciones,
proyectos de prueba remotos ni cambios de datos reales.
