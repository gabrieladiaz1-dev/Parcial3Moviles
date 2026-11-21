# Recepción

Abrir el panel con una cuenta con rol activo `admin` o `recepcionista` y seleccionar **Recepción**. En desarrollo: `npm.cmd run dev`. El administrador inicia en **Panel general**, seguido de **Personal hospitalario** y **Recepción** en el menú. Las recepcionistas inician directamente en Recepción y solo ven esta sección. Las pantallas independientes **Citas y Turnos** y **Pacientes e ingresos** se retiraron de la navegación; sus operaciones se realizan dentro de Recepción.

## Uso

1. En **Solicitudes de atención**, buscar y abrir una solicitud. Continuar para dejarla en revisión.
2. En **Verificar expediente**, revisar la cuenta vinculada o buscar por DUI completo. Comparar nombre, documento y nacimiento antes de confirmar identidad. Si no existe, crear y vincular usando los datos enviados por iOS.
3. Elegir fecha y consultar disponibilidad. Seleccionar médico/horario, revisar jornada, consultorio y duración, confirmar los datos con el paciente y guardar.

La preferencia horaria ordena sugerencias; no crea disponibilidad. La base de datos valida jornada, atención médica, ausencias, especialidad y reservas concurrentes. La cita y el estado `agendada` se guardan en una transacción. Un reintento idéntico devuelve la misma cita.

El apartado **Pacientes y expedientes** busca por DUI completo. **Agenda de citas** muestra paciente, médico, consultorio y estado por fecha. Las horas corresponden a El Salvador.

## Contrato y despliegue

Se inspeccionó el proyecto Supabase `uvebpsbbwofthucghccc`. El documento `ATENCION_IOS_2026-11-13.md` no existía en este repositorio; se consultaron las tablas, funciones, restricciones y políticas reales.

Migraciones aplicadas:

- `reception_attention_workflow`: columna opcional `closure_reason`, RPC `close_attention_request` y `create_attention_patient`, y extensión compatible de `schedule_appointment` conservando su firma y validaciones existentes. La creación reutiliza `create_walkin_patient` y `link_attention_patient` dentro de una transacción.
- `reception_operational_context`: lecturas acotadas `reception_doctor_day` y `reception_agenda`, con autorización explícita para roles activos. Excluyen notas clínicas y motivos de ausencias.

Los SQL revisables están en `supabase/reception_workflow.sql` y `supabase/reception_read_context.sql`. No volver a ejecutar el esquema inicial del hospital. No se modificaron iOS, usuarios reales, roles de pacientes ni políticas RLS.

## Verificación realizada

- Compilación de producción y 10 pruebas existentes: correctas.
- `tests/reception-workflow.sql`: ejecutado con datos sintéticos y `ROLLBACK` en Supabase. Verificó envío por la RPC de iOS, lectura RLS por recepción, revisión, creación/vinculación del expediente, disponibilidad, cita, reintento sin duplicados, estado y lectura de la cita por la cuenta paciente. También comprobó el identificador de cita en `my_attention_requests` y la conservación del rol paciente.
- Lecturas operativas: consulta bajo rol de recepcionista y rechazo de médico inexistente comprobados con datos sintéticos revertidos.
- Revisión de seguridad: los nuevos endpoints usan autorización interna y permisos explícitos; el asesor detecta sus funciones `SECURITY DEFINER` accesibles a `authenticated`, algo intencional para estas RPC con control de rol. Avisos generales previos del proyecto no fueron alterados. [Referencia del asesor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Pendiente: prueba visual del panel en navegador, confirmación de la pantalla **Mis citas / Dashboard** en la aplicación iOS y publicación del frontend en su alojamiento habitual. Se comprobó el acceso de datos para iOS, no su renderizado. El rechazo/cancelación y la vinculación manual a un expediente preexistente están implementados, pero no se incluyeron en la prueba completa ejecutada.

La bandeja inicia en pendientes y en revisión, priorizando pendientes y ordenando cada estado desde la solicitud más antigua. Consulta hasta 100 registros por estado en cada carga; **Cargar más solicitudes** continúa el mismo orden. Programadas, rechazadas y canceladas se consultan con el selector de estado. Los indicadores muestran totales exactos del servidor; la búsqueda filtra las solicitudes cargadas. La agenda muestra hasta 200 citas por día.
