# Ambulancias, avisos y cuenta del personal

## Accesos

- **Ambulancia** en el menú: unidades, solicitudes, conductores e historial. Administración puede registrar/editar unidades y autorizar conductores; recepción puede solicitar, revisar, asignar y operar los traslados autorizados.
- **Campana**: avisos propios, contador de no leídas, lectura individual o general y apertura del registro relacionado. Consulta cada 30, 60 o 120 segundos según la preferencia del usuario; no consulta periódicamente cuando la pestaña está oculta. La lectura se guarda en Supabase.
- **Avatar/nombre**: Mi perfil, Configuración (administración), Acerca del hospital, Cómo llegar y Cerrar sesión. Menú con Escape, flechas, Inicio/Fin y navegación por Tab. El cierre utiliza el flujo Auth existente.
- **Configuración**: información institucional, contacto, ubicación oficial y preferencias de avisos de la cuenta. Sin dirección ni teléfonos de ejemplo. El mapa solo usa datos registrados; no asume la ubicación de UNICAES.

## Migraciones desplegadas

1. `panel_settings_profiles_notifications`, fuente `supabase/panel_account_notifications.sql`.
2. `panel_ambulance_operations`, fuente `supabase/panel_ambulance_operations.sql`.

Se reutilizan `profiles`, `user_roles`, `staff`, `patients`, `medical_records`, `notifications`, `ambulances`, `ambulance_requests`, `ambulance_dispatches`, `ambulance_status_history`, `emergency_logs` y `audit_logs`. Solo se crean `hospital_settings` y `panel_preferences`, con RLS y sin información institucional inventada.

Se extienden las notificaciones con referencia al registro y clave de evento única por destinatario. Los eventos nuevos de solicitudes de atención, ingresos, altas médicas, traslados y mantenimiento generan avisos según rol activo y preferencias. No se generan avisos retrospectivos ni se incluyen nombres de pacientes o motivos médicos. Se excluye al autor del evento para evitar avisos de su propia acción. Los incidentes de mantenimiento se dirigen a administración; solicitudes e ingresos a administración/recepción.

La restricción anterior `ambulances.id=1` se reemplaza por un identificador automático para admitir unidades reales adicionales. Las existentes se conservan. Se añaden placa, habilitación y observaciones, destino/prioridad/clave de reintento en solicitudes y fechas/responsables de progreso y finalización. La autorización de conducción se almacena en `staff.ambulance_driver_authorized`; no crea otro rol ni empleados ficticios. Administración debe autorizar al personal real antes de asignarlo.

Las firmas existentes `dispatch_ambulance` y `complete_dispatch` se conservan. El despacho ya no fija la unidad 1: utiliza una unidad disponible y exige conductor autorizado y destino. La finalización requiere llegada y controles registrados. La pantalla utiliza las RPC específicas siguientes para hacer explícitos estos pasos. Las solicitudes antiguas sin destino requieren confirmarlo antes de asignar.

Las RPC nuevas verifican autorización en servidor y revocan ejecución de `PUBLIC`/`anon`. No se usa una clave privilegiada en el cliente. Configuración y flota se editan exclusivamente por administración; el perfil no permite cambiar roles. Recepción solo puede editar su contacto personal. El asesor de seguridad conserva los avisos generales previos y añade avisos de ejecución autenticada para las 15 RPC privilegiadas del módulo, intencionales con control interno de rol. [Referencia del asesor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Contrato preparado para iOS

No se modificó iOS ni web-preview. No se comprobó que exista una pantalla iOS conectada a estas operaciones.

```text
request_medical_transport(
  p_patient: UUID, p_contact: String, p_phone: String,
  p_origin: String, p_destination: String, p_reason: String,
  p_priority: "normal" | "urgente", p_key: UUID
) -> UUID
```

El doctor debe estar activo y autorizado para tratar al paciente, que debe tener expediente. Mantener `p_key` durante un reintento de la misma solicitud. El seguimiento puede leer `ambulance_requests` y `ambulance_dispatches` con la sesión del doctor y sus políticas existentes. La asignación/finalización no corresponde a un paciente o doctor por el mero hecho de solicitar un servicio.

Para administración/recepción:

```text
panel_transport_data(p_offset=0, p_status=null, p_request=null) -> JSON
review_medical_transport(p_request, p_action, p_destination=null, p_reason=null)
assign_medical_transport(p_request, p_ambulance, p_staff) -> UUID despacho
progress_medical_transport(p_dispatch, p_event="salida"|"llegada", p_notes=null)
finish_medical_transport(p_dispatch, p_controls_confirmed, p_maintenance, p_notes=null)
```

El responsable de conducción activo y autorizado también puede registrar progreso/finalización de su servicio asignado. Confirmar controles devuelve la unidad a disponible o mantenimiento; la llegada por sí sola no la libera. Se impide una segunda asignación activa de la misma unidad o conductor. Finalización y asignación son seguras ante reintentos idénticos.

## Archivos del cambio

- Integración: `src/App.tsx`, `src/types.ts`, `src/components/Sidebar.tsx`, `src/components/PageHeading.tsx`, `src/lib/pageAvailability.ts`.
- Cabecera: `src/components/Topbar.tsx` y `Topbar.css`.
- Pantallas: `AmbulancePage.tsx`, `ConfigurationPage.tsx`, `ProfilePage.tsx`, `InstitutionPage.tsx` y estilos compartidos `PanelOperations.css`.
- Acceso a datos: `src/lib/panel.ts`, `transport.ts`, `panelNavigation.ts`, `institutionMap.ts`.
- Apertura de registros: `src/lib/reception.ts`, `src/pages/ReceptionPage.tsx`, `HospitalizationPage.tsx`.
- Dos SQL, `tests/panel-operations.sql`, `tests/panel-navigation.test.mjs` y esta guía.

## Verificación realizada

`tests/panel-operations.sql`: una ejecución satisfactoria con usuarios y recursos sintéticos y `ROLLBACK`. Comprobó guardado de configuración/perfil, registro y consulta de unidades, autorización de conductores, solicitud/reintento por doctor, recepción y apertura del registro, asignación/reintento, rechazo de unidad/conductor duplicados, salida/llegada/controles/finalización, historial, notificación por hospitalización y mantenimiento, preferencias de destinatario, aislamiento por RLS, lectura persistente al cambiar de identidad y marcar todas leídas. No se modificaron pacientes ni servicios reales.

Compilación de producción y 14 pruebas locales correctas, incluidas navegación a registros específicos y mapas sin ubicación inventada. Pendiente comprobar visualmente los menús y el cierre de sesión en navegador, y conectar/validar el consumo en iOS. No se publicó el frontend en un alojamiento externo.
