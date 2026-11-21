# Hospital Móviles Android

Aplicación Android en Kotlin con interfaces XML y ViewBinding.

## Configuración local

1. Abre el proyecto en Android Studio y sincroniza Gradle.
2. Copia `supabase.properties.example` como `supabase.properties`.
3. Configura la URL y la Publishable Key del proyecto Supabase compartido.
4. Ejecuta el módulo `app` e inicia sesión con una cuenta autorizada.

`supabase.properties` y `local.properties` están excluidos de Git. No incluyas claves secretas ni `service_role` en el cliente.

## Compilación

En Windows:

```powershell
.\gradlew.bat :app:assembleDebug
```

Consulta [el módulo de Recepción](docs/recepcion-android.md) para conocer sus contratos y verificaciones.

