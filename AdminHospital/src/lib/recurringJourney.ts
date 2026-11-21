import { addDays } from './planningDates.ts'
import type { RecurringJourney } from './planning'

export interface JourneyValues {
  staff_id: string; weekdays: number[]; start_time: string; end_time: string; shift_type: string
  valid_from: string; valid_until: string | null; breaks: { start_time: string; end_time: string; reason: string }[]
  consultations: { start_time: string; end_time: string; slot_minutes: number }[]; room_id: string | null; specialty_id: number | null; specialty_ids: number[]
}
export function clockParts(value: string) {
  const [hour = 8, minute = 0] = value.split(':').map(Number)
  return { hour: hour % 12 || 12, minute, period: hour < 12 ? 'AM' : 'PM' }
}
export function clockValue(hour: number, minute: number, period: string) { return `${String(hour % 12 + (period === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
export function journeyEnd(journey: RecurringJourney) {
  return [journey.valid_until, journey.closed_on ? addDays(journey.closed_on, -1) : null].filter((v): v is string => Boolean(v)).sort()[0] ?? null
}
export function journeyOverlaps(journey: RecurringJourney, from: string, until: string | null) {
  const end = journeyEnd(journey)
  return (!end || end >= journey.valid_from) && (!until || journey.valid_from <= until) && (!end || end >= from)
}
// Mirrors recurring_fixed_room_excl: a fixed room belongs to one doctor for the whole overlapping validity.
export function roomConflicts(journeys: RecurringJourney[], roomId: string | null, staffId: string, from: string, until: string | null, ignoreId?: string) {
  if (!roomId) return []
  return journeys.filter(j => j.id !== ignoreId && j.staff_id !== staffId && j.consulting_room_id === roomId && journeyOverlaps(j, from, until))
}
export function roomConflictMessage(conflict: RecurringJourney, roomCode: string, doctorName: string) {
  const end = journeyEnd(conflict)
  return `El consultorio ${roomCode} ya está asignado a ${doctorName} desde ${conflict.valid_from}${end ? ` hasta ${end}` : ' sin fecha de fin'}. Elige otro consultorio o una vigencia que no coincida.`
}
export function editableJourney(journeys: RecurringJourney[], staffId: string, today: string) {
  return journeys.filter(j => j.staff_id === staffId && j.active && !j.closed_on && (!j.valid_until || j.valid_until >= today))
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
}
export function journeyFieldErrors(values: JourneyValues, doctor: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!values.staff_id) errors.staff_id = 'Selecciona al empleado.'
  if (!values.weekdays.length || values.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) errors.weekdays = 'Selecciona al menos un día laboral válido.'
  if (!values.valid_from || (values.valid_until && values.valid_until < values.valid_from)) errors.valid_from = 'Comprueba las fechas de vigencia.'
  if (!validClock(values.start_time)) errors.start_time = 'Indica una hora de entrada válida.'
  if (!validClock(values.end_time)) errors.end_time = 'Indica una hora de salida válida.'
  if (validClock(values.start_time) && validClock(values.end_time) && values.start_time === values.end_time) {
    errors.start_time = 'La entrada y la salida deben ser diferentes.'
    errors.end_time = 'La entrada y la salida deben ser diferentes.'
  }
  const minute = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m }
  const base = validClock(values.start_time) ? minute(values.start_time) : 0
  const offset = (time: string) => minute(time) + (minute(time) < base ? 1440 : 0)
  const finish = validClock(values.end_time) ? offset(values.end_time) : 0
  const checkPeriods = (list: { start_time: string; end_time: string }[], prefix: string, name: string) => {
    const intervals = list.map((period, index) => {
      const startKey = `${prefix}.${index}.start_time`
      const endKey = `${prefix}.${index}.end_time`
      if (!validClock(period.start_time)) errors[startKey] = `Indica una hora válida para ${name.toLowerCase()}.`
      if (!validClock(period.end_time)) errors[endKey] = `Indica una hora válida para ${name.toLowerCase()}.`
      if (!validClock(period.start_time) || !validClock(period.end_time) || !validClock(values.start_time) || !validClock(values.end_time)) return null
      return { index, start: offset(period.start_time), end: offset(period.end_time), startKey, endKey }
    }).filter((period): period is NonNullable<typeof period> => period !== null).sort((a, b) => a.start - b.start)
    for (let i = 0; i < intervals.length; i++) {
      const period = intervals[i]
      if (period.start < base || period.end > finish || period.end <= period.start) {
        errors[period.startKey] = `${name}: cada periodo debe estar dentro de la jornada.`
        errors[period.endKey] = `${name}: cada periodo debe estar dentro de la jornada.`
      }
      if (i > 0 && period.start < intervals[i - 1].end) {
        errors[period.startKey] = `${name}: los periodos no pueden superponerse.`
        errors[intervals[i - 1].endKey] = `${name}: los periodos no pueden superponerse.`
      }
    }
  }
  checkPeriods(values.breaks, 'breaks', 'Descansos')
  values.breaks.forEach((pause, index) => {
    if (!pause.reason.trim()) errors[`breaks.${index}.reason`] = 'Escribe una descripción para este descanso.'
  })
  if (doctor) {
    if (!values.room_id) errors.room_id = 'Selecciona un consultorio.'
    if (!values.specialty_ids.length || values.specialty_ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(values.specialty_ids).size !== values.specialty_ids.length || !values.specialty_id || !values.specialty_ids.includes(values.specialty_id)) errors.specialty_ids = 'Selecciona al menos una especialidad válida del doctor.'
    if (!values.consultations.length) errors.consultations = 'Añade al menos un horario de atención.'
    checkPeriods(values.consultations, 'consultations', 'Atención')
    values.consultations.forEach((consultation, index) => {
      if (!Number.isInteger(consultation.slot_minutes) || consultation.slot_minutes < 5 || consultation.slot_minutes > 180) {
        errors[`consultations.${index}.slot_minutes`] = 'Las citas deben durar entre 5 y 180 minutos.'
      }
    })
  }
  return errors
}
export function validateJourney(values: JourneyValues, doctor: boolean) {
  if (!values.staff_id) return 'Selecciona al empleado.'
  if (!values.weekdays.length || values.weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return 'Selecciona al menos un día laboral válido.'
  if (!values.valid_from || (values.valid_until && values.valid_until < values.valid_from)) return 'Comprueba las fechas de vigencia.'
  const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  if (!validClock(values.start_time) || !validClock(values.end_time) || values.start_time === values.end_time) return 'La entrada y la salida deben ser horas válidas y diferentes.'
  if ([...values.breaks, ...values.consultations].some(p => !validClock(p.start_time) || !validClock(p.end_time))) return 'Comprueba las horas de atención y descansos.'
  const minute = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m }
  const base = minute(values.start_time)
  const offset = (time: string) => minute(time) + (minute(time) < base ? 1440 : 0)
  const finish = offset(values.end_time)
  const check = (list: { start_time: string; end_time: string }[], name: string) => {
    const intervals = list.map(p => [offset(p.start_time), offset(p.end_time)]).sort((a, b) => a[0] - b[0])
    if (intervals.some(([a, b]) => !Number.isFinite(a + b) || a < base || b > finish || b <= a)) return `${name}: cada periodo debe estar dentro de la jornada.`
    if (intervals.some(([a], i) => i > 0 && a < intervals[i - 1][1])) return `${name}: los periodos no pueden superponerse.`
    return ''
  }
  const pauses = check(values.breaks, 'Descansos')
  if (pauses) return pauses
  if (values.breaks.some(b => !b.reason.trim())) return 'Escribe una descripción para cada descanso.'
  if (doctor) {
    if (!values.room_id || !values.specialty_ids.length || !values.specialty_id || !values.specialty_ids.includes(values.specialty_id) || !values.consultations.length) return 'Selecciona el consultorio, una o más especialidades y al menos un horario de atención.'
    const medical = check(values.consultations, 'Atención')
    if (medical) return medical
    if (values.consultations.some(c => !Number.isInteger(c.slot_minutes) || c.slot_minutes < 5 || c.slot_minutes > 180)) return 'Las citas deben durar entre 5 y 180 minutos.'
  } else if (values.room_id || values.specialty_id || values.specialty_ids.length || values.consultations.length) return 'Recepción no utiliza consultorio ni atención médica.'
  return ''
}
