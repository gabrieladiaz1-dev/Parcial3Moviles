import { supabase } from './supabase'
import { atMidnight, addDays } from './planningDates'
import { invokePlanningRpc } from './planningRpc'
import { confirmRecurringScope, confirmRecurringWrite } from './planningPersistence'

// Release control only; database roles and RLS remain the authorization boundary.
export const planningWritesEnabled = import.meta.env.VITE_STAFF_PLANNING_ENABLED === 'true'

export interface PlanningStaff { id: string; profile_id: string | null; employee_code: string; category: string; active: boolean; first_name: string | null; last_name: string | null; roles: string[]; specialties?: string[] }
export interface ConsultingRoom { id: string; code: string; floor_id: number | null; active: boolean; version: string }
export interface Floor { id: number; name: string }
export interface PlanningPeriod { id: string; starts_at: string; ends_at: string; version: string; recurring_id?: string }
export interface WorkShift extends PlanningPeriod { staff_id: string; shift_type: string; status: string }
export interface StaffAbsence extends PlanningPeriod { staff_id: string; reason: string | null; active: boolean }
export interface Consultation extends PlanningPeriod { doctor_id: string; consulting_room_id: string; active: boolean; slot_minutes: number }
export interface RecurringJourney { id: string; staff_id: string; staff_role: 'doctor' | 'recepcionista'; weekdays: number[]; start_time: string; end_time: string; shift_type: string; breaks: { start_time: string; end_time: string; reason: string }[]; consultations: { start_time: string; end_time: string; slot_minutes: number }[]; consulting_room_id: string | null; specialty_id: number | null; specialty_ids?: number[]; valid_from: string; valid_until: string | null; closed_on: string | null; active: boolean; version: string }
export interface PlanningData { ready: boolean; staff: PlanningStaff[]; rooms: ConsultingRoom[]; floors: Floor[]; shifts: WorkShift[]; absences: StaffAbsence[]; consultations: Consultation[]; saved_shifts?: WorkShift[]; saved_consultations?: Consultation[]; saved_absences?: StaffAbsence[]; recurring_ready?: boolean; recurring_journeys?: RecurringJourney[]; doctor_specialties?: { doctor_id: string; specialty_id: number; name: string }[] }
export interface AvailabilitySlot { doctor_id: string; doctor_name: string; consulting_room_id: string; room_code: string; starts_at: string; ends_at: string; slot_minutes: number }
export type PlanningKind = 'shift' | 'absence' | 'consultation' | 'room'
export const staffName = (staff: PlanningStaff) => `${staff.first_name ?? ''} ${staff.last_name ?? ''}`.trim() || staff.employee_code
export const categoryName = (category: string) => ({ doctor: 'Doctor', recepcionista: 'Recepcionista', enfermera: 'Enfermería' })[category] ?? category

function connection() { if (!supabase) throw new Error('El sistema no está configurado correctamente. Contacta al administrador.'); return supabase }
export async function readPlanning(week: string): Promise<PlanningData> {
  const data = await invokePlanningRpc<PlanningData>(connection(), 'read_staff_planning', { p_from: atMidnight(week), p_until: atMidnight(addDays(week, 7)) })
  if (!data || !Array.isArray(data.staff) || !Array.isArray(data.shifts) || !Array.isArray(data.absences) || !Array.isArray(data.consultations) || !Array.isArray(data.rooms)) throw Object.assign(new Error('No se pudo cargar la programación completa. Actualiza e intenta nuevamente.'), { code: 'READ_CONTRACT' })
  return data
}
export async function searchPlanningStaff(query: string, role: 'doctor' | 'recepcionista'): Promise<PlanningStaff[]> {
  const staff = await invokePlanningRpc<PlanningStaff[]>(connection(), 'search_planning_staff', { p_query: query, p_role: role, p_limit: 40 })
  if (!Array.isArray(staff) || staff.some(person => !person.id || !Array.isArray(person.roles) || !Array.isArray(person.specialties))) {
    throw Object.assign(new Error('No se pudo buscar el personal. Intenta nuevamente.'), { code: 'READ_CONTRACT' })
  }
  return staff
}
export async function readStaffSchedule(week: string, staffId: string): Promise<PlanningData> {
  const data = await invokePlanningRpc<PlanningData>(connection(), 'read_staff_schedule', { p_from: atMidnight(week), p_until: atMidnight(addDays(week, 7)), p_staff: staffId })
  if (!data || data.staff?.length !== 1 || data.staff[0].id !== staffId || !Array.isArray(data.shifts) || !Array.isArray(data.absences) || !Array.isArray(data.consultations) || !Array.isArray(data.rooms)) {
    throw Object.assign(new Error('No se pudo cargar el horario solicitado. Intenta nuevamente.'), { code: 'READ_CONTRACT' })
  }
  return data
}
export async function savePlanning(kind: PlanningKind, values: Record<string, unknown>, id?: string, version?: string): Promise<void> {
  if (!planningWritesEnabled) throw new Error('La configuración de horarios todavía no está habilitada.')
  await invokePlanningRpc(connection(), 'save_staff_planning', { p_kind: kind, p_values: values, p_id: id ?? null, p_version: version ?? null })
}
export async function readAvailability(week: string, doctor?: string, room?: string): Promise<AvailabilitySlot[]> {
  return invokePlanningRpc<AvailabilitySlot[]>(connection(), 'get_medical_availability', { p_from: atMidnight(week), p_until: atMidnight(addDays(week, 7)), p_doctor: doctor || null, p_room: room || null })
}

export async function savePlanningSet(role: 'doctor' | 'recepcionista', kind: string, values: Record<string, unknown>, originals: Array<{kind: string; id: string; version: string}>): Promise<number> {
  if (!planningWritesEnabled) throw new Error('La configuración de horarios todavía no está habilitada.')
  const data = await invokePlanningRpc<{ count: number }>(connection(), 'save_staff_planning_set', { p_role: role, p_kind: kind, p_values: values, p_originals: originals })
  return data.count
}
export async function deleteConsultingRoom(room: ConsultingRoom): Promise<void> {
  await invokePlanningRpc(connection(), 'delete_staff_consulting_room', { p_id: room.id, p_version: room.version })
}
export interface JourneyEditScope { weekday: number | null; originals: RecurringJourney[]; date?: string }
export async function saveRecurringJourney(values: Record<string, unknown>, key: string, journey?: RecurringJourney, scope?: JourneyEditScope) {
  if (!planningWritesEnabled) throw new Error('La configuración de horarios todavía no está habilitada.')
  if (journey && scope?.date) {
    const data = await invokePlanningRpc<{ id: string }>(connection(), 'save_recurring_journey_day', { p_values: values, p_id: journey.id, p_version: journey.version, p_key: key })
    if (!data?.id) throw new Error('No se confirmó la operación. Reintenta con los mismos datos.')
    await confirmRecurringWrite({ read: readPlanning, availability: readAvailability }, values, data.id, journey)
    return data
  }
  const scoped = Boolean(journey && scope)
  const params = { p_values: values, p_id: journey?.id ?? null, p_version: journey?.version ?? null, p_key: key }
  const scopedParams = { ...params, p_weekday: scope?.weekday ?? null, p_originals: scope?.weekday === null ? scope.originals.filter(j => j.active && !j.closed_on && (!j.valid_until || j.valid_until >= String(values.valid_from))).map(j => ({ id: j.id, version: j.version })) : [] }
  if (scoped) await invokePlanningRpc(connection(), 'save_recurring_journey_scope', { ...scopedParams, p_preview: true })
  const data = await invokePlanningRpc<{ id: string }>(connection(), scoped ? 'save_recurring_journey_scope' : 'save_recurring_journey', scoped ? { ...scopedParams, p_preview: false } : params)
  if (!data?.id) throw Object.assign(new Error('No se pudo confirmar el guardado. Reintenta la misma operación.'), { code: 'SAVE_UNCONFIRMED' })
  await confirmRecurringWrite({ read: readPlanning, availability: readAvailability }, values, data.id, journey)
  if (scoped && scope && journey) await confirmRecurringScope(readPlanning, values, journey, scope)
  return data
}
