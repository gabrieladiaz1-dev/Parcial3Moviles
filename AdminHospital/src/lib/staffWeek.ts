import { addDays, hospitalDate, monday, overlapsDay } from './planningDates.ts'
import type { PlanningData, PlanningStaff } from './planning'
import type { ScheduleGroup, StaffRole } from './planningGroups'

export const staffToday = (value: Date | string = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
export const staffWeek = (value: Date | string = new Date()) => monday(staffToday(value))
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export function findScheduleStaff(staff: PlanningStaff[], role: StaffRole, query: string) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  return staff.filter(s => s.category === role && s.roles.includes(role) && tokens.every(t => normalize(`${s.first_name ?? ''} ${s.last_name ?? ''} ${s.employee_code} ${s.id}`).includes(t)))
}
export interface WeekBlock { id: string; kind: 'shift' | 'consultation' | 'break' | 'absence'; starts_at: string; ends_at: string; active: boolean; room?: string; minutes?: number; reason?: string | null; group?: ScheduleGroup; originDate?: string }
export function partitionStaffWeek(calendar: { date: string; blocks: WeekBlock[] }[], today: string) {
  const current = calendar.map(day => ({ ...day, blocks: day.date < today ? [] : day.blocks.filter(block => (block.originDate ?? hospitalDate(block.starts_at)) >= today) }))
  const history = calendar.filter(day => day.date < today).map(day => ({ ...day, blocks: day.blocks.filter(block => (block.originDate ?? hospitalDate(block.starts_at)) === day.date) })).filter(day => day.blocks.length > 0).reverse()
  return { current, history }
}
export function scheduleForDate(group: ScheduleGroup, date: string): ScheduleGroup {
  const originals = group.originals.filter(o => o.date === date)
  if (!group.dates.includes(date) || !originals.length) throw new Error('Esta fecha no corresponde a la programación seleccionada. Actualiza los horarios.')
  return { ...group, dates: [date], originals }
}
export function employeeWeek(data: PlanningData, employee: string, week: string, groups: ScheduleGroup[], includeInactive = false) {
  const blocks: WeekBlock[] = employee ? [
    ...(data.saved_shifts ?? data.shifts).filter(r => r.staff_id === employee).map(r => ({ ...r, kind: 'shift' as const, active: r.status !== 'cancelado' })),
    ...(data.saved_consultations ?? data.consultations).filter(r => r.doctor_id === employee).map(r => ({ ...r, kind: 'consultation' as const, room: data.rooms.find(room => room.id === r.consulting_room_id)?.code ?? 'Sin consultorio disponible', minutes: r.slot_minutes })),
    ...(data.saved_absences ?? data.absences).filter(r => r.staff_id === employee).map(r => ({ ...r, kind: r.reason?.startsWith('Descanso:') ? 'break' as const : 'absence' as const })),
  ].filter(r => includeInactive || r.active).map(row => {
    const group = groups.find(g => g.staffId === employee && g.originals.some(o => o.id === row.id))
    return { ...row, group, originDate: group?.originals.find(o => o.id === row.id)?.date }
  }) : []
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(week, i)
    return { date, blocks: blocks.filter(b => overlapsDay(b.starts_at, b.ends_at, date)).sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.kind.localeCompare(b.kind)) }
  })
}

export interface TimelineSegment { start: number; end: number; block: WeekBlock }
export function dayTimeline(date: string, blocks: WeekBlock[]): TimelineSegment[] {
  const midnight = new Date(`${date}T00:00:00-06:00`).getTime()
  const intervals = blocks.filter(b => b.active).map(block => ({ block, start: Math.max(0, (new Date(block.starts_at).getTime() - midnight) / 60000), end: Math.min(1440, (new Date(block.ends_at).getTime() - midnight) / 60000) })).filter(b => b.end > b.start)
  const boundaries = [...new Set(intervals.flatMap(i => [i.start, i.end]))].sort((a, b) => a - b)
  const priority = { absence: 4, break: 3, consultation: 2, shift: 1 }
  const result: TimelineSegment[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i], end = boundaries[i + 1]
    const covering = intervals.filter(b => b.start <= start && b.end >= end).sort((a, b) => priority[b.block.kind] - priority[a.block.kind] || a.block.id.localeCompare(b.block.id))
    const block = covering[0]?.block
    if (!block) continue
    const last = result.at(-1)
    if (last?.block.id === block.id && last.end === start) last.end = end
    else result.push({ start, end, block })
  }
  return result
}
export function weekTimeline(calendar: { date: string; blocks: WeekBlock[] }[]) {
  const days = calendar.map(day => ({ ...day, segments: dayTimeline(day.date, day.blocks) }))
  const all = days.flatMap(day => day.segments)
  const start = all.length ? Math.floor(Math.min(...all.map(s => s.start)) / 60) * 60 : 480
  const end = all.length ? Math.ceil(Math.max(...all.map(s => s.end)) / 60) * 60 : 1020
  return { days, start, end: Math.max(end, start + 60), ticks: Array.from({ length: Math.ceil((Math.max(end, start + 60) - start) / 30) + 1 }, (_, i) => start + i * 30) }
}
export function minuteLabel(value: number) {
  const hour = Math.floor(value / 60) % 24
  return `${hour % 12 || 12}:${String(Math.floor(value % 60)).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}
export function formatStaffTime(value: string) { const [hours, minutes] = value.split(':').map(Number); return minuteLabel(hours * 60 + minutes) }
export function schoolWeek(calendar: { date: string; blocks: WeekBlock[] }[]) {
  const days = calendar.map(day => ({ ...day, segments: dayTimeline(day.date, day.blocks) }))
  const edges = [...new Set(days.flatMap(d => d.segments.flatMap(s => [s.start, s.end])))].sort((a, b) => a - b)
  const rows = edges.slice(0, -1).map((start, i) => {
    const end = edges[i + 1]
    return { start, end, cells: days.map(day => day.segments.find(s => s.start <= start && s.end >= end)?.block ?? null) }
  }).filter(row => row.cells.some(Boolean))
  return { days, rows }
}

// Clip visible segments at 6 AM / 6 PM; keep original dates and records for editing.
export function filterWeekPeriod(calendar: { date: string; blocks: WeekBlock[] }[], period: 'all' | 'day' | 'night') {
  if (period === 'all') return calendar
  return calendar.map(day => {
    const midnight = new Date(`${day.date}T00:00:00-06:00`).getTime()
    const windows = period === 'day' ? [[360, 1080]] : [[0, 360], [1080, 1440]]
    return { ...day, blocks: day.blocks.flatMap(block => windows.flatMap(([start, end]) => {
      const a = Math.max(new Date(block.starts_at).getTime(), midnight + start * 60000)
      const b = Math.min(new Date(block.ends_at).getTime(), midnight + end * 60000)
      return a < b ? [{ ...block, starts_at: new Date(a).toISOString(), ends_at: new Date(b).toISOString() }] : []
    })) }
  })
}
