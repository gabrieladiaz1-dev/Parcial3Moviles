# Hospital Moviles

Panel web con React, TypeScript, Vite y Tailwind CSS. Conserva el dise?o y los colores existentes.

## Configuraci?n

El ?nico proyecto permitido es Hospital Moviles: `uvebpsbbwofthucghccc`.

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `.env.local` si el archivo todav?a no existe.
3. Configura la clave Publishable del mismo proyecto en `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Usa `VITE_SUPABASE_URL=https://uvebpsbbwofthucghccc.supabase.co`.
5. Inicia el frontend con `npm.cmd run dev` en PowerShell.

No uses la ruta /rest/v1/ como URL del cliente. El cliente normaliza esa ruta y rechaza hosts diferentes del proyecto configurado. La sesi?n usa un almacenamiento propio de Hospital Moviles para evitar reutilizar sesiones de otra integraci?n. No incluyas claves secretas ni contrase?as en el c?digo.

## Estado de la integracion

Hospital Moviles esta conectado y su esquema fue verificado. El acceso administrativo requiere el rol admin activo por UUID. El registro seguro de empleados utiliza la Edge Function manage-employees.

Consulta [Personal hospitalario](docs/personal-hospitalario.md) para registro y seguridad.

El modulo [Horarios y turnos](docs/horarios-y-turnos.md) incluye programacion semanal, jornadas nocturnas, consultas y consultorios. Los 20 consultorios CONS-01 a CONS-20 ya estan registrados. La propuesta SQL de horarios esta probada localmente y pendiente de aprobacion antes de modificar el esquema conectado; hasta entonces la escritura permanece bloqueada.

Consulta el [plan de despliegue](docs/despliegue-horarios.md), la [verificacion del respaldo integral](docs/respaldo-integral-supabase.md) y la prueba final preparada en `tests/planning-acceptance.mjs`. El panel requiere habilitacion explicita mediante `VITE_STAFF_PLANNING_ENABLED=true`; su valor por omision es `false`. Las compilaciones de staging usan un proyecto distinto y generan `dist-staging/`.

## Validaci?n

- `npm.cmd run build`
- `npm.cmd run lint`
