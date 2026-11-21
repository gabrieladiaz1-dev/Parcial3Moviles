# Solicitud de ambulancia (paciente) — 21 de noviembre de 2026

Estado: **implementado en iOS y web-preview; migración preparada y probada en PostgreSQL desechable; NO aplicada en Hospital Móviles.**
Swift sin compilar (no hay Mac). Panel administrativo: proyecto externo, sin acceso desde este repositorio.

## 1. Inventario previo [Supabase, consultas de solo lectura del 21 nov]

| Ya existía | Detalle |
|---|---|
| `ambulances` | Una unidad: `AMB-001`, `disponible`, activa. Estados `ambulance_state`: disponible, en_servicio, en_mantenimiento. RLS: lectura para autenticados. |
| `ambulance_requests` | 0 filas. Estados `dispatch_state`: pendiente, autorizada, despachada, finalizada, rechazada, cancelada. Clave de reintento única `(requester_id, request_key)`. |
| `ambulance_dispatches` | 0 filas. **`only_one_active_dispatch`: UNIQUE(ambulance_id) WHERE completed_at IS NULL** → la base de datos ya impedía dos servicios activos. Horas: dispatched_at, departed_at, arrived_at, controls_checked_at, completed_at. |
| `ambulance_status_history`, `emergency_logs`, `audit_logs` | Historial de la unidad y de cada solicitud (disparadores `panel_fleet_audit`, `panel_transport_audit`). |
| RPC administrativas (solo `admin`) | `review_medical_transport` (autorizar con destino / rechazar / cancelar antes del despacho), `dispatch_ambulance` → `assign_medical_transport` (candado `pg_advisory_xact_lock(901407021)` + `FOR UPDATE` + validación de estado), `progress_medical_transport` (salida/llegada, idempotente), `finish_medical_transport` (controles + disponible o mantenimiento), `save_panel_ambulance` (mantenimiento; bloqueado con servicio activo), `panel_transport_data` (admin y recepción). |
| Avisos a administración | `emit_panel_notice` con `event_key` estable: nueva solicitud y cierre/rechazo/cancelación. |
| Faltaba | Flujo del paciente (no tenía RPC; solo un INSERT directo que exigía expediente y aceptaba prioridad, fecha, destino y decisión del cliente), datos de recogida y coordenadas, avisos al paciente, Realtime, cancelación tras el despacho, bitácora filtrable por fechas, protección del historial. |
| iOS / web | No existía ninguna pantalla ni ruta de ambulancia (búsqueda en todo el repositorio). |

## 2. Pantalla

Nueva ruta `ambulance` (no existía ninguna). Se agrega igual que `rooms`: entrada **Más → Servicios del hospital → Ambulancia**, sin
cambiar el catálogo de 21 pantallas, sin otra barra inferior ni otra navegación.
iOS: `Patient/PatientAmbulanceView.swift`, `Patient/PatientAmbulanceModel.swift`, `Patient/AmbulanceRules.swift`.
Web: `web-preview/patient-ambulance.js` + `HospitalCore.ambulance` (núcleo compartido, también usado por iOS vía JavaScriptCore).

## 3. Flujo del paciente

1. Encabezado, descripción y advertencia de peligro inmediato. **No hay número de emergencias configurado** (`emergencyPhone = null` en ambos
   clientes): no se inventa; con un número oficial aprobado aparece el botón de llamada.
2. Formulario: nombre (solo lectura, de la cuenta), teléfono (precargado del perfil), teléfono alternativo, dirección, referencia,
   «Usar mi ubicación actual» opcional (permiso «al usarse» pedido solo al pulsar; denegarlo no bloquea), motivo, situación breve e
   indicaciones. Sin preguntas clínicas ni clasificación automática de gravedad (prioridad siempre `normal`; la decide el personal).
3. «Solicitar ambulancia»: valida, se deshabilita, envía con una clave de reintento y muestra solo la respuesta real del servidor.
4. Seguimiento: número `SA-XXXXXXXX`, estado, mensaje, línea de tiempo con **solo horas registradas**, dirección, mapa de la ubicación
   compartida (iOS), unidad, destino confirmado y última actualización. Sin tiempos estimados ni rastreo GPS de la ambulancia.

| Estado en Supabase | Se muestra |
|---|---|
| pendiente | Pendiente · «Solicitud recibida» |
| autorizada | En revisión (todavía sin ambulancia asignada) |
| despachada sin salida | Asignada · «Ambulancia asignada» |
| despachada con `departed_at` | En camino · «Ambulancia en camino» |
| despachada con `arrived_at` | En atención |
| finalizada / cancelada / rechazada | Finalizada / Cancelada / Rechazada (con motivo) |

Cancelación del paciente: solo pendiente o autorizada, con motivo. Despachada: «comunícate con el hospital»; la gestiona administración.

**Sincronización.** iOS usa Supabase Realtime (`postgres_changes` de `ambulance_requests` filtrado por `requester_id`, un canal por
pantalla, eliminado al cerrarla; supabase-swift 2.28 reconecta solo). Cada señal vuelve a leer `my_ambulance_context`. Respaldo: lectura
cada 30 s solo con una solicitud activa, al volver a primer plano y al deslizar para actualizar. Sin conexión se conserva el último estado
marcado «No se pudo actualizar…» hasta reconectar. La web no tiene cliente Realtime: lectura cada 30 s con solicitud activa.
Límite: las solicitudes registradas por personal a nombre del paciente (otro `requester_id`) no llegan por Realtime; sí por la lectura periódica.

## 4. Integración administrativa

Ya existe en Supabase y se reutiliza: autorizar/rechazar, asignar, salida, llegada, finalizar, mantenimiento, historial de la unidad y
`panel_transport_data`. Se añaden `cancel_dispatched_transport` y `ambulance_service_log`. **El panel administrativo es otro proyecto y no
está en este repositorio**: no se verificó su interfaz. Debe: (a) leer las columnas nuevas (referencia, coordenadas, situación,
indicaciones, teléfono alterno); (b) ofrecer «Cancelar servicio» con motivo, controles y destino de la unidad; (c) usar la bitácora
filtrable. Hasta entonces el flujo administrativo completo **no** está verificado de extremo a extremo.

## 5. Modelo de datos (supabase/ambulancia-paciente.sql)

Columnas opcionales en `ambulance_requests`: `pickup_reference`, `pickup_latitude`, `pickup_longitude`, `pickup_accuracy_m`, `situation`,
`pickup_notes`, `alternate_phone`, `updated_at` (+ restricciones de rango y longitud). Sin tablas ni estados nuevos.

## 6. RPC

| Función | Quién | Qué hace |
|---|---|---|
| `my_ambulance_context()` | paciente | Nombre y teléfono propios, disponibilidad informativa, sus solicitudes (máx. 20) sin personal ni notas internas |
| `submit_my_ambulance_request(...)` | paciente | Valida; identidad desde la sesión; expediente solo si existe; idempotente por clave; una sola solicitud activa; estado pendiente |
| `cancel_my_ambulance_request(id, motivo)` | paciente | Solo propias y antes del despacho; mismo candado que el despacho; idempotente |
| `cancel_dispatched_transport(despacho, motivo, controles, mantenimiento)` | admin | Cancela un servicio en curso con motivo y destino explícito de la unidad |
| `ambulance_service_log(desde, hasta, estado, solicitud, offset, límite)` | admin, recepción | Bitácora con horas reales, operador que autorizó y que despachó, eventos |

## 7. Seguridad (RLS y permisos)

RLS sin desactivar. El paciente ya no inserta directamente (se quita su rama de `ambreq_insert`); solo usa la RPC. Lectura sin cambios
(`ambreq_read`: propias o de su expediente). Sin UPDATE/DELETE para clientes; asignar, despachar y cambiar el estado de la unidad sigue
siendo solo `admin`. `anon` no ejecuta ninguna función nueva. Sin `service_role` en clientes. Historial no eliminable (BEFORE DELETE).

## 8. Una sola ambulancia: protección

- Asignación solo en el servidor, con candado transaccional global y `FOR UPDATE` (ya desplegado).
- Índice único parcial `only_one_active_dispatch`: aunque alguien se salte las RPC, la base de datos rechaza un segundo servicio activo.
- Solicitudes simultáneas: todas se registran como pendientes; ninguna se asigna sola; la decisión es del personal (orden por
  `requested_at` del servidor, no del cliente; prioridad clínica: decisión del personal autorizado, sin regla automática aprobada).
- Doble pulsación / reintento: clave de reintento + candado por paciente + bloqueo del botón.

## 9. Avisos

`private.ambulance_patient_notice` con `event_key = 'ambulance:<solicitud>:<evento>'` y el índice `notification_event_once`: recibida,
asignada, en camino, finalizada, cancelada, rechazada. Destinatarios: el solicitante si es paciente y la cuenta del expediente.
Los avisos a administración existentes no cambian. Se ven en la campana actual (icono de ambulancia → pantalla). **Sin APNs**: no hay
notificaciones con la app cerrada.

## 10. Pruebas

| Prueba | Cómo | Resultado |
|---|---|---|
| A–E, G, H y servidor de F | `scripts/test-ambulance-sql.mjs`: PostgreSQL 17 desechable con copia de producción (`scripts/fixtures/ambulancia-produccion-2026-11-21.sql`), sesiones psql concurrentes reales | 25/25 |
| Flujo web, doble pulsación, respuesta perdida, reconexión (F), cancelación, diseño sin API, paridad de 33 textos con Swift | `scripts/test-patient-ambulance.mjs` (transporte simulado) | Aprobada |
| Visual: 320/375/393/430 pt, texto al 130 %, esquema oscuro, conexión lenta, error, vacío | `scripts/visual-ambulance.mjs` (Edge headless, Supabase simulado en la página) | 27/27 · capturas en `docs/capturas/2026-11-21-ambulancia/` |
| Swift | `HospitalUniversitarioTests/AmbulanceRulesTests.swift` | **Sin ejecutar** (requiere Xcode) |

En la primera ejecución visual, justo después de reiniciar el servidor de vista previa, apareció una vez un error de JavaScript
(`modules` indefinido); no se reprodujo en cinco ejecuciones posteriores.

## 11. Pendiente

1. Autorización para aplicar `supabase/ambulancia-paciente.sql` (reversión: `ambulancia-paciente-revert.sql`, conserva columnas).
2. Número oficial de emergencias aprobado por el hospital (hoy no se muestra ninguno).
3. Compilar y ejecutar en Xcode: Realtime real, permiso de ubicación (`NSLocationWhenInUseUsageDescription` añadido), mapa, teclado
   abierto, Dynamic Type y tamaños de iPhone. El proyecto fuerza modo claro (`preferredColorScheme(.light)`); se respeta.
4. Panel administrativo externo: columnas nuevas, cancelación de servicio y bitácora (punto 4).
