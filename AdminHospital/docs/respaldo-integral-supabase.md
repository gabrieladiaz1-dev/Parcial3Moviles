# Comprobar y ensayar el respaldo integral

**Estado: no verificado.** El conector actual no permite listar backups/PITR ni
demostrar una restauración integral. Los respaldos DPAPI locales ya comprobados
cubren el cambio de horarios y el código de empleados, no todo Supabase.
No se creó ni restauró ningún proyecto para esta preparación.

## Obtener evidencia del respaldo

Un propietario autorizado debe abrir Hospital Móviles → Database → Backups,
comprobar un backup completado o un punto PITR recuperable, y registrar su ID,
fecha, retención y estado. No suponer cobertura a partir de ACTIVE_HEALTHY.
Si el plan no ofrece ese respaldo, preparar una exportación lógica cifrada mediante
la guía oficial, con roles, esquema y datos, revisando expresamente Auth y los
objetos personalizados sobre los esquemas administrados. Confirmar las opciones
con `--help` de la versión de CLI instalada antes de ejecutar comandos.
[Backups de Supabase](https://supabase.com/docs/guides/platform/backups).

## Alcance que debe comprobarse

- Base completa: esquema y datos hospitalarios, Auth, roles, grants, RLS, funciones,
  secuencias y triggers; verificar especialmente `auth.users` → perfil/rol paciente.
- Archivos reales de Storage y sus permisos, además de las filas de metadata.
- Código/configuración de Edge Functions, dependencias y una forma segura de
  reprovisionar secretos; configuración de Auth, URLs y Realtime utilizadas.
- Claves de cifrado administradas/Vault si existen y procedimiento válido para
  recuperar datos cifrados. No copiarlas a documentos ni exponerlas por consola.

La copia de base no incluye los archivos de Storage. Una restauración hacia otro
proyecto tampoco reproduce automáticamente todos los servicios y ajustes de la
aplicación. La copia restaurada puede contener usuarios de Auth y datos sanitarios:
debe protegerse y no exponerse al público.
[Alcance de restaurar a otro proyecto](https://supabase.com/docs/guides/platform/clone-project).

## Probar restauración sin reemplazar producción

1. Autorizar expresamente un destino aislado, su acceso y cualquier costo. Elegir
   restauración hacia proyecto nuevo si está disponible; nunca pulsar restauración
   sobre el proyecto productivo para hacer una prueba.
2. Aislar integraciones externas. Las extensiones restauradas pueden iniciar tareas
   o llamadas externas inmediatamente. Si no puede garantizarse el aislamiento,
   preferir un proceso lógico controlado que permita revisar esos objetos antes.
3. Restaurar allí y completar manualmente los servicios que falten. Para exportación
   lógica, revisar el trigger personalizado sobre Auth y el cifrado antes de dar por
   terminada la recuperación; no basta con que se vean tablas en `public`.
4. Comparar conteos y huellas de filas, FK, roles/grants/RLS, funciones y secuencias
   con un manifiesto del mismo punto. Revisar tablas clínicas con un operador
   autorizado, sin imprimir su contenido en logs ni informes.
5. Probar login con una cuenta sintética, acceso admin y denegación a empleados,
   y registro de doctor/recepción en esa copia. Verificar Storage y datos cifrados
   cuando existan. Mantener correos, webhooks y notificaciones en destinos de prueba.
6. Medir tiempo de recuperación (RTO) y antigüedad del último cambio recuperado (RPO).
   Un backup listado sin este ensayo no demuestra restaurabilidad de la aplicación.
7. Guardar evidencia y huellas sin secretos, limitar accesos y aplicar la retención
   y retirada autorizada del entorno de prueba.

No ejecutar esta guía ahora: aún faltan autorización, destino aislado y evidencia
del backup. La restauración lógica tiene pasos específicos para objetos Auth/Storage
personalizados y cifrado; seguirlos de forma controlada, no copiar comandos genéricos
de otra versión del CLI. [Guía oficial de exportación y restauración](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Acta mínima para autorizar

| Dato | Estado actual |
| --- | --- |
| Proyecto fuente y punto recuperable | Proyecto conocido; punto integral no comprobado |
| ID/fecha/retención/estado del backup | Pendiente |
| Alcance: DB/Auth/Storage/funciones/configuración/cifrado | Pendiente de inventario completo |
| Destino aislado y aislamiento externo | No creado ni autorizado |
| Comparación de datos y esquema restaurados | Solo comprobada para la copia parcial local anterior |
| Login y flujos HTTP recuperados | Pendiente |
| RPO/RTO medidos y aceptados | Pendiente |
| Responsable y evidencia de aceptación | Pendiente |

Hasta completar el acta no se confirma un respaldo integral restaurable y no se
recomienda autorizar el cambio productivo.
