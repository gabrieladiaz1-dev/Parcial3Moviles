import { addDays, clock, hospitalDate, selectedDates, weekday } from './planningDates.ts'
import type { Consultation, PlanningData, StaffAbsence, WorkShift } from './planning'

export type StaffRole = 'doctor' | 'recepcionista'
export interface OriginalPeriod { kind: 'shift' | 'consultation' | 'absence'; id: string; version: string; date: string }
export interface MedicalInput { start: string; end: string; roomId: string; minutes: number }
export interface BreakInput { start: string; end: string; reason: string }
export interface ScheduleGroup {
  key: string; kind: 'shift' | 'consultation' | 'absence'; staffId: string; active: boolean
  dates: string[]; start: string; end: string; shiftType: string; reason: string
  consultations: MedicalInput[]; breaks: BreakInput[]; originals: OriginalPeriod[]
  recurringId?: string
}
export function toggleDay(days: number[], day: number): number[] {
  return [...new Set(days.includes(day) ? days.filter(d => d !== day) : [...days, day])].sort((a, b) => a - b)
}
export function scheduleDates(from: string, until: string, days: number[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error('Selecciona una fecha de inicio válida.')
  const dates = selectedDates(from, until || addDays(from, 6), days)
  const missing = days.filter(d => !dates.some(date => weekday(date) === d))
  if (missing.length) throw new Error('El rango no incluye todos los días marcados. Amplía la fecha final o déjala vacía para programar una semana completa.')
  return dates
}
function inside(child: { starts_at: string; ends_at: string }, parent: WorkShift): boolean {
  return new Date(child.starts_at) >= new Date(parent.starts_at) && new Date(child.ends_at) <= new Date(parent.ends_at)
}
export function savedScheduleGroups(data: PlanningData): ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>()
  const assigned = new Set<string>()
  function add(kind: ScheduleGroup['kind'], staffId: string, row: WorkShift | Consultation | StaffAbsence, active: boolean, medical: Consultation[] = [], breaks: StaffAbsence[] = []) {
    const start = clock(row.starts_at), end = clock(row.ends_at)
    const consultations = medical.map(m => ({ start: clock(m.starts_at), end: clock(m.ends_at), roomId: m.consulting_room_id, minutes: m.slot_minutes }))
    const pauses = breaks.map(b => ({ start: clock(b.starts_at), end: clock(b.ends_at), reason: b.reason?.replace(/^Descanso:\s*/, '') ?? '' }))
    const shiftType = 'shift_type' in row ? row.shift_type : 'ordinario'
    const reason = 'reason' in row ? row.reason ?? '' : ''
    const key = JSON.stringify([kind, staffId, active, start, end, shiftType, reason, consultations, pauses, row.recurring_id ?? null])
    let group = groups.get(key)
    if (!group) { group = { key, kind, staffId, active, dates: [], start, end, shiftType, reason, consultations, breaks: pauses, originals: [], recurringId: row.recurring_id }; groups.set(key, group) }
    group.dates.push(hospitalDate(row.starts_at))
    const date = hospitalDate(row.starts_at)
    group.originals.push({ kind, id: row.id, version: row.version, date })
    for (const m of medical) { assigned.add(m.id); if (m.id !== row.id) group.originals.push({ kind: 'consultation', id: m.id, version: m.version, date }) }
    for (const b of breaks) { assigned.add(b.id); group.originals.push({ kind: 'absence', id: b.id, version: b.version, date }) }
  }
  const consultations = data.saved_consultations ?? data.consultations
  const absences = data.saved_absences ?? data.absences
  for (const row of data.saved_shifts ?? data.shifts) {
    const active = row.status !== 'cancelado'
    const medical = consultations.filter(m => m.doctor_id === row.staff_id && m.active === active && (m.recurring_id ?? null) === (row.recurring_id ?? null) && inside(m, row)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    const breaks = absences.filter(b => b.staff_id === row.staff_id && b.active === active && (b.recurring_id ?? null) === (row.recurring_id ?? null) && b.reason?.startsWith('Descanso:') && inside(b, row)).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    add('shift', row.staff_id, row, active, medical, breaks)
  }
  for (const row of consultations) if (!assigned.has(row.id)) add('consultation', row.doctor_id, row, row.active, [row])
  for (const row of absences) if (!assigned.has(row.id)) add('absence', row.staff_id, row, row.active)
  return [...groups.values()].map(g => ({ ...g, dates: [...new Set(g.dates)].sort() })).sort((a, b) => (b.dates[0] ?? '').localeCompare(a.dates[0] ?? ''))
}
