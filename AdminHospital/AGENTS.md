# Hospital Móviles — instrucciones del proyecto

## Supabase y MCP

- Proyecto autorizado: **`uvebpsbbwofthucghccc`**. Su API es `https://uvebpsbbwofthucghccc.supabase.co`.
- El servidor MCP oficial configurado en Codex se llama **`supabase-hospital-moviles`** y usa `https://mcp.supabase.com/mcp?project_ref=uvebpsbbwofthucghccc&features=database,debugging,development,functions,docs`.
- Reutiliza esta conexión para inspeccionar esquema, RPC, migraciones, Edge Functions y registros. Antes de actuar, confirma el proyecto con `get_project_url` o una comprobación equivalente del servidor conectado.
- La presencia de configuración no demuestra autenticación ni permisos: comprueba una lectura real y las herramientas disponibles. No afirmes que una operación remota se realizó sin su resultado.
- La conexión se autenticó mediante OAuth y se verificó contra el proyecto real el **18/11/2026**: lectura de tablas, RPC, migraciones, funciones Edge y registros técnicos correcta; herramientas `deploy_edge_function` y `apply_migration` disponibles. Vuelve a comprobar la conexión en cada trabajo; esta verificación no autoriza escrituras futuras.
- Si las herramientas MCP no aparecen en una sesión nueva, revisa primero `codex mcp list` y `codex mcp get supabase-hospital-moviles`. Si requiere autenticación, inicia `codex mcp login supabase-hospital-moviles` y deja que el usuario autorice OAuth en el navegador. Puede ser necesario volver a abrir la sesión de Codex para cargar nuevas herramientas.
- Para verificar la conexión sin extraer credenciales ni generar respuestas de otro modelo, también está disponible `node scripts/Verify-SupabaseMcp.mjs`. Usa el transporte MCP autenticado del app-server de Codex y solo hace lecturas acotadas. No ejecutes `codex exec` como sustituto ni leas el almacenamiento de credenciales OAuth para imprimirlo o copiarlo al proyecto.
- No solicites `DATABASE_URL`, claves administrativas ni tokens en el chat cuando MCP y OAuth permitan efectuar la operación. Los secretos y credenciales OAuth deben quedar en el almacenamiento seguro del cliente, nunca en archivos del proyecto, logs, respuestas o commits.
- Conserva los demás servidores MCP y la configuración existente. No cambies el proyecto ni amplíes su alcance sin autorización.

## Operaciones y verificaciones

- Para comprobar la conexión, consulta metadatos, nombres de tablas/RPC, historial de migraciones, listado de funciones y registros técnicos acotados. No leas contenido clínico ni datos personales si no son necesarios para la tarea.
- No ejecutes migraciones, SQL de escritura ni despliegues para demostrar que una herramienta existe. Verifica su disponibilidad y describe cualquier limitación de permisos que no se haya podido probar sin cambios.
- La autorización para configurar MCP no autoriza cambios en empleados, pacientes, tablas, políticas o funciones. Para trabajos posteriores, respeta las autorizaciones de la tarea y completa lo ya autorizado sin volver a pedir la misma aprobación.
- Conserva perfiles, roles autorizados, relaciones e historial. No modifiques empleados o pacientes reales para pruebas. Usa datos de prueba controlados únicamente cuando la tarea permita escrituras.
- La migración `supabase/recurring_staff_journeys.sql` ya fue aplicada según confirmación del usuario. No la vuelvas a ejecutar. Consulta primero el estado real y las funciones publicadas.
- El registro de personal utiliza la Edge Function `manage-employees`; el código se asigna en el servidor. No generes códigos por conteo del directorio ni adaptes el frontend para omitir las validaciones del backend.
- Una compilación o una prueba local no acredita persistencia remota. Distingue siempre cambios preparados, desplegados y realmente verificados en Supabase.

## Alcance de trabajo

- No realices auditorías generales si el usuario solicita una corrección concreta.
- Conserva la interfaz vino/borgoña y blanco, los horarios AM/PM y los contratos existentes de iOS/Android.
- Ejecuta solo la compilación y las pruebas esenciales pertinentes al cambio. No repitas pruebas aprobadas si no hubo cambios que lo justifiquen.
