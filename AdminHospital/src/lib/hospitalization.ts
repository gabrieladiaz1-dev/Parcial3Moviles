import { receptionRpc } from './reception'

export interface HospitalRoom { id: string; code: string; floor_id: number; kind: string; active: boolean }
export interface HospitalBed {
  id: string; room_id: string; code: string; state: string; active: boolean; operational_reason: string | null
  assignment: { admission_id: string; patient_name: string; assigned_at: string } | null
}
export interface HospitalInventory {
  is_admin: boolean; categories: string[]; floors: { id: number; name: string }[]
  rooms: HospitalRoom[]; beds: HospitalBed[]
}
export interface AdmissionItem {
  id: string; patient_id: string; patient_name: string; record_number: string | null; doctor_name: string
  category: string; reason: string; observations: string | null; priority: string; status: string
  ordered_at: string; reviewed_at: string | null; medically_discharged_at: string | null; closed_at: string | null
  decision: string | null; decision_reason: string | null
  assignment: { room: string; bed: string; floor: string; assigned_at: string; released_at: string | null } | null
}
export interface AdmissionPage { items: AdmissionItem[]; total: number; has_more: boolean; next_offset: number | null }
export interface AdmissionDetail {
  id: string; patient_id: string; patient_name: string; record_number: string | null; doctor_name: string
  requested_kind: string; medical_reason: string; clinical_instructions: string | null
  priority: string; status: string; ordered_at: string; reviewed_at: string | null
  medically_discharged_at: string | null; discharged_by_name: string | null; discharge_notes: string | null
  closed_at: string | null; closed_by_name: string | null; decision_reason: string | null; decision: string | null
  assignments: { room: string; bed: string; category: string; assigned_at: string; released_at: string | null }[]
  history: { action: string; status: string; label: string | null; reason: string | null; at: string; actor: string }[]
}
export interface AvailableBed { bed_id: string; bed: string; room_id: string; room: string; category: string; floor: string }
export const hospitalKinds: Record<string, string> = { vip: 'VIP', semiprivada: 'Semiprivada' }
export const bedStates: Record<string, string> = { disponible: 'Disponible', ocupada: 'Ocupada', limpieza: 'Pendiente de limpieza', mantenimiento: 'En mantenimiento', fuera_servicio: 'Fuera de servicio' }
export const admissionStates: Record<string, string> = { solicitado: 'Pendiente', asignado: 'Cama asignada', hospitalizado: 'Hospitalizado', alta_medica: 'Alta médica · salida pendiente', cerrado: 'Salida registrada', cancelado: 'Solicitud cerrada' }
export const bedDisplayState = (bed: HospitalBed, room?: HospitalRoom) => !bed.active || room?.active === false ? 'fuera_servicio' : bed.state
export const readHospitalInventory = () => receptionRpc<HospitalInventory>('reception_hospital_inventory', {})
export const readAdmissions = (offset: number, status: string) => receptionRpc<AdmissionPage>('reception_admissions', { p_offset: offset, p_status: status })
export const readAdmissionDetail = (id: string) => receptionRpc<AdmissionDetail>('reception_hospital_detail', { p_admission: id })
export const readAdmissionBeds = (id: string) => receptionRpc<{ beds: AvailableBed[]; checked_at: string }>('reception_admission_availability', { p_admission: id })
