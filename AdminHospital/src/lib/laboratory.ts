import { receptionRpc } from './reception'

export interface LaboratoryAccess { can_view: boolean; can_manage: boolean; can_process: boolean; can_validate: boolean; can_publish: boolean }
export interface LabParameter { key: string; label: string; type: 'number' | 'qualitative' | 'text'; required: boolean; unit?: string; reference?: string; low?: string | number | null; high?: string | number | null; range_scope?: string; choices?: string[] }
export type LabValues = Record<string, { value: string; observation?: string }>
export interface LabTest { id: number; name: string; description: string | null; active: boolean; result_schema: LabParameter[]; schema_validated_at: string | null; version: string }
export interface LabStaff { id: string; name: string; active: boolean; employee_code: string; category: string; can_process: boolean; can_validate: boolean; can_publish: boolean; laboratory_active: boolean }
export interface LabOrderItem {
  id: string; order_code: string; encounter_id: string; test_type_id: number; test_name: string; status: string; ordered_at: string
  patient_name: string; record_code: string; doctor_name: string; workflow_stage: string | null; version: number | null
  published_at: string | null; published_to_patient_at: string | null; published_revision: number | null
}
export interface LabDraft { draft_summary?: string; draft_values?: LabValues; draft_schema?: LabParameter[]; workflow_stage: string | null; version: number | null; draft_validated_at: string | null; correction_reason?: string | null }
export interface LabPublished { summary?: string; result_values?: LabValues; parameter_schema?: LabParameter[]; published_at: string | null; validated_at: string | null; published_to_patient_at: string | null; published_revision: number }
export interface LabDetail extends LabOrderItem {
  patient_first_name: string | null; patient_last_name: string | null; patient_dui: string | null; patient_email: string | null; patient_phone: string | null; draft_validator_name: string | null
  reason: string; weight_kg: number | null; height_cm: number | null; encounter_started_at: string
  draft: LabDraft | null; result: LabPublished | null; access: LaboratoryAccess; validator_name: string | null; publisher_name: string | null
  consultation_orders: { id: string; order_code: string; test_name: string; status: string }[]
  history: { action: string; at: string; actor: string; stage: string | null; status: string | null; revision: string | null; reason: string | null; summary: string | null }[]
}
export interface LabPanel { access: LaboratoryAccess; items: LabOrderItem[]; total: number; has_more: boolean; counts: Record<string, number>; tests: LabTest[]; doctors: { id: string; name: string }[]; staff: LabStaff[] }
export interface LabFilters { offset: number; status: string; query: string; from: string; until: string; test: string; doctor: string }
export const labStates: Record<string, string> = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completada' }
export const labStages: Record<string, string> = { draft: 'Borrador', review: 'Pendiente de validación', validated: 'Validada · pendiente de publicar', published: 'Publicada' }
export const readLaboratoryAccess = () => receptionRpc<LaboratoryAccess>('my_laboratory_access', {})
export const readLaboratoryPanel = (f: LabFilters) => receptionRpc<LabPanel>('laboratory_panel', { p_offset: f.offset, p_status: f.status || null, p_query: f.query.trim(), p_from: f.from || null, p_until: f.until || null, p_test: f.test ? Number(f.test) : null, p_doctor: f.doctor || null })
export const readLaboratoryOrder = (id: string) => receptionRpc<LabDetail>('laboratory_order_detail', { p_order: id })

export interface LabDeskPatient { id: string; full_name: string; email: string | null; dui: string | null; phone: string | null }
export interface LabDeskOrder {
  id: string; order_code: string; test_name: string; status: 'pendiente' | 'en_proceso' | 'completado'; ordered_at: string; reason: string | null
  version: number | null; workflow_stage: string | null; draft_summary: string | null; draft_values: LabValues; has_required_parameters: boolean
  published_summary: string | null; published_at: string | null; published_to_patient_at: string | null
}
export async function searchLaboratoryPatients(query: string) {
  const term = query.trim()
  if (term.length < 2) return []
  return (await receptionRpc<LabDeskPatient[]>('laboratory_search_patients', { p_query: term })) ?? []
}
export const readLaboratoryPatientOrders = async (patientId: string) => (await receptionRpc<LabDeskOrder[]>('laboratory_patient_orders', { p_patient: patientId })) ?? []
export const startLaboratoryOrder = (orderId: string) => receptionRpc('start_laboratory_order', { p_order: orderId })
/** Guarda, valida y publica al portal del paciente en una sola transacción del servidor. */
export const sendLaboratoryResults = (order: LabDeskOrder, summary: string) =>
  receptionRpc('complete_laboratory_exam', { p_order: order.id, p_version: order.version, p_summary: summary.trim(), p_values: order.draft_values ?? {}, p_to_patient: true })
