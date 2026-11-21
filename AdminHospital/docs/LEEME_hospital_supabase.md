# Hospital Universitario — guía de implementación

## Antes de ejecutar

1. Usa **un proyecto Supabase nuevo**, con PostgreSQL 15 o superior. El archivo SQL crea tipos, tablas, funciones y políticas; no es idempotente.
2. Abre **SQL Editor** y ejecuta todo `hospital_universitario_supabase.sql` como `postgres`.
3. Se crean **11 habitaciones y 17 camas** (5 VIP individuales y 6 semiprivadas dobles). Confirma esa capacidad antes de producción.
4. Configura `America/El_Salvador` en la interfaz para visualizar horas; los eventos se guardan en `timestamptz`.
5. En Supabase revisa **Data API / exposed schemas**. La instalación concede privilegios SQL explícitos a las tablas seleccionadas, pero la configuración de exposición del proyecto también debe permitir acceder a `public`.

## Primer administrador

El SQL **no crea cuentas con contraseñas**. Crea primero un usuario en Supabase Authentication (desde el dashboard o Auth Admin API), y después ejecuta en SQL Editor, sustituyendo el UUID:

```sql
UPDATE public.user_roles SET active=false WHERE user_id='UUID_DEL_ADMIN' AND role='paciente';
INSERT INTO public.user_roles(user_id,role,active)
VALUES ('UUID_DEL_ADMIN','admin',true)
ON CONFLICT(user_id,role) DO UPDATE SET active=true;
```

Esto debe hacerse una única vez como operación de bootstrap privilegiada. El trigger de `auth.users` asigna `paciente` a toda cuenta nueva para evitar escalamiento por metadatos. El administrador crea doctores y recepcionistas desde una **Edge Function autenticada** que verifica su rol en la base de datos y usa la **Auth Admin API** en el servidor; después llama a `set_employee_role` y `upsert_staff`. No coloques la clave secreta en iOS, Android ni web.

## RPC principales

- `register_patient(dui, phone, city)` — paciente autenticado, crea ficha y expediente.
- `create_walkin_patient(...)` — recepción, crea paciente presencial y expediente.
- `schedule_appointment(...)`, `cancel_appointment(...)`, `update_appointment_status(...)` — agenda.
- `request_admission(patient, kind, reason, instructions, encounter)` — doctor tratante.
- `assign_bed(admission, bed)` — recepción, exige orden y cama libre.
- `medical_discharge(admission, notes)` — doctor que ordenó el ingreso.
- `release_bed(admission)` — recepción, exige alta médica; cama pasa a limpieza.
- `set_bed_state(bed, state)` — admin, habilita cama tras limpieza.
- `dispense_item(item, qty)` y `add_inventory(medication, qty, reason)` — inventario.
- `dispatch_ambulance(request, staff)`, `complete_dispatch(dispatch, maintenance)` — administración.
- `publish_lab_result(order, summary, to_patient)` — administración; `reception_release_lab(order)` — recepción.

## Limitaciones importantes antes de producción

**Este archivo es un esquema inicial amplio, no una certificación de seguridad clínica ni un sistema hospitalario listo para producción.** Es necesario probar cada RLS con cuentas reales, comprobar concurrencia, habilitar copias de seguridad, implementar gestión de consentimientos y cumplir la normativa de datos sanitarios aplicable.

- **Archivos de laboratorio:** se incluye `lab_result_files.storage_path`, pero **no se crea un bucket ni políticas de `storage.objects`**. Hasta implementar un mecanismo seguro de subida/descarga con URL firmada desde un backend que compruebe la misma relación clínica, no expongas archivos clínicos.
- **Resultados de laboratorio:** `publish_lab_result` es una operación administrativa de ejemplo. En producción se necesita un rol específico de laboratorio o validación profesional y trazabilidad de resultados inmutables.
- **Datos personales y DUI:** son sensibles. Los permisos de lectura de `patients` para recepción y administración son amplios por necesidades operativas; conviene crear endpoints de búsqueda limitados, evitar descargas masivas y auditar accesos.
- **Roles y empleados:** crear usuarios con contraseña requiere una Edge Function/Auth Admin API. El SQL solo prepara los datos y la autorización; no crea esa función HTTP.
- **Ajustes de especialidades, horarios, turnos y medicamentos:** la mayoría de catálogos permiten CRUD de administración bajo RLS; las actualizaciones de stock deben hacerse con RPC para preservar bitácora. Desactiva registros históricos en vez de borrarlos.
- **Laboratorios, auditoría y notificaciones:** las tablas están preparadas, pero las integraciones externas de notificaciones push, validación de laboratorio y auditoría de lectura necesitan implementación adicional.
- **Control de horarios:** la función de agenda verifica horarios recurrentes, ausencias y consultorio; requiere cargar `doctor_schedules` y `doctor_consulting_rooms` antes de agendar.
- **Acceso clínico:** el acceso del doctor persiste para pacientes atendidos anteriormente. Si se necesita caducidad estricta, reemplaza esa regla por asignaciones temporales y auditoría de acceso.
- **Paciente presencial que luego crea cuenta:** el vínculo seguro de identidad necesita un procedimiento verificado; no debe hacerse solo por DUI.
- **Autenticación y privacidad:** no confíes en `raw_user_meta_data` para roles; aplica MFA al personal, contraseñas robustas, políticas de retención y auditorías periódicas.

## Consultas rápidas de verificación

```sql
SELECT kind, count(*) AS habitaciones FROM public.rooms GROUP BY kind;
SELECT count(*) AS camas FROM public.beds;
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='patients';
SELECT * FROM public.ambulances;
```

Resultados esperados: 5 VIP, 6 semiprivadas, 17 camas, RLS habilitado, AMB-001 disponible.

## Registro de empleados ADMIN — 18 de noviembre de 2026

El formulario agrupa datos personales, laborales y acceso; Enter avanza entre entradas sin enviar el formulario. Las selecciones conservan su teclado nativo; el autocompletado permite flechas y Enter y el calendario permite elegir mes y año directamente, navegar días con flechas o escribir DD/MM/AAAA. El alta se realiza mediante el botón Registrar empleado. La edición y los cambios de estado conservan confirmación.

El catálogo local contiene 44 municipios y 262 distritos de la [Asamblea Legislativa](https://www.asamblea.gob.sv/node/12806), con contexto municipal y departamental para diferenciar nombres repetidos. La [reestructuración aprobada](https://www.asamblea.gob.sv/node/12819) respalda esa organización. Se conserva `profiles.city` como texto con el nombre del distrito; no se migra ni restringe el texto de ciudades existentes. Los teléfonos se normalizan como `7777-7777`, admitiendo pegado con +503. Frontend y Edge Function validan ocho dígitos y prefijos 2, 5, 6 y 7 conforme al [Plan de Numeración SIGET 2025](https://www.siget.gob.sv/wp-content/uploads/2025/09/PLAN-DE-NUMERACION-2025.pdf).

Por indicación explícita del solicitante, `manage-employees` asigna la contraseña inicial fija solicitada, definida exclusivamente en el código del servidor. Sustituye el requisito previo de generar contraseñas aleatorias. El administrador no escribe contraseñas. Solo el éxito del alta nueva o la recuperación de una de estas altas pendientes devuelve `credentials` y `staffId`, con `Cache-Control: no-store`. Listados, detalles y edición no devuelven credenciales. Las altas pendientes anteriores mantienen su contraseña previa y no devuelven una contraseña supuesta. No se altera ninguna contraseña de cuentas existentes.

El modal usa un diálogo con foco contenido, permite revelar o copiar los datos explícitamente y retira las credenciales de la interfaz al cerrar o transcurridos cinco minutos. No las guarda en almacenamiento web ni en tablas, auditoría o metadatos. La copia al portapapeles es voluntaria y debe entregarse solo al empleado. Una contraseña compartida no ofrece la seguridad de una contraseña aleatoria individual.

**Límite real: el cambio obligatorio al primer acceso queda pendiente.** El esquema actual autoriza acceso con roles activos (`private.has_role`) y tiene políticas como `profile_read` y `shifts_read` que permiten lectura propia sin comprobar cambio de contraseña. Un indicador o una pantalla por sí solos no impedirían acceso directo a la API. Garantizar esa restricción requiere autorización específica para adaptar la autorización del backend, un flujo de cambio verificado y pantallas coordinadas en iOS/Android (y cualquier cliente afectado). No se modificaron tablas ni políticas RLS. El login actual conserva su contrato.

Para activar este cambio se deben desplegar juntos el frontend y la nueva versión de `manage-employees`, incluyendo `validation.ts`. No se desplegó contra Supabase desde esta tarea. La compilación web no verifica ni ejecuta el runtime Deno. La prueba esencial sin datos de producción es `node --test tests/employee-validation.test.mjs`. El smoke autenticado existente se actualizó al contrato de credenciales generado por el servidor; no se ejecutó porque crea usuarios de prueba.

### Código consecutivo automático

El administrador ya no introduce el código. `manage-employees` ignora cualquier código enviado para crear un empleado y asigna el siguiente valor numérico de `staff.employee_code`, con ceros a la izquierda: `004` → `005`. Considera también empleados inactivos y no renumera códigos anteriores. La edición conserva el código guardado, aunque el cliente intente cambiarlo. El código asignado se devuelve en `employeeCode` y aparece en el modal final.

La lectura del máximo y la inserción ocurren dentro de la misma transacción, después del bloqueo global existente y de un bloqueo `SHARE ROW EXCLUSIVE` sobre `staff`. Este último impide inserciones o cambios concurrentes del catálogo de empleados mientras se asigna el código. La restricción UNIQUE existente sigue protegiendo su unicidad. Una recuperación reutiliza el código del perfil si la transacción previa se confirmó y solo falló la finalización de Auth. Los códigos no numéricos históricos se conservan y no participan en el consecutivo. Al alcanzar `999`, el alta se rechaza; no vuelve a `001` ni produce códigos de cuatro dígitos. No se agregaron secuencias, tablas ni cambios de RLS.

Antes de confirmar la transacción y desbloquear Auth, se comprueba mediante lectura SQL que existen el perfil y empleado correctos, código, datos personales, correo, cargo, estado y exactamente las especialidades solicitadas. Si esa comprobación falla, se revierte la transacción y el alta no se confirma. El flujo de recuperación existente permanece disponible.

Verificación local: seis pruebas de validaciones, incluyendo límites `001`, `009` → `010`, `099` → `100`, `998` → `999` y rechazo al agotarse; compilación y lint del módulo. No se ejecutó un alta remota ni una prueba real de concurrencia: este entorno solo tiene URL y clave pública, sin sesión administrativa ni conexión SQL privilegiada. Es necesario desplegar la Edge Function actualizada antes de usar el nuevo formulario; no basta con publicar el frontend. El smoke autenticado verifica ahora el código persistido y que la edición no lo cambia, pero no se ejecutó contra cuentas reales.

Los iconos de especialidades se resuelven por su nombre (corazón, ojo, cerebro, pulmones y pediatría) y usan un estetoscopio como opción médica para cualquier especialidad nueva, sin agregar columnas al catálogo.

### Gestión simplificada del directorio

La versión actual conserva únicamente Ver ficha, Editar y Desactivar/Reactivar. Se retiró la eliminación de empleados; los paquetes anteriores que la incluían son históricos y no deben desplegarse. Código, perfil e historial se conservan. La confirmación de desactivación muestra citas, asignaciones vigentes y consultas abiertas, con nueva comprobación en el backend antes de guardar.

El contrato final preparado es `employees-2026-11-status-v3`, para la función `manage-employees`. Revoca todos los roles laborales activos y restaura solo los autorizados sin duplicarlos. La protección del backend impide desactivar la cuenta propia y cualquier cuenta con rol administrador, incluida la última activa. No se modificaron tablas, RLS ni empleados reales.

La disponibilidad real y el despliegue pendiente de autorización se detallan en [employee-actions-release.md](employee-actions-release.md). No hay verificación administrativa remota en esta tarea; no se da por publicado ni probado en Supabase el bloqueo de acceso preparado localmente.
