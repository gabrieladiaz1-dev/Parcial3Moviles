import { receptionRpc } from './reception'
export interface TransportUnit { id: number; code: string; plate: string | null; status: string; active: boolean; operational_notes: string | null }
export interface TransportCrew { id: string; name: string; employee_code: string; category: string; active: boolean; ambulance_driver_authorized: boolean; busy: boolean }
export interface TransportDispatch {
  id: string; ambulance_id: number; assigned_staff_id: string | null; dispatched_at: string; departed_at: string | null
  arrived_at: string | null; completed_at: string | null; unit_code: string; driver_name: string; completion_notes: string | null
}
export interface TransportRequest {
  id: string; patient_id: string | null; patient_name: string; record_number: string | null; contact_name: string; contact_phone: string
  pickup_location: string; destination: string | null; reason: string; priority: string; status: string; requested_at: string
  requester_name: string; decision_reason: string | null; dispatch: TransportDispatch | null
  history: { event: string; description: string | null; at: string; actor: string }[]
}
export interface TransportData {
  is_admin: boolean; items: TransportRequest[]; total: number; units: TransportUnit[]; crew: TransportCrew[]
  unit_history: { id: number; code: string; old_status: string | null; new_status: string; changed_at: string }[]
}
export const transportStates: Record<string, string> = { pendiente: 'Pendiente', autorizada: 'Autorizada', despachada: 'Asignada / en servicio', finalizada: 'Finalizada', rechazada: 'Rechazada', cancelada: 'Cancelada', salida: 'Salida registrada', llegada: 'Llegada registrada' }
export const unitStates: Record<string, string> = { disponible: 'Disponible', en_servicio: 'En servicio', en_mantenimiento: 'En mantenimiento' }
export const readTransport = (offset = 0, status = '', request: string | null = null) => receptionRpc<TransportData>('panel_transport_data', { p_offset: offset, p_status: status || null, p_request: request })
