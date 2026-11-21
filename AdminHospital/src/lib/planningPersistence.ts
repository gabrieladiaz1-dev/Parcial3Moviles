import { addDays, atMidnight, monday } from './planningDates.ts'
import type { AvailabilitySlot, PlanningData, RecurringJourney } from './planning'

interface PlanningReads { read: (week: string) => Promise<PlanningData>; availability: (week: string, doctor: string, room: string) => Promise<AvailabilitySlot[]> }
function unconfirmed(detail: string) { console.warn("[guardado sin confirmar]", detail); return Object.assign(new Error("El guardado se envió, pero no se pudo confirmar. Actualiza los datos y comprueba si el cambio quedó registrado antes de reintentar."), { code: 'SAVE_UNCONFIRMED' }) }
const closingDate = (journey: RecurringJourney, effective: unknown) => journey.valid_from > String(effective) ? journey.valid_from : String(effective)
const clock = (value: unknown) => String(value ?? '').slice(0, 5)
const days = (value: unknown) => Array.isArray(value) ? [...value].map(Number).sort((a, b) => a - b).join(',') : ''
const specialties = (value: unknown, fallback: unknown) => days(Array.isArray(value) && value.length ? value : fallback ? [fallback] : [])
export async function confirmRecurringScope(read: (week: string) => Promise<PlanningData>, values: Record<string, unknown>, previous: RecurringJourney, scope: { weekday: number | null; originals: RecurringJourney[] }) {
  const snapshot = await read(monday(String(values.valid_from)))
  if (scope.weekday === null) {
    const expected = scope.originals.filter(j => j.active && !j.closed_on && (!j.valid_until || j.valid_until >= String(values.valid_from)))
    if (expected.some(j => !snapshot.recurring_journeys?.some(saved => saved.id === j.id && saved.closed_on === closingDate(j, values.valid_from)))) throw unconfirmed('Falta confirmar el historial de la jornada completa.')
  } else {
    const remaining = previous.weekdays.filter(d => d !== scope.weekday)
    if (!remaining.length) return
    const preserved = snapshot.recurring_journeys?.find(j => j.staff_id === previous.staff_id && j.active && !j.closed_on && j.valid_from === closingDate(previous, values.valid_from) && days(j.weekdays) === days(remaining))
    const same = (j: RecurringJourney) => JSON.stringify([clock(j.start_time),clock(j.end_time),j.shift_type,j.breaks,j.consultations,j.consulting_room_id,j.specialty_id,specialties(j.specialty_ids,j.specialty_id),j.valid_until])
    if (!preserved || same(preserved) !== same(previous)) throw unconfirmed('Los otros días no conservaron su configuración original.')
  }
}
export async function confirmRecurringWrite(reads: PlanningReads, values: Record<string, unknown>, id: string, previous?: RecurringJourney) {
  const week = monday(String(values.valid_from))
  let first: PlanningData
  try { first = await reads.read(week) } catch (error) { throw unconfirmed(error instanceof Error ? error.message : 'Falló read_staff_planning.') }
  const saved = first.recurring_journeys?.find(item => item.id === id && item.staff_id === values.staff_id)
  if (!saved) throw unconfirmed('read_staff_planning no devolvió la versión guardada para este empleado.')
  if (values.active === false) {
    if (saved.closed_on !== values.valid_from || saved.active !== false) throw unconfirmed('La lectura no confirmó la desactivación desde la fecha indicada.')
    if (first.shifts.some(shift => shift.recurring_id === id && new Date(shift.starts_at).getTime() >= new Date(atMidnight(String(values.valid_from))).getTime() && shift.status !== 'cancelado')) throw unconfirmed('La lectura aún incluye jornadas de esta versión después de su cierre efectivo.')
    return
  }
  const normalizePeriods = (value: unknown, medical: boolean) => Array.isArray(value) ? JSON.stringify(value.map(p => ({ start: clock(p.start_time), end: clock(p.end_time), value: medical ? Number(p.slot_minutes) : p.reason }))) : '[]'
  if (saved.valid_from !== values.valid_from || saved.valid_until !== (values.valid_until || null) || saved.closed_on !== null || saved.active !== true || days(saved.weekdays) !== days(values.weekdays) || clock(saved.start_time) !== clock(values.start_time) || clock(saved.end_time) !== clock(values.end_time) || saved.shift_type !== values.shift_type || saved.consulting_room_id !== (values.room_id || null) || saved.specialty_id !== (values.specialty_id || null) || specialties(saved.specialty_ids,saved.specialty_id) !== specialties(values.specialty_ids,values.specialty_id) || normalizePeriods(saved.breaks, false) !== normalizePeriods(values.breaks, false) || normalizePeriods(saved.consultations, true) !== normalizePeriods(values.consultations, true)) throw unconfirmed('Los días, horas, descansos, consultorio, especialidades o vigencia leídos no coinciden con lo enviado.')
  if (previous && !first.recurring_journeys?.some(item => item.id === previous.id && item.staff_id === previous.staff_id && item.closed_on === closingDate(previous, values.valid_from))) throw unconfirmed('No se pudo confirmar el cierre de vigencia de la versión anterior.')
  const futureWeek = !saved.valid_until ? addDays(week, 28) : week
  const checks: Promise<unknown>[] = []
  if (!saved.valid_until) checks.push(reads.read(futureWeek).then(snapshot => {
    if (!snapshot.shifts.some(shift => shift.recurring_id === id && shift.staff_id === saved.staff_id && shift.status !== 'cancelado')) throw new Error('La lectura de cuatro semanas posteriores no devolvió la jornada recurrente guardada.')
  }))
  if (saved.staff_role === 'doctor' && saved.consulting_room_id) checks.push(reads.availability(futureWeek, saved.staff_id, saved.consulting_room_id).then(slots => {
    if (!Array.isArray(slots) || slots.some(slot => slot.doctor_id !== saved.staff_id || slot.consulting_room_id !== saved.consulting_room_id || new Date(slot.starts_at).getTime() < new Date(atMidnight(futureWeek)).getTime())) throw new Error('get_medical_availability devolvió una respuesta incompatible con el doctor o consultorio solicitado.')
    // An empty result is valid: existing bookings or absences can occupy every available slot.
  }))
  const results = await Promise.allSettled(checks)
  const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))
  if (errors.length) throw unconfirmed(errors.join(' '))
}
