import { userMessage } from './userError'
import { receptionRpc } from './reception'
export { institutionMapUrl } from './institutionMap'

export interface PanelProfile {
  id: string; first_name: string; last_name: string; phone: string | null; city: string | null; birth_date: string | null
  email: string; roles: string[]; version: string; account_created_at: string; last_sign_in_at: string | null
}
export interface Institution {
  name: string; about: string | null; affiliation: string | null; email: string | null; phone: string | null
  address: string | null; latitude: number | null; longitude: number | null; version: string
}
export interface PanelPreferences { attention: boolean; admissions: boolean; ambulance: boolean; laboratory: boolean; poll_seconds: number }
export interface PanelNotification { id: string; title: string; body: string; kind: string; read_at: string | null; created_at: string; entity_type: string | null; entity_id: string | null }
export interface PanelNotifications { items: PanelNotification[]; unread: number; has_more: boolean }
export const panelRoleName = (role: string) => ({ admin: 'Administrador', recepcionista: 'Recepcionista', doctor: 'Doctor', enfermera: 'Enfermería', paciente: 'Paciente' })[role] ?? 'Personal autorizado'
export const readPanelProfile = () => receptionRpc<PanelProfile>('my_panel_profile', {})
export const readInstitution = () => receptionRpc<Institution | null>('panel_institution', {})
export const readPreferences = () => receptionRpc<PanelPreferences>('my_panel_preferences', {})
export const readNotifications = (offset = 0) => receptionRpc<PanelNotifications>('my_panel_notifications', { p_offset: offset })
export const markNotificationRead = (id: string | null = null) => receptionRpc('read_panel_notification', { p_id: id })
export const panelError = (e: unknown) => userMessage(e)
