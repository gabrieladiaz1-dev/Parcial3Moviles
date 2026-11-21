import { addDays } from '../src/lib/planningDates.ts'
import test from 'node:test'
import { staffToday } from '../src/lib/staffWeek.ts'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { clockParts, clockValue, editableJourney, journeyEnd, journeyOverlaps, journeyFieldErrors, validateJourney } from '../src/lib/recurringJourney.ts'
import { savedScheduleGroups } from '../src/lib/planningGroups.ts'

const values = { staff_id: 'local-person', weekdays: [1, 2, 3, 4, 5, 6], start_time: '08:00', end_time: '16:00', shift_type: 'ordinario', valid_from: '2030-01-01', valid_until: null, breaks: [{ start_time: '12:00', end_time: '12:30', reason: 'Almuerzo' }], consultations: [], room_id: null, specialty_id: null, specialty_ids: [] }
const journey = { ...values, id: 'local-rule', staff_role: 'recepcionista', consulting_room_id: null, closed_on: null, active: true, version: '1' }

test('seleccionar empleado reutiliza su jornada vigente o futura sin abrir otra asignación', () => {
  const future = { ...journey, id: 'future', valid_from: '2030-02-01' }
  const history = { ...journey, id: 'history', active: false, closed_on: '2030-01-01' }
  const other = { ...journey, id: 'other', staff_id: 'other-person' }
  assert.equal(editableJourney([journey, history, other, future], values.staff_id, '2030-01-15')?.id, 'future')
  assert.equal(editableJourney([history, other], values.staff_id, '2030-01-15'), undefined)
  assert.equal(editableJourney([{ ...journey, valid_until: '2030-01-10' }], values.staff_id, '2030-01-15'), undefined)
})

test('selectores de 12 horas: 16:00 se presenta como 4 PM y no como 16 PM', () => {
  assert.deepEqual(clockParts('16:00'), { hour: 4, minute: 0, period: 'PM' })
  assert.equal(clockValue(4, 0, 'PM'), '16:00')
  assert.equal(clockValue(12, 0, 'AM'), '00:00')
  assert.equal(clockValue(12, 0, 'PM'), '12:00')
  for (let hour = 0; hour < 24; hour++) {
    const original = `${String(hour).padStart(2, '0')}:35`
    const parts = clockParts(original)
    assert.equal(clockValue(parts.hour, parts.minute, parts.period), original)
  }
})

test('formulario de recepción conserva vigencia sin final y rechaza descansos incompatibles', () => {
  assert.equal(validateJourney(values, false), '')
  assert.match(validateJourney({ ...values, weekdays: [] }, false), /día laboral/)
  assert.match(validateJourney({ ...values, breaks: [{ start_time: '07:00', end_time: '08:00', reason: 'Fuera' }] }, false), /dentro de la jornada/)
  assert.match(validateJourney({ ...values, breaks: [...values.breaks, { start_time: '12:15', end_time: '13:00', reason: 'Pausa' }] }, false), /superponerse/)
  assert.equal(validateJourney({ ...values, start_time: '20:00', end_time: '04:00', breaks: [{ start_time: '00:00', end_time: '00:30', reason: 'Pausa nocturna' }] }, false), '')
})

test('doctor exige consultorio real, especialidad y atención dentro de su jornada', () => {
  assert.match(validateJourney(values, true), /consultorio/)
  const doctor = { ...values, room_id: 'local-room', specialty_id: 1, specialty_ids: [1, 2], consultations: [{ start_time: '08:00', end_time: '16:00', slot_minutes: 30 }] }
  assert.equal(validateJourney(doctor, true), '')
  assert.match(validateJourney({ ...doctor, specialty_ids: [] }, true), /especialidades/)
  assert.match(journeyFieldErrors({ ...doctor, specialty_ids: [1, 1] }, true).specialty_ids, /especialidad/)
  assert.match(validateJourney({ ...doctor, consultations: [{ start_time: '07:00', end_time: '16:00', slot_minutes: 30 }] }, true), /dentro de la jornada/)
  assert.match(validateJourney(doctor, false), /Recepción/)
})

test('validación por campo identifica datos incompletos y errores de horario', () => {
  const missingDoctorFields = journeyFieldErrors({ ...values, start_time: '08:00', end_time: '08:00' }, true)
  assert.match(missingDoctorFields.start_time, /diferentes/)
  assert.match(missingDoctorFields.end_time, /diferentes/)
  assert.match(missingDoctorFields.room_id, /consultorio/)
  assert.match(missingDoctorFields.specialty_ids, /especialidad/)
  assert.match(missingDoctorFields.consultations, /horario de atención/)
  const invalidBreak = journeyFieldErrors({ ...values, breaks: [{ start_time: '07:00', end_time: '08:00', reason: '' }] }, false)
  assert.match(invalidBreak['breaks.0.start_time'], /dentro de la jornada/)
  assert.match(invalidBreak['breaks.0.reason'], /descripción/)
  assert.deepEqual(journeyFieldErrors(values, false), {})
})

test('reserva fija conserva consultorio incluso en días libres y cierra solo desde la fecha efectiva', () => {
  assert.equal(journeyOverlaps(journey, '2050-01-01', null), true)
  const closed = { ...journey, active: false, closed_on: '2030-02-01' }
  assert.equal(journeyEnd(closed), '2030-01-31')
  assert.equal(journeyOverlaps(closed, '2030-02-01', null), false)
  assert.equal(journeyOverlaps(closed, '2030-01-10', '2030-01-20'), true)
  assert.equal(journeyOverlaps({ ...closed, closed_on: closed.valid_from }, closed.valid_from, null), false)
})

test('proyecciones recurrentes conservan su identidad y no absorben excepciones por fecha', () => {
  const period = { starts_at: '2030-01-07T08:00:00-06:00', ends_at: '2030-01-07T16:00:00-06:00', version: '1' }
  const data = { shifts: [{ ...period, id: 'projected', recurring_id: journey.id, staff_id: 'local-person', status: 'programado' }], consultations: [], absences: [{ ...period, id: 'exception', starts_at: '2030-01-07T12:00:00-06:00', ends_at: '2030-01-07T12:30:00-06:00', staff_id: 'local-person', reason: 'Descanso: Excepción', active: true }] }
  const groups = savedScheduleGroups(data)
  assert.equal(groups.find(g => g.kind === 'shift').recurringId, journey.id)
  assert.equal(groups.find(g => g.kind === 'shift').breaks.length, 0)
  assert.equal(groups.find(g => g.kind === 'absence').originals[0].id, 'exception')
})

test('render del formulario: empleado primero, campos contextuales y validación visible', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { FriendlyTimeField } = await server.ssrLoadModule('/src/components/FriendlyTimeField.tsx')
    const time = renderToStaticMarkup(createElement(FriendlyTimeField, { label: 'Salida', value: '16:00', onChange() {} }))
    assert.match(time, /<option value="4" selected="">4<\/option>/)
    assert.match(time, /<option value="PM" selected="">PM<\/option>/)
    assert.ok(!time.match(/aria-label="Salida: hora"[\s\S]*?<\/select>/)[0].includes('<option value="16"'))
    assert.ok(!time.includes('type="time"'))
    const { RecurringJourneyForm } = await server.ssrLoadModule('/src/components/RecurringJourneyForm.tsx')
    for (const role of ['doctor', 'recepcionista']) {
      const data = { ready: true, recurring_ready: true, staff: [{ id: values.staff_id, first_name: 'Empleado', last_name: 'Local', employee_code: 'LOCAL', category: role, roles: [role], active: true }], rooms: [{ id: 'local-room', code: 'LOCAL-01', active: true }], doctor_specialties: [{ doctor_id: values.staff_id, specialty_id: 1, name: 'Especialidad local' }], shifts: [], consultations: [], absences: [], recurring_journeys: [] }
      const empty = renderToStaticMarkup(createElement(RecurringJourneyForm, { data, initialRole: role, loading: false, onBusy() {}, onSaved() {}, onManage() {}, onCancel() {} }))
      assert.ok(empty.includes('Busca y selecciona al empleado'))
      assert.ok(empty.includes('Nombre, código o identificador'))
      assert.ok(!empty.includes('<b>02</b>'))
      assert.ok(!empty.includes('Horario laboral'))
      assert.ok(!empty.includes('Revisar y guardar'))
      const html = renderToStaticMarkup(createElement(RecurringJourneyForm, { data, initialEmployee: values.staff_id, initialRole: role, loading: false, onBusy() {}, onSaved() {}, onManage() {}, onCancel() {} }))
      assert.ok(html.includes('Asignar jornada fija'))
      assert.ok(html.includes('Volver al horario'))
      assert.ok(html.includes('Revisar y guardar'))
      assert.ok(html.includes('class="recurring-panel wizard-panel wizard-days"'))
      assert.ok(html.includes(`min="${addDays(staffToday(), 1)}" value="${addDays(staffToday(), 1)}"`))
      assert.ok(html.includes('sin fecha final, hasta que modifiques o desactives'))
      assert.ok(!html.includes('Vigente hasta'))
      assert.ok(html.includes('4:00 PM'))
      assert.ok(!html.includes('16 PM'))
      assert.ok(!html.includes('<table') && !html.includes('staff-week'))
      assert.equal(html.includes('Consultorio fijo'), role === 'doctor')
      assert.equal(html.includes('Especialidades para esta jornada'), role === 'doctor')
      assert.ok(html.includes('<b>05</b>'))
      assert.equal(html.includes('Selecciona un consultorio.'), role === 'doctor')
      assert.equal(html.includes('aria-invalid="true"'), role === 'doctor')
      const editing = { ...journey, valid_from: '2099-01-01', staff_role: role, weekdays: [1,2,3,4,5,6] }
      const editingData = { ...data, recurring_journeys: [editing] }
      const day = renderToStaticMarkup(createElement(RecurringJourneyForm, { data: editingData, initialJourney: editing, initialEmployee: values.staff_id, editWeekday: 6, loading: false, onBusy() {}, onSaved() {}, onManage() {} }))
      assert.ok(day.includes('Editar sábado'))
      assert.ok(day.includes('todos los sábados') || day.includes('todos los sábado'))
      assert.ok(day.includes('Los otros días conservarán sus horarios'))
      assert.equal((day.match(/aria-pressed="true"/g) ?? []).length,1)
      const complete = renderToStaticMarkup(createElement(RecurringJourneyForm, { data: editingData, initialJourney: editing, initialEmployee: values.staff_id, loading: false, onBusy() {}, onSaved() {}, onManage() {} }))
      assert.ok(complete.includes('Editar jornada completa'))
      for (const markup of [day, complete]) assert.ok(markup.includes(`min="${staffToday()}" value="${staffToday()}"`))
      assert.equal((complete.match(/aria-pressed="true"/g) ?? []).length,6)
    }
  } finally { await server.close() }
})


test('validación rechaza horas fuera del reloj y días inválidos', () => {
  assert.notEqual(validateJourney({ ...values, start_time: '29:00' }, false), '')
  assert.notEqual(validateJourney({ ...values, weekdays: [7] }, false), '')
  assert.notEqual(validateJourney({ ...values, breaks: [{ start_time: '12:99', end_time: '13:00', reason: 'Pausa' }] }, false), '')
})

test('roomConflicts detects another doctor holding the room in overlapping dates', async () => {
  const { roomConflicts, roomConflictMessage } = await import('../src/lib/recurringJourney.ts')
  const base = { id: 'a', staff_id: 'doc-a', staff_role: 'doctor', weekdays: [1], start_time: '08:00', end_time: '12:00', shift_type: 'ordinario', breaks: [], consultations: [], consulting_room_id: 'r1', specialty_id: 1, valid_from: '2030-01-01', valid_until: '2030-06-30', closed_on: null, active: true, version: '1' }
  assert.equal(roomConflicts([base], 'r1', 'doc-b', '2030-03-01', null).length, 1)
  assert.equal(roomConflicts([base], 'r1', 'doc-b', '2030-07-01', null).length, 0)
  assert.equal(roomConflicts([base], 'r1', 'doc-a', '2030-03-01', null).length, 0)
  assert.equal(roomConflicts([base], 'r2', 'doc-b', '2030-03-01', null).length, 0)
  assert.equal(roomConflicts([base], 'r1', 'doc-b', '2030-03-01', null, 'a').length, 0)
  assert.match(roomConflictMessage(base, 'C-101', 'Ana Pérez'), /C-101.*Ana Pérez.*2030-01-01.*2030-06-30/)
})
