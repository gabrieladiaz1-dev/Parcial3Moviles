# Personal hospitalario

Proyecto verificado: Hospital Móviles (`uvebpsbbwofthucghccc`).

## Administrador configurado

La cuenta `admin@gmail.com` ya existía con perfil. Se activó `admin` y se desactivó
`paciente` para su UUID `481779ee-4748-4be5-975d-7d3ee518c618`, mediante una
operación privilegiada de configuración inicial. No se cambió su contraseña.
El código comprueba roles activos por UUID; no concede permisos por correo.

Inicia sesión con esa cuenta y abre **Personal hospitalario**. Doctores y
recepcionistas pueden autenticarse pero no entrar al panel administrativo.

## Contrato verificado

Se leyeron `docs/LEEME_hospital_supabase.md` y
`supabase/hospital_universitario_supabase.sql`: las rutas solicitadas en la raíz y
`docs/database` no existen en este checkout. Después se consultó el esquema real,
incluidos columnas, restricciones, triggers, funciones y RLS.

- `profiles`: `id`, `first_name`, `last_name`, `phone`, `birth_date`, `city`, `updated_at`.
- `user_roles`: `user_id`, `role`, `active`.
- `staff`: `id`, `profile_id`, `employee_code`, `category`, `active`.
- `specialties`: `id` bigint, `name`, `active`.
- `doctor_specialties.doctor_id` referencia **staff.id**.
- RPC: `set_employee_role(uuid,hospital_role,boolean)` y `upsert_staff(uuid,text,text)`.

El frontend convierte `receptionist` a `recepcionista` en el servidor.
El formulario ya no pide institución, departamento ni licencia, campos ajenos al
esquema actual. No se modificaron tablas, funciones SQL ni políticas.

## Seguridad y recuperación

La función `supabase/functions/manage-employees/index.ts` implementa catálogo,
directorio, detalle, creación, edición, estado y recuperación de altas.

1. Verifica el bearer token con `auth.getUser` y exige `admin` activo.
2. Valida campos, contraseña, código único y especialidades activas.
3. Crea el usuario mediante Auth Admin API, confirmado y temporalmente bloqueado,
   sin enviar correo ni cambiar la sesión del administrador.
4. Conserva los datos permitidos del alta, **sin contraseña**, en `app_metadata`
   administrado por servidor, con `employee_pending = true`.
5. En una transacción establece `auth.uid()` al UUID verificado, vuelve a comprobar
   y bloquear el rol administrativo, completa perfil, llama las RPC existentes,
   guarda staff y especialidades. Cualquier fallo revierte toda esa transacción.
6. Después del commit, desbloquea la cuenta y elimina el payload temporal.
   Confirma éxito únicamente cuando Auth también termina correctamente.

Auth y PostgreSQL no comparten transacción. Un fallo posterior a crear la cuenta
la deja bloqueada y visible en **Altas pendientes de completar**. **Revisar solicitud**
permite corregir datos; guardar reanuda sobre el mismo UUID, sin contraseña nueva.
**Reanudar alta** reutiliza los datos guardados. Si se pierde la respuesta de red,
actualiza el directorio y las altas pendientes antes de volver a registrar.
No se eliminan automáticamente cuentas con posibles relaciones hospitalarias.

El servidor usa credenciales privilegiadas para Auth y la transacción: ese acceso
omite RLS deliberadamente y está protegido por la comprobación administrativa.
Las RPC mantienen sus propias comprobaciones. React solo tiene la clave publicable
y consulta sus roles bajo RLS. El módulo rechaza editar la propia cuenta o una con
rol admin activo. `profiles.updated_at` y `staff.xmin` detectan cambios concurrentes.
Desactivar actualiza tanto `staff.active` como el rol correspondiente.

El trigger público asigna exclusivamente `paciente`, aunque los metadatos pidan
otro rol. Se retiró el registro público de la pantalla del panel.

## Despliegue

**manage-employees ya está desplegada** en el proyecto indicado.
Para publicar cambios desde Supabase Dashboard:

1. Abre Edge Functions → `manage-employees` → editor.
2. Copia `supabase/functions/manage-employees/index.ts` a `index.ts` y despliega.
3. Conserva desactivada la verificación JWT del gateway: la función verifica
   ella misma el bearer token contra Auth y exige admin activo. La configuración
   también está en `supabase/config.toml`.
4. El entorno de servidor proporciona `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   y `SUPABASE_DB_URL`. Nunca copies secretos a variables `VITE_`.

Referencia: [variables de Edge Functions](https://supabase.com/docs/guides/functions/secrets).

El frontend utiliza `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` de
`.env.local`. Ejecuta `npm.cmd run dev` en Windows o `npm.cmd run build` para
generar `dist`. El frontend no se publicó en un alojamiento web durante este trabajo.

## Verificación de empleados

Ejecuta en SQL Editor después de registrar desde el panel:

```sql
select s.id as staff_id, s.profile_id, s.employee_code, s.category,
       s.active as staff_active, p.first_name, p.last_name,
       r.role, r.active as role_active,
       coalesce(array_agg(sp.name) filter (where sp.id is not null), '{}') as specialties
from public.staff s
join public.profiles p on p.id = s.profile_id
join public.user_roles r on r.user_id = p.id and r.role::text = s.category
left join public.doctor_specialties ds on ds.doctor_id = s.id
left join public.specialties sp on sp.id = ds.specialty_id
where s.category in ('doctor', 'recepcionista')
group by s.id, p.id, r.role, r.active
order by s.employee_code;

select id, email, banned_until from auth.users
where raw_app_meta_data->>'employee_pending' = 'true';
```

Doctor: rol y categoría `doctor`, con una o más especialidades.
Recepcionista: rol y categoría `recepcionista`, sin especialidades.
En ambos casos el rol `paciente` queda inactivo. Un alta pendiente no es un registro confirmado.

## Pruebas

- Compilación y lint: aprobados. También pasó `deno check` con la configuración
  aislada en `supabase/functions/manage-employees/deno.json`.
- `supabase/test_employee_registration.sql`: ejecutado con rollback y aprobado.
  Comprueba perfil, roles por metadatos, doctor, recepcionista, especialidades,
  código duplicado, edición, desactivación, rechazo de autoescalamiento y RLS
  ejecutando como `authenticated` (perfil propio y prohibición de insertar roles).
  No dejó empleados ni pacientes de prueba.
- `node --env-file=.env.local tests/employee-smoke.mjs`: aprobado para rechazo HTTP
  de credenciales ausentes y token inválido en la función desplegada.
- La prueba HTTP autenticada completa de Auth Admin API **queda pendiente** por
  falta de sesión administrativa de prueba. El proyecto requiere confirmación de
  correo para nuevas cuentas públicas; no se cambió esa configuración ni se pidió
  la contraseña real del administrador.

Para ejecutar la parte autenticada, proporciona `HOSPITAL_TEST_ADMIN_ACCESS_TOKEN`
solamente al entorno del proceso desde una sesión administrativa de prueba; no
lo guardes en archivos ni lo compartas por chat. El script crea dos cuentas
sintéticas mediante el endpoint y verifica alta, edición, roles, especialidades,
estado y denegación del acceso. Las contraseñas aleatorias solo existen en memoria.
Muestra los UUID para limpieza privilegiada: las cuentas de prueba quedan
desactivadas, no eliminadas. Comprueba que no tengan relaciones de uso real antes
de retirar sus especialidades, staff, roles, perfiles y finalmente Auth.

La revisión detectó avisos preexistentes fuera del módulo: extensión `btree_gist`
en `public`, inventario con RLS sin política y protección contra contraseñas
filtradas deshabilitada. Las RPC SECURITY DEFINER invocables por autenticados
requieren revisar sus comprobaciones individualmente al ampliar otros módulos.
No se cambiaron esas configuraciones.

Referencias de los avisos: [extensión en public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
[RLS sin política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection),
[RPC privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
