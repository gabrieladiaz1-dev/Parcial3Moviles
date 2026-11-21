# Médico: recetas, laboratorio, historial y consultas no realizadas — 21 nov 2026

Estado: iOS y web-preview implementados; web probada (transporte simulado + visual a 320/375/393 pt). Swift **sin compilar** (sin Mac).
Migración `supabase/medico-historial-detallado.sql` **preparada, no aplicada** (la conexión MCP es de solo lectura).

## Diagnóstico [Supabase, solo lectura]

| Problema | Causa real |
|---|---|
| Recetas del historial como texto plano | `doctor_native_chart` (desplegada) construye cada medicamento con `concat_ws(' ', nombre, concentración, dosis, …)`; el cliente además las unía con saltos de línea. |
| Resultado de laboratorio «resumido» | No es un problema de permisos ni de consulta: `native_mobile_lab_page` sí devuelve parámetros, valores, unidades, referencias, observaciones y fechas. Los 2 resultados reales publicados solo tienen **observación de texto** (0 parámetros, 0 valores). La interfaz del médico lo mostraba dentro de un desplegable genérico. |
| Médico sin autorización | `doctor_native_chart` responde `42501 Paciente no asignado`; la app muestra «Tu cuenta no tiene acceso a esta operación…», nunca «sin registros». |
| Buscar pacientes atendidos | `private.treats_patient` ya incluye a todo paciente con al menos una consulta (`clinical_encounters`) con ese médico, sin límite de fecha: siempre aparece en la búsqueda. Una cita solo cancelada o no atendida no es una consulta realizada y no da acceso al expediente (comprobado en la prueba SQL). |
| Canceladas y vencidas | Datos reales: 4 completadas, 4 canceladas, 6 no atendidas (pg_cron activo marca las vencidas). Antes solo se veían como subsección del día dentro de FINALIZADAS y el servidor no enviaba el motivo de cancelación. |

## Cambios

- **Servidor (preparado):** `doctor_native_chart` añade a cada receta `doctor_name` e `items`, con nombre, concentración, presentación, dosis, unidad, frecuencia, vía, días, cantidad y observaciones. `doctor_native_workspace` añade `cancellation_reason` y `cancelled_at`. Solo se agregan campos; la salida anterior queda idéntica (comprobado). Se parte de las definiciones desplegadas, con el mismo hash que producción. Las mismas reglas de acceso.
- **Presentadores compartidos:** `HospitalCore.clinicalCards` (JS) ↔ `ClinicalCardRules` (`Core/ClinicalCardRules.swift`); `doctorClinical.notPerformed/notPerformedNote` ↔ `DoctorClinicalRules`. `prescriptionLine` incluye la concentración (también en «Mis recetas» del paciente).
- **Componentes compartidos:**
  - Web: `web-preview/clinical-cards.js`. iOS: `Design/ClinicalCardViews.swift`.
  - Tarjeta de medicamento, receta resumida con «Ver receta» y orden de laboratorio con «Ver resultado».
  - La tarjeta de medicamento es la misma que usa el paciente en «Mis recetas»; los permisos y las acciones siguen separados.
- **Médico:**
  - Historial → consulta: secciones Recetas y Exámenes con las nuevas tarjetas.
  - Pantalla Recetas: «Recetas de mis consultas de este paciente» con la tarjeta de receta.
  - Laboratorios: «Mis órdenes de laboratorio» con la tarjeta de orden.
  - Agenda: tercer filtro **NO REALIZADAS** (canceladas y vencidas de los 30 días anteriores, la más reciente primero, agrupadas por fecha, con motivo real o «La cita venció sin que se iniciara la consulta.»). FINALIZADAS muestra solo las atendidas.
- **Sin la migración:** las recetas muestran cada línea registrada por separado («formato anterior del servidor») y las canceladas «Cancelada sin motivo registrado.». No se inventan campos.

## Pruebas

| Prueba | Resultado |
|---|---|
| `test-doctor-history-sql.mjs` (PostgreSQL desechable; hash de producción, compatibilidad, recetas con uno y varios medicamentos, entregada y pendiente, concentración ausente, canceladas y vencidas, médico sin autorización, paciente atendido una vez) | 9/9 |
| `test-doctor-clinical-cards.mjs` (casos 1–12 del pedido; paridad de 18 textos con Swift) | Aprobada |
| `test-doctor-agenda`, `test-doctor-directory`, `test-doctor-laboratory` | Actualizadas al diseño nuevo y aprobadas |
| Suite completa (26 scripts), `check-project.py`, `git diff --check` | Aprobadas |
| Visual `visual-doctor-cards.mjs` a 320/375/393 pt | 24/24 después. Capturas: `docs/capturas/2026-11-21-medico/antes` y `/despues` |
| Swift (`ClinicalCardRulesTests.swift`) | **Sin ejecutar** (requiere Xcode) |

## Diferencias iOS / web

- En iOS el detalle de la consulta del historial es una hoja (`sheet`); en la web, una sección en la misma pantalla.
- Los indicadores de la agenda de iOS reducen el tamaño del texto en 320 pt en lugar de cortarlo.
- La web no tiene Realtime; la agenda se actualiza como antes.

## Pendiente

1. Autorización para aplicar `supabase/medico-historial-detallado.sql`. La reversión es volver a ejecutar las definiciones de `scripts/fixtures/medico-historial-produccion-2026-11-21.sql`.
2. Compilar y ejecutar en Xcode.
3. **Aviso sobre la ambulancia:** en producción se aplicó por otra vía la migración `paciente_ambulancia_habitaciones_medico`. Crea `patient_request_ambulance`, `patient_ambulance_requests` y `patient_cancel_ambulance`. Por eso **no debe aplicarse** `supabase/ambulancia-paciente.sql`, que duplicaría las RPC. Los clientes iOS y web deben adaptarse a esas RPC existentes; queda pendiente de decisión.
