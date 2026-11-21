# Hospitalización en recepción

Abrir **Recepción → Hospitalización**. Los administradores también pueden abrir **Habitaciones y Camas** para consultar o gestionar el mismo inventario real. Acceso por roles activos `admin` y `recepcionista`, comprobados en servidor.

## Operación

1. **Solicitudes de ingreso:** abrir la indicación médica, tomarla en revisión, verificar el expediente y consultar camas de la categoría solicitada. Confirmar habitación y cama para ingresar al paciente.
2. **Habitaciones y camas:** consultar ocupación, filtrar por categoría/estado/habitación y ver el paciente asignado. Administración registra habitaciones y camas reales, mantenimiento y desactivaciones; no hay creación automática ni eliminación de inventario.
3. **Pacientes hospitalizados:** consultar los pacientes ingresados, ubicación, expediente, médico e historial. El filtro permite ver también las altas médicas pendientes de salida.
4. **Altas y salidas:** confirmar la salida únicamente después de la autorización médica. La cama pasa a limpieza; administración o recepción confirma después la limpieza terminada para devolverla a disponible.

Categorías reales inspeccionadas: `vip` y `semiprivada`. La interfaz no inventa una categoría «Semi VIP». Fuera de servicio se representa con `beds.active=false` o habitación inactiva; no se modifica el enum existente de estados de cama. No hay un flujo excepcional de salida sin alta médica.

## Backend compartido

Migración desplegada: `hospitalization_reception_control`, SQL revisable en `supabase/hospitalization_reception.sql`.

Reutiliza `hospital_admissions`, `rooms`, `beds`, `bed_assignments`, `medical_records`, `hospital_floors`, `bed_status_history` y `audit_logs`. Conserva las firmas de las RPC de iOS y las restricciones existentes de una hospitalización activa por paciente y una asignación activa por cama/paciente.

Extiende `beds` con habilitación y motivo operativo; `hospital_admissions` con revisión, responsable del alta y datos de salida. No añade tablas paralelas ni siembra habitaciones o camas.

Reutiliza `doctor_native_admission_request`, `doctor_native_admissions`, `request_admission`, `reception_admissions`, `reception_admission_availability`, `reception_resolve_admission`, `assign_bed`, `medical_discharge` y `release_bed`. La asignación valida también expediente, habitación activa y cama habilitada. Los reintentos de asignación, alta y salida son seguros para la misma operación.

Añade `reception_review_admission`, `reception_hospital_inventory`, `reception_hospital_detail`, `save_hospital_room`, `save_hospital_bed` y `complete_hospital_bed_cleaning`. Inventario editable solo por administración; limpieza autorizada para administración/recepción. Todos verifican roles en servidor. Las funciones privilegiadas nuevas revocan acceso de `PUBLIC` y `anon`, y conceden ejecución a `authenticated` con controles internos. RLS permanece activa. La auditoría registra estados de ingreso, revisión, inventario, cama, asignación y salida, con responsable y fecha.

Las solicitudes se paginan en el servidor, 25 por página y con filtro de estado. Buscador y categoría filtran la página cargada, como indica la interfaz.

El asesor de seguridad se consultó antes y después del despliegue. Los seis avisos nuevos corresponden a las RPC privilegiadas de este módulo, que requieren ejecución autenticada y comprueban los roles en su interior. Los avisos generales previos no se modificaron. [Referencia del aviso](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Contrato para iOS

Ya existe la operación segura de alta médica; no se necesita un backend adicional:

```text
doctor_native_admission_request(
  p_patient: UUID, p_kind: room_kind, p_reason: String,
  p_instructions: String?, p_priority: "normal" | "urgente",
  p_encounter: UUID?, p_key: UUID
) -> UUID

doctor_native_admissions(p_offset: Int = 0) -> JSON

medical_discharge(p_admission: UUID, p_notes: String? = null) -> Void
```

Mantener `p_key` al reintentar la misma solicitud. `doctor_native_admissions` devuelve `items`, `total`, `has_more`, `next_offset`, categorías, prioridad y, en cada ingreso, `status`, `assignment` e `history`. La asignación contiene habitación, cama, planta, entrada y salida. El alta produce `alta_medica`; recepción registra después `cerrado`. El timestamp de alta y las notas también están en `hospital_admissions` bajo la RLS vigente. `medical_discharge` solo admite al médico activo que ordenó ese ingreso; no libera la cama ni permite a recepción emitir altas.

Si iOS todavía no tiene botón de alta médica, debe mostrarlo únicamente para ingresos propios `hospitalizado`, solicitar confirmación, llamar a `medical_discharge` y recargar el seguimiento. No llamar a `release_bed` desde la aplicación del doctor. El estado de revisión se mantiene como `solicitado` para preservar el contrato del enum; su revisión se audita y se muestra en el panel.

## Verificación

`tests/hospitalization-workflow.sql` ejecutado una vez satisfactoriamente en Supabase con datos sintéticos y `ROLLBACK`: creación por administrador, solicitud/reintento del doctor, lectura por recepción, revisión/expediente, disponibilidad, asignación/reintento, visibilidad del doctor, alta sin liberar cama, salida/reintento, limpieza y disponibilidad. También comprobó rechazo con motivo, auditoría, doble asignación rechazada, prohibición de salida sin alta, bloqueo de alta/inventario por recepción, bloqueo de edición de habitación ocupada y aislamiento de pacientes.

Compilación de producción y pruebas existentes verificadas. Pendiente revisión visual en navegador y confirmar las pantallas en iOS; no se modificó ese repositorio ni se publicó el frontend en un alojamiento externo.
