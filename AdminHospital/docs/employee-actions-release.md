# Registro y gestión de empleados — despliegue verificado

Proyecto confirmado por MCP: `uvebpsbbwofthucghccc`.
Función publicada: **manage-employees**, versión Supabase **8**, contrato **employees-2026-11-registration-v4**, estado ACTIVE.

Actualización posterior solicitada por administración: las altas nuevas y las recuperaciones de altas todavía pendientes utilizan la contraseña inicial `Gaby.0522123`. Se reemplazó la generación aleatoria de la versión 7; no se cambian contraseñas de cuentas existentes completadas. Fuente publicada de la versión 8 confirmada mediante MCP y 26 pruebas locales aprobadas. La verificación remota detallada abajo corresponde a la versión 7, antes de este cambio de política.

## Correcciones

El backend previamente publicado (versión 5) exigía `employeeCode` en `create`, mientras el frontend correctamente lo omitía para que se asignara automáticamente. Esa diferencia provocaba HTTP 400 con un mensaje genérico.

El servidor ahora asigna el siguiente código numérico de tres dígitos dentro de una transacción con bloqueo de `staff`. Ignora códigos aportados por el cliente, controla el límite 999 y conserva el código al recuperar un alta pendiente.

Cada alta recibe la contraseña inicial configurada por administración. Se entrega solamente en la respuesta autorizada del alta, con `Cache-Control: no-store`; no aparece en fichas, listados, metadatos ni logs. Las contraseñas de cuentas completadas existentes permanecen intactas. El modal del frontend conserva las credenciales temporalmente en memoria.

La creación mantiene Auth inicialmente bloqueado hasta confirmar perfil, cargo, especialidades y código. Si falla, conserva el mecanismo de recuperación de altas pendientes. El frontend verifica la persistencia mediante ficha antes de confirmar éxito y evita repetir el alta si solo falló la lectura de confirmación.

La prueba remota también detectó doble codificación JSON de los roles guardados para reactivación. Se corrigió utilizando `tx.json` con arrays reales. Desactivar bloquea Auth y revoca roles laborales; reactivar restaura únicamente los permisos previamente autorizados, sin insertar roles duplicados. Se conservan las protecciones de administradores, cuenta propia y bloqueos independientes.

## Verificación real

Con un administrador temporal y dos empleados temporales creados exclusivamente para esta prueba:

- Doctor y recepcionista: creación sin código ni contraseña enviados por el frontend, con códigos consecutivos `005` y `006` y contraseñas diferentes.
- Inicio de sesión real mediante Supabase Auth.
- Ficha y edición: lectura posterior confirma teléfono modificado, perfil y código conservados.
- Desactivación: nuevo inicio de sesión rechazado; sesión anterior pierde acceso a la RPC laboral y sus roles activos.
- Reactivación: inicio de sesión restaurado con la misma contraseña y exactamente el rol correspondiente.
- Limpieza confirmada: cero cuentas temporales restantes, incluyendo el administrador temporal. Solo se retiraron identidades creadas por la prueba, identificadas por correos exactos y marcadores únicos; no existían pacientes ni citas asociados.

Compilación frontend aprobada. Las 26 pruebas locales esenciales de creación, persistencia y gestión pasaron, incluyendo protección de administradores y conservación de bloqueos ajenos.

Se desplegó únicamente la Edge Function por MCP. No se publicaron cambios de hosting del frontend ni se ejecutaron migraciones ni cambios de RLS. No se modificaron cuentas reales, expedientes, citas ni registros clínicos.

## Herramientas de mantenimiento

- `scripts/lib/supabaseMcp.mjs`: transporte MCP OAuth existente; valida el proyecto antes de actuar, sin extraer tokens.
- `scripts/Inspect-EmployeeService.mjs`: inspección del contrato desplegado.
- `scripts/Deploy-EmployeeRegistration.mjs`: respaldo de código y despliegue exclusivo de la función con sus dependencias locales y mapa de importaciones propio.
- `scripts/Test-EmployeeRegistrationLive.mjs`: prueba remota autorizada con credenciales exclusivamente en memoria y limpieza acotada. Requiere autorización explícita para futuras ejecuciones con escrituras.
