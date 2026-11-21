# Parcial3Moviles — Hospital Universitario

Sistema Integral de Gestión Hospitalaria del Hospital Universitario (Universidad Católica de El Salvador, 2026).
Tres clientes comparten un mismo backend en Supabase (**Hospital Móviles**, PostgreSQL con Row Level Security).

| Carpeta | Plataforma | Tecnología | Usuarios |
|---|---|---|---|
| [`AdminHospital/`](AdminHospital/) | Web administrativa | React 19, TypeScript, Vite, Tailwind, supabase-js | Administración, recepción, laboratorio |
| [`Hospital-Universitario/`](Hospital-Universitario/) | iOS | SwiftUI, MVVM, async/await, supabase-swift 2.28 | Paciente y médico |
| [`Android/`](Android/) | Android | Kotlin, XML + ViewBinding, MVVM, corrutinas | Recepción |
| [`docs/`](docs/) | Documentación | PDF | Documento de arquitectura y manual de usuario |

- **Prototipo en Figma:** https://www.figma.com/design/bGo6nI4CD4KoNdtDn0mO4v/Hospital-Universitario?node-id=0-1&p=f&t=xMWsSjUmI654fmxY-0
- **Documento de arquitectura:** [`docs/Documento_Arquitectura_Hospital_Universitario.pdf`](docs/Documento_Arquitectura_Hospital_Universitario.pdf)
- **Manual de usuario:** [`docs/Manual_Usuario_Hospital_Universitario.pdf`](docs/Manual_Usuario_Hospital_Universitario.pdf)

## Arquitectura

```
App iOS (SwiftUI) ─┐
App Android (Kotlin)├─ HTTPS + JWT ─▶ Supabase Auth · PostgREST (REST / RPC) · Realtime · Edge Functions ─▶ PostgreSQL (RLS)
Web (React) ───────┘
```

Los clientes solo usan la **URL del proyecto** y la **clave publicable**. Los permisos se aplican en el servidor con políticas RLS y funciones RPC.

## Requisitos

| Plataforma | Requisitos |
|---|---|
| Web | Node.js 22 o posterior y npm |
| iOS | macOS con Xcode 16.2 o posterior y simulador iOS 18.2 o posterior |
| Android | Android Studio (JDK incluido), Android SDK 37, dispositivo o emulador con Android 8.0 (API 26) o superior |

## Variables de entorno

Usa siempre la clave **publicable** (`sb_publishable_…`) del proyecto Hospital Móviles. Nunca incluyas la clave de servicio ni claves secretas en los clientes. Los archivos con claves locales están excluidos del repositorio.

| Plataforma | Archivo | Variables |
|---|---|---|
| Web | `AdminHospital/.env.local` (copiar de `.env.example`) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_STAFF_PLANNING_ENABLED` |
| iOS | `Hospital-Universitario/HospitalUniversitario/Configuration/Supabase.xcconfig` | URL del proyecto y clave publicable |
| Android | `Android/supabase.properties` (copiar de `supabase.properties.example`) | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |

Valor de la URL: `https://uvebpsbbwofthucghccc.supabase.co`

## Ejecución

### 1. Plataforma web administrativa

```bash
cd AdminHospital
npm install
cp .env.example .env.local   # completa la clave publicable
npm run dev                  # abre la dirección que indica Vite
npm run build                # compilación de producción en dist/
```

### 2. Aplicación iOS

1. Abre `Hospital-Universitario/HospitalUniversitario/HospitalUniversitario.xcodeproj` en Xcode.
2. Espera a que se resuelva el paquete `supabase-swift` (2.28.0).
3. Selecciona el esquema **HospitalUniversitario** y un simulador con iOS 18.2 o posterior.
4. Ejecuta con **⌘R**; las pruebas con **⌘U**.

Vista previa web sin Mac (requiere Node.js 22):

```bash
cd Hospital-Universitario
node --preserve-symlinks --preserve-symlinks-main web-preview/server.mjs   # http://127.0.0.1:4173
```

### 3. Aplicación Android

1. Abre la carpeta `Android/` en Android Studio y sincroniza Gradle.
2. Copia `supabase.properties.example` como `supabase.properties` y completa la clave publicable.
3. Ejecuta el módulo `app` en un emulador o dispositivo.

Desde la terminal (Windows):

```bash
cd Android
gradlew.bat :app:assembleDebug
```

## Backend

El backend es el proyecto de Supabase **Hospital Móviles**. Las carpetas `AdminHospital/supabase/` y `Hospital-Universitario/supabase/` contienen los scripts SQL de tablas, políticas y funciones. La Edge Function `manage-employees` se despliega con la CLI de Supabase:

```bash
supabase functions deploy manage-employees
```

## Integrantes

- Víctor Rafael Arévalo Sierra
- Gabriela Abigail Díaz Rivera
- Diego Marcelo Rivera López
- Víctor Manuel Mira Hernández
- Luis José Rodríguez Centeno
- Miguel Alejandro Reyes Amaya
