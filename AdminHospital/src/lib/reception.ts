import { supabase } from './supabase'
import { availablePatientSlots } from './receptionBooking'
import { orderAttentionRequests, type RequestOrder } from './receptionOrdering'
import { mapPatientRecord } from './receptionPatientRecords'
import { patientExactFilter, patientMatch, patientPrimaryFilter, patientSearchFilter, patientSearchIntent, patientTextPattern, rankPatientMatches, searchText } from './patientSearch'

export interface AttentionRequest {
  id: string; requester_id: string | null; patient_id: string | null; specialty_id: number
  preferred_period: string; reason: string; other_symptoms: string | null
  status: string; created_at: string; closure_reason: string | null
  applicant_data: Record<string, string | null>
}
export interface ReceptionPatient {
  id: string; profile_id: string | null; first_name: string; last_name: string
  email?: string | null; city?: string | null; patient_code: string; dui: string | null; birth_date: string | null; phone: string | null
  registration_source?: string; created_at?: string
}
export interface Slot {
  doctor_id: string; doctor_name: string; consulting_room_id: string; room_code: string
  starts_at: string; ends_at: string; slot_minutes: number
}
export interface ReceptionAppointment {
  id: string; request_id: string | null; patient_id: string; starts_at: string; ends_at: string; status: string
  consulting_room_id: string; doctor_id: string
  patient_name?: string; doctor_name?: string; room_code?: string
}
export interface DoctorDay {
  shifts: { starts_at: string; ends_at: string }[]
  consultations: { starts_at: string; ends_at: string; room_code: string; slot_minutes: number }[]
}
export interface ReceptionDoctor extends DoctorDay {
  id: string; name: string; specialty: string
  breaks: { starts_at: string; ends_at: string; label?: string }[]
}
function client() { if (!supabase) throw new Error('El sistema no está configurado correctamente. Contacta al administrador.'); return supabase }
function rpcError(error: { code?: string; message: string }) {
  if (error.code === '23P01') return new Error('Este horario acaba de ocuparse. Consulta nuevamente las horas disponibles.')
  if (error.code === '23505') return new Error('Este registro ya existe. Actualiza la solicitud antes de continuar.')
  if (error.code === '42501') return new Error('Tu cuenta no tiene autorización para esta operación. Verifica que tu rol siga activo.')
  return new Error(error.message)
}
export async function receptionRpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client().rpc(name, args)
  if (error) throw Object.assign(rpcError(error), { code: error.code, hint: error.hint })
  return data as T
}
export async function receptionRows<T>(table: string, columns: string): Promise<T[]> {
  const { data, error } = await client().from(table).select(columns)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as T[]
}
export async function loadRequests(filter = '', offset = 0, order: RequestOrder = 'oldest') {
  const statuses = filter ? [filter] : ['pendiente', 'en_revision']
  const results = await Promise.all(statuses.map(status => client().from('appointment_requests').select('*').eq('status', status).order('created_at', { ascending: order === 'oldest' }).order('id', { ascending: true }).range(offset, offset + 99)))
  for (const result of results) if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code })
  return { items: orderAttentionRequests(results.flatMap(r => r.data ?? []) as AttentionRequest[], order), hasMore: results.some(r => r.data?.length === 100) }
}
export async function readAttentionCounts() {
  const states = ['pendiente', 'en_revision', 'agendada', 'rechazada', 'cancelada']
  const results = await Promise.allSettled(states.map(status => client().from('appointment_requests').select('id', { count: 'exact', head: true }).eq('status', status)))
  return Object.fromEntries(results.map((r, i) => [states[i], r.status === 'fulfilled' && !r.value.error ? r.value.count : null])) as Record<string, number | null>
}
export async function searchPatients(dui: string) {
  if (!/^\d{8}-\d$/.test(dui)) throw new Error('Escribe el DUI completo: 00000000-0.')
  const { data, error } = await client().from('patients').select('id,profile_id,first_name,last_name,patient_code,dui,birth_date,phone,email,city').eq('dui', dui).limit(10)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as ReceptionPatient[]
}

export interface ReceptionPatientMatch extends ReceptionPatient {
  record_code: string | null
  record_id: string | null
}
const patientSearchColumns = 'id,profile_id,first_name,last_name,patient_code,dui,birth_date,phone,email,city,registration_source,created_at,medical_records(id,record_code)'

export async function searchPatientsWithRecordCodes(dui: string): Promise<ReceptionPatientMatch[]> {
  if (!/^\d{8}-\d$/.test(dui)) throw new Error('Escribe el DUI completo: 00000000-0.')
  const { data, error } = await client().from('patients').select(patientSearchColumns).eq('dui', dui).limit(10)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return (data ?? []).map(row => mapPatientRecord(row) as ReceptionPatientMatch)
}

export async function readWalkinRegistration(id: string): Promise<ReceptionPatientMatch> {
  const { data, error } = await client().from('patients').select(patientSearchColumns).eq('id',id).single()
  if(error || !data) throw new Error('No se pudo confirmar el paciente guardado. Búscalo antes de volver a registrar.')
  const embedded=data.medical_records
  const records=Array.isArray(embedded)?embedded:embedded?[embedded]:[]
  if(records.length!==1 || !records[0]?.record_code) throw new Error('No se confirmó un expediente único para este paciente. Solicita revisión; no crees otra persona.')
  return {...data,record_id:records[0].id,record_code:records[0].record_code} as ReceptionPatientMatch
}

export async function searchReceptionPatients(value: string, signal?: AbortSignal): Promise<{ patients: ReceptionPatientMatch[]; hasMore: boolean }> {
  const term = searchText(value)
  if (term.length < 2) return { patients: [], hasMore: false }
  let people = client().from('patients').select(patientSearchColumns).or(patientSearchFilter(term)).order('last_name').order('first_name').order('id').limit(21)
  let records = client().from('medical_records').select('patient_id').regexIMatch('record_code', patientTextPattern(term)).order('record_code').limit(21)
  let exact = client().from('patients').select(patientSearchColumns).or(patientExactFilter(term)).order('last_name').order('first_name').order('id').limit(21)
  let primary = client().from('patients').select(patientSearchColumns).or(patientPrimaryFilter(term)).order('last_name').order('first_name').order('id').limit(21)
  if (signal) { people = people.abortSignal(signal); records = records.abortSignal(signal); exact = exact.abortSignal(signal); primary = primary.abortSignal(signal) }
  const [direct, byCode, exactMatches, primaryMatches] = await Promise.all([people, records, exact, primary])
  if (direct.error || byCode.error || exactMatches.error || primaryMatches.error) throw new Error('No se pudo consultar el directorio autorizado. Comprueba tu conexión y los permisos de tu cuenta.')
  const ids = [...new Set((byCode.data ?? []).map(record => record.patient_id))]
  let codeMatches = [...(direct.data ?? []), ...(exactMatches.data ?? []), ...(primaryMatches.data ?? [])]
  if (ids.length) {
    let query = client().from('patients').select(patientSearchColumns).in('id', ids).limit(21)
    if (signal) query = query.abortSignal(signal)
    const result = await query
    if (result.error) throw new Error('No se pudieron consultar los pacientes de estos expedientes.')
    codeMatches = [...codeMatches, ...(result.data ?? [])]
  }
  const matches = codeMatches.map(row => {
    const embedded = row.medical_records
    const record = Array.isArray(embedded) ? embedded[0] : embedded
    return { ...row, record_code: record?.record_code ?? null, record_id: record?.id ?? null } as ReceptionPatientMatch
  })
  const ranked = rankPatientMatches(matches, term)
  const intent = patientSearchIntent(term)
  const hasPrimary = ranked.some(patient => patientMatch(patient, term)?.field === intent)
  const hasMore = ranked.length > 20 || (hasPrimary ? (primaryMatches.data?.length ?? 0) > 20 || (intent === 'record' && (byCode.data?.length ?? 0) > 20) : (direct.data?.length ?? 0) > 20 || (byCode.data?.length ?? 0) > 20 || (exactMatches.data?.length ?? 0) > 20)
  return { patients: ranked.slice(0, 20), hasMore }
}

export async function readReceptionRecord(patientId: string, signal?: AbortSignal) {
  let query = client().from('medical_records').select('id,patient_id,record_code,opened_at').eq('patient_id', patientId)
  if (signal) query = query.abortSignal(signal)
  const result = await query.maybeSingle()
  if (result.error || !result.data) throw new Error('El expediente no está disponible para tu cuenta. Actualiza la búsqueda o solicita revisión.')
  let historyQuery = client().from('medical_history').select('id,history_type,description,created_at').eq('record_id', result.data.id).order('created_at', { ascending: false }).limit(10)
  if (signal) historyQuery = historyQuery.abortSignal(signal)
  const history = await historyQuery
  if (history.error) throw new Error('No se pudo consultar la información autorizada del expediente.')
  return { ...result.data, history: history.data ?? [] }
}
export async function readAttentionRequest(id: string) {
  const { data, error } = await client().from('appointment_requests').select('*').eq('id', id).maybeSingle()
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  if (!data) throw new Error('La solicitud no está disponible para tu cuenta.')
  return data as AttentionRequest
}
export async function linkedPatient(request: AttentionRequest) {
  let query = client().from('patients').select('id,profile_id,first_name,last_name,patient_code,dui,birth_date,phone,email,city')
  if (request.patient_id) query = query.eq('id', request.patient_id)
  else if (request.requester_id) query = query.eq('profile_id', request.requester_id)
  else return null
  const { data, error } = await query.maybeSingle()
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as ReceptionPatient | null
}
export async function recordCode(patientId: string) {
  const { data, error } = await client().from('medical_records').select('record_code').eq('patient_id', patientId).maybeSingle()
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data?.record_code as string | undefined
}
export async function requestSymptoms(id: string) {
  const { data, error } = await client().from('appointment_request_symptoms').select('symptom_id,symptom_catalog(name)').eq('request_id', id)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return (data ?? []).map(row => (row.symptom_catalog as unknown as { name: string } | null)?.name).filter(Boolean).join(', ')
}
export async function availableSlots(specialty: number, date: string, patientId: string | null, doctorId?: string, untilDate?: string) {
  const { data: doctors, error } = await client().from('doctor_specialties').select('doctor_id').eq('specialty_id', specialty)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  const ids = new Set((doctors ?? []).map(d => d.doctor_id))
  const from = `${date}T00:00:00-06:00`
  const until = untilDate ? `${untilDate}T00:00:00-06:00` : new Date(new Date(from).getTime() + 86400000).toISOString()
  // Prefer the server filter that also checks the specialty enabled in each day's journey.
  const slots = await receptionRpc<Slot[]>('reception_specialty_slots', { p_specialty: specialty, p_from: from, p_until: until, ...(doctorId ? { p_doctor: doctorId } : {}) })
    .catch(error => {
      if (!['PGRST202', '42883'].includes((error as { code?: string }).code ?? '')) throw error
      return receptionRpc<Slot[]>('get_medical_availability', { p_from: from, p_until: until, ...(doctorId ? { p_doctor: doctorId } : {}) })
    })
  const { data: booked, error: bookedError } = await client().from('appointments').select('doctor_id,consulting_room_id,patient_id,starts_at,ends_at').lt('starts_at', until).gt('ends_at', from).in('status', ['programada', 'confirmada', 'en_atencion'])
  if (bookedError) throw Object.assign(new Error(bookedError.message), { code: bookedError.code })
  return availablePatientSlots(slots, booked ?? [], ids, patientId, Date.now(), doctorId)
}
/** First date after `date` (within 30 days) with a free slot for the specialty, or null. */
export async function nextAvailableDate(specialty: number, date: string): Promise<string | null> {
  const from = new Date(new Date(`${date}T00:00:00-06:00`).getTime() + 86400000)
  const until = new Date(from.getTime() + 30 * 86400000)
  try {
    const slots = await receptionRpc<Slot[]>('reception_specialty_slots', { p_specialty: specialty, p_from: from.toISOString(), p_until: until.toISOString() })
    const first = slots.map(s => s.starts_at).sort()[0]
    return first ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(first)) : null
  } catch { return null }
}
export async function receptionDoctors(specialty: number, date: string, patientId: string) {
  try { return { doctors: await receptionRpc<ReceptionDoctor[]>('reception_specialty_doctors', { p_specialty: specialty, p_day: date }), complete: true } }
  catch (error) {
    if (!['PGRST202', '42883'].includes((error as { code?: string }).code ?? '')) throw error
    const slots = await availableSlots(specialty, date, patientId)
    return { doctors: [...new Map(slots.map(slot => [slot.doctor_id, { id: slot.doctor_id, name: slot.doctor_name, specialty: '', shifts: [], consultations: [], breaks: [] }])).values()] as ReceptionDoctor[], complete: false }
  }
}
export async function loadAgenda(date: string) {
  return receptionRpc<ReceptionAppointment[]>('reception_agenda', { p_day: date })
}
export async function requestAppointment(requestId: string) {
  const { data, error } = await client().from('appointments').select('*').eq('request_id', requestId).maybeSingle()
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  if (!data) return null
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.starts_at))
  const agenda = await loadAgenda(day)
  return agenda.find(a => a.id === data.id) ?? data as ReceptionAppointment
}
export const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const displayTime = (value: string) => new Date(value).toLocaleString('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'medium', timeStyle: 'short' })
export const stateLabels: Record<string, string> = { pendiente: 'Pendiente', en_revision: 'En revisión', agendada: 'Cita programada', rechazada: 'Rechazada', cancelada: 'Cancelada' }
export const periodLabels: Record<string, string> = { manana: 'Mañana', tarde: 'Tarde', indiferente: 'Indiferente' }
