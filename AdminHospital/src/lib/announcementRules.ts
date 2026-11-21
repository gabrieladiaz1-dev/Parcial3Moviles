// Reglas puras de los avisos públicos (sin red). Mismas validaciones que save_announcement en el servidor.
export interface Announcement {
  id: string
  title: string
  content: string
  published_at: string | null
  expires_at: string | null
  is_public: boolean
  author: string | null
}
export interface AnnouncementInput { title: string; content: string; isPublic: boolean; publishedAt: string; expiresAt: string }
export type AnnouncementState = 'Visible' | 'Programado' | 'Vencido' | 'Borrador'

/** Visible = público, ya publicado y sin vencer (lo que ve el paciente en Información general). */
export function announcementState(item: Announcement, now = new Date()): AnnouncementState {
  if (!item.is_public) return 'Borrador'
  if (item.expires_at && new Date(item.expires_at) <= now) return 'Vencido'
  if (item.published_at && new Date(item.published_at) > now) return 'Programado'
  return 'Visible'
}

/** Fecha y hora local (input datetime-local, hora de El Salvador UTC-6) → ISO; vacío → null. */
export function localToIso(value: string): string | null {
  if (!value.trim()) return null
  const date = new Date(`${value}:00-06:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
/** ISO → valor para input datetime-local en hora de El Salvador. */
export function isoToLocal(value: string | null): string {
  if (!value) return ''
  const shifted = new Date(new Date(value).getTime() - 6 * 3600 * 1000)
  return shifted.toISOString().slice(0, 16)
}

export function announcementProblem(input: AnnouncementInput): string | null {
  if (!input.title.trim() || input.title.length > 200) return 'Escribe un título de hasta 200 caracteres.'
  if (!input.content.trim() || input.content.length > 2000) return 'Escribe el contenido del aviso (hasta 2000 caracteres).'
  if (input.publishedAt && !localToIso(input.publishedAt)) return 'Revisa la fecha de publicación.'
  if (input.expiresAt && !localToIso(input.expiresAt)) return 'Revisa la fecha de vencimiento.'
  const start = localToIso(input.publishedAt) ?? new Date().toISOString(), end = localToIso(input.expiresAt)
  if (end && new Date(end) <= new Date(start)) return 'La fecha de vencimiento debe ser posterior a la de publicación.'
  return null
}
