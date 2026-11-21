// Traduce cualquier error a un mensaje apto para la interfaz.
// Solo se muestran los mensajes de negocio redactados para el usuario (validaciones en español
// del backend o del frontend). Todo lo técnico (códigos, SQL, nombres de funciones, HTTP, red)
// se sustituye por un mensaje personalizado. El detalle técnico queda solo en la consola.

type Failure = { code?: unknown; message?: unknown; status?: unknown; name?: unknown }

const DEFAULT = 'No se pudo completar la operación. Intenta nuevamente.'

const BY_CODE: Record<string, string> = {
  AUTH_SESSION_MISSING: 'Tu sesión venció. Inicia sesión nuevamente.',
  NETWORK_ERROR: 'No hay conexión con el servidor. Comprueba tu conexión e intenta nuevamente.',
  SAVE_UNCONFIRMED: 'No se pudo confirmar el guardado. Actualiza los datos y comprueba si el cambio quedó registrado antes de reintentar.',
  PGRST301: 'Tu sesión venció. Inicia sesión nuevamente.',
  PGRST302: 'Tu sesión venció. Inicia sesión nuevamente.',
  PGRST303: 'Tu sesión venció. Inicia sesión nuevamente.',
  PGRST202: 'Esta función no está disponible en este momento. Contacta al administrador del sistema.',
  PGRST203: 'Esta función no está disponible en este momento. Contacta al administrador del sistema.',
  '42883': 'Esta función no está disponible en este momento. Contacta al administrador del sistema.',
  '42P01': 'Esta función no está disponible en este momento. Contacta al administrador del sistema.',
  '42703': 'Esta función no está disponible en este momento. Contacta al administrador del sistema.',
  PGRST116: 'No se encontró el registro solicitado. Actualiza e intenta nuevamente.',
  '23P01': 'Ese horario o recurso acaba de ocuparse. Actualiza y elige otra opción.',
  '23505': 'Este registro ya existe. Actualiza los datos antes de continuar.',
  '23503': 'El registro está relacionado con otros datos y no se puede completar la operación.',
  '23502': 'Faltan datos obligatorios. Revisa el formulario.',
  '23514': 'Algún dato no es válido. Revisa el formulario.',
  '22P02': 'Algún dato no tiene el formato correcto. Revisa el formulario.',
  '22007': 'Alguna fecha u hora no es válida. Revisa el formulario.',
  '22008': 'Alguna fecha u hora no es válida. Revisa el formulario.',
  '40001': 'Los datos cambiaron mientras trabajabas. Actualiza e intenta nuevamente.',
  '40P01': 'El servidor está ocupado. Intenta nuevamente en unos segundos.',
  '57014': 'La operación tardó demasiado. Intenta nuevamente.',
  '42501': 'Tu cuenta no tiene autorización para esta operación.',
  HTTP_401: 'Tu sesión venció. Inicia sesión nuevamente.',
  HTTP_403: 'Tu cuenta no tiene autorización para esta operación.',
  HTTP_404: 'Esta función no está disponible en este momento. Contacta al administrador del sistema.',
  HTTP_429: 'Demasiados intentos. Espera un momento e intenta nuevamente.',
}

// Errores de Supabase Auth (en inglés) con su versión para el usuario.
const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/email not confirmed/i, 'Debes confirmar tu correo antes de iniciar sesión.'],
  [/user (not found|banned)/i, 'La cuenta no está disponible. Contacta al administrador.'],
  [/rate limit|too many requests|security purposes/i, 'Demasiados intentos. Espera un momento e intenta nuevamente.'],
  [/refresh.?token|jwt|session (missing|expired|not found)|auth session/i, 'Tu sesión venció. Inicia sesión nuevamente.'],
  [/failed to fetch|networkerror|network request failed|load failed|err_network|econn|enotfound|timeout|timed out|aborted/i, 'No hay conexión con el servidor. Comprueba tu conexión e intenta nuevamente.'],
]

// Señales de un mensaje técnico que nunca debe llegar a la interfaz.
const TECHNICAL = new RegExp([
  'supabase', 'postgres', 'postgrest', 'pgrst', '\\bsql\\b', '\\brpc\\b', '\\brls\\b', '\\bjwt\\b', '\\bapi\\b', '\\bhttp', 'edge function',
  'manage-employees', 'schema', 'relation', 'column', 'constraint', 'violates', 'duplicate key', 'syntax', 'policy', 'permission denied',
  'function', 'operator', 'null value', 'invalid input', 'out of range', 'does not exist', 'is not', 'cannot', 'could not', 'unexpected',
  'undefined', 'typeerror', 'referenceerror', 'json', 'token', 'stack', 'exception', 'error:', '\\bat \\w', '\\[.*\\]',
  '\\b[a-z]+_[a-z0-9_]+\\b', '\\b[a-z]+\\.[a-z_]+\\(', '\\b(the|of|and|for|with|from|to|in|on|not|failed|invalid)\\b',
].join('|'), 'i')

// Texto en inglés (mensajes de librerías, guardas de migración): nunca se muestra tal cual.
const ENGLISH = /\b(fail|inspect|review|already|changed|expected|found|first|before|after|applying|installed|missing|denied|error|exists?|refresh|repeat|audit|preview|rollback|baseline|granted|allowed|exposes|accepted|promoted|returned|request|response|server|value|type|unknown|internal|bad)\b/i
const looksSpanish = (text: string) => !ENGLISH.test(text)

function parts(error: unknown) {
  if (typeof error === 'string') return { message: error, code: '', status: 0 }
  if (!error || typeof error !== 'object') return { message: '', code: '', status: 0 }
  const f = error as Failure
  return {
    message: typeof f.message === 'string' ? f.message : '',
    code: typeof f.code === 'string' ? f.code : typeof f.code === 'number' ? String(f.code) : '',
    status: typeof f.status === 'number' ? f.status : 0,
  }
}

/** ¿El texto está redactado para el usuario y no contiene detalles técnicos? */
export function isUserFacing(text: string) {
  const clean = text.trim()
  return clean.length > 3 && clean.length <= 400 && looksSpanish(clean) && !TECHNICAL.test(clean)
}

/** Mensaje seguro para mostrar en la interfaz. */
export function userMessage(error: unknown, fallback = DEFAULT): string {
  const { message, code, status } = parts(error)
  if (message && isUserFacing(message)) return message.trim()
  if (message || code) console.warn('[error técnico ocultado]', error)
  for (const [pattern, text] of AUTH_MESSAGES) if (pattern.test(message)) return text
  if (code && BY_CODE[code]) return BY_CODE[code]
  if (status && BY_CODE[`HTTP_${status}`]) return BY_CODE[`HTTP_${status}`]
  if (error instanceof TypeError) return BY_CODE.NETWORK_ERROR
  return fallback
}
