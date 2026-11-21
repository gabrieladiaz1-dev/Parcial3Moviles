# Conexión administrativa de Supabase MCP

Configurada y verificada el **18/11/2026**.

- Servidor Codex: `supabase-hospital-moviles`.
- Servidor oficial: `https://mcp.supabase.com/mcp`.
- Proyecto limitado por `project_ref`: `uvebpsbbwofthucghccc`.
- Grupos habilitados: `database`, `debugging`, `development`, `functions`, `docs`.
- Transporte: HTTP MCP; autenticación OAuth gestionada por Codex.
- Configuración persistente guardada mediante `codex mcp add`, sin reemplazar la configuración previa. No había otros servidores MCP registrados.
- No se añadieron tokens, contraseñas, claves administrativas ni `DATABASE_URL` al proyecto. La autorización se completó en el navegador y Codex confirmó `Successfully logged in`.

## Comprobación real

Se usó el app-server de Codex como cliente MCP con una sesión efímera de transporte. No se inició ningún turno de modelo ni se accedió al almacenamiento de credenciales. Estado observado: `connected`, autenticación `oAuth`, sin errores de inventario.

| Capacidad | Resultado |
| --- | --- |
| `get_project_url` | URL confirmada: `https://uvebpsbbwofthucghccc.supabase.co` |
| `list_tables` | Lectura correcta del esquema público |
| `execute_sql` | Consulta exclusiva de metadatos: 52 tablas públicas y RPC de jornadas presentes |
| `list_migrations` | Lectura correcta |
| `list_edge_functions` | Lectura correcta |
| `get_edge_function` | Lectura de `manage-employees` correcta; su código y contraseñas no se imprimieron |
| `query_logs` | Consulta agregada correcta, sin imprimir eventos ni datos personales |
| `deploy_edge_function` | Herramienta habilitada; no se ejecutó ningún despliegue |
| `apply_migration` | Herramienta habilitada; no se ejecutó ninguna migración |

La consulta de metadatos también confirmó rol SQL `postgres` y permiso de creación en el esquema público. No se hizo una escritura para probar ese permiso. Las autorizaciones y confirmaciones de cada despliegue o migración siguen correspondiendo a su tarea específica.

## Reutilización

Las instrucciones permanentes están en `AGENTS.md`. Preferir las herramientas MCP disponibles en la sesión. En sesiones abiertas antes de registrar el servidor puede ser necesario reabrir Codex para que aparezca el nuevo inventario nativo.

El verificador `scripts/Verify-SupabaseMcp.mjs` permite comprobar la misma conexión OAuth aun cuando la sesión actual no haya recargado su inventario de herramientas. Solo permite lecturas previamente definidas, no expone credenciales y no solicita PostgreSQL.

No se modificaron tablas, empleados, pacientes, citas ni registros clínicos durante esta configuración.
