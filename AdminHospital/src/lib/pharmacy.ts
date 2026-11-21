import { receptionRpc } from './reception'

export interface PharmacyPatient { id: string; full_name: string; email: string | null; dui: string | null; phone: string | null }
export interface PharmacyItem { medication: string; dose: number; dose_unit: string; frequency_hours: number; route: string; quantity: number; observations: string | null }
export type PrescriptionStatus = 'pendiente' | 'parcial' | 'entregada'
export interface PharmacyPrescription { id: string; code: string; issued_at: string; status: PrescriptionStatus; status_updated_at: string | null; items: PharmacyItem[] }

export const prescriptionStatusLabel: Record<PrescriptionStatus, string> = { pendiente: 'Pendiente', parcial: 'Entrega parcial', entregada: 'Entregada' }

export async function searchPharmacyPatients(query: string) {
  const term = query.trim()
  if (term.length < 2) return []
  return (await receptionRpc<PharmacyPatient[]>('pharmacy_search_patients', { p_query: term })) ?? []
}
export async function readPatientPrescriptions(patientId: string) {
  return (await receptionRpc<PharmacyPrescription[]>('pharmacy_patient_prescriptions', { p_patient: patientId })) ?? []
}
export async function setPrescriptionStatus(id: string, status: 'pendiente' | 'entregada') {
  return receptionRpc<{ id: string; status: PrescriptionStatus; status_updated_at: string | null }>('pharmacy_set_prescription_status', { p_prescription: id, p_status: status })
}
