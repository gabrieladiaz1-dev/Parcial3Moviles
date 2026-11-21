import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { addDays } from '../src/lib/planningDates.ts'
import { savedScheduleGroups } from '../src/lib/planningGroups.ts'
import { dayTimeline, employeeWeek, findScheduleStaff, formatStaffTime, minuteLabel, partitionStaffWeek, scheduleForDate, schoolWeek, staffToday, staffWeek, weekTimeline } from '../src/lib/staffWeek.ts'

// Synthetic fixtures only. No RPC calls or writes are performed by these tests.
const staff = [
  { id: 'doctor', first_name: 'María Elena', last_name: 'López', employee_code: '001', category: 'doctor', active: true, roles: ['doctor'] },
  { id: 'reception', first_name: 'Ana', last_name: 'Pérez', employee_code: '002', category: 'recepcionista', active: true, roles: ['recepcionista'] },
  { id: 'other', first_name: 'Otra', last_name: 'Persona', employee_code: '003', category: 'doctor', active: true, roles: ['doctor'] },
]
const interval = (id, staff_id, start, end, extra = {}) => ({ id, staff_id, starts_at: `2026-11-${start}-06:00`, ends_at: `2026-11-${end}-06:00`, version: '1', ...extra })
const data = {
  ready: true, staff, rooms: [{ id: 'room', code: 'A-01', active: true }], floors: [],
  shifts: [interval('d-shift', 'doctor', '16T08:00:00', '16T16:00:00', { status: 'programado', shift_type: 'ordinario' }), interval('r-shift', 'reception', '17T20:00:00', '18T04:00:00', { status: 'programado', shift_type: 'guardia' }), interval('other-shift', 'other', '16T07:00:00', '16T15:00:00', { status: 'programado' }), interval('inactive', 'doctor', '20T08:00:00', '20T16:00:00', { status: 'cancelado' })],
  consultations: [{ ...interval('consult', undefined, '16T09:00:00', '16T12:00:00'), doctor_id: 'doctor', consulting_room_id: 'room', slot_minutes: 30, active: true }],
  absences: [interval('break', 'doctor', '16T10:00:00', '16T10:30:00', { reason: 'Descanso: Pausa', active: true }), interval('absence', 'doctor', '19T08:00:00', '19T16:00:00', { reason: 'Ausencia autorizada', active: true })],
}
const groups = savedScheduleGroups(data)
const week = '2026-11-16'

test('busca por nombre, apellido, código o identificador sin tildes', () => {
  assert.deepEqual(findScheduleStaff(staff, 'doctor', 'lopez maria').map(p => p.id), ['doctor'])
  assert.deepEqual(findScheduleStaff(staff, 'recepcionista', '002').map(p => p.id), ['reception'])
  assert.deepEqual(findScheduleStaff(staff, 'recepcionista', 'ANA PEREZ').map(p => p.id), ['reception'])
  assert.deepEqual(findScheduleStaff(staff, 'doctor', 'doctor').map(p => p.id), ['doctor'])
  assert.deepEqual(findScheduleStaff(staff, 'doctor', '002'), [])
})

test('no seleccionar empleado nunca muestra horarios de todos', () => {
  const result = employeeWeek(data, '', week, groups)
  assert.equal(result.length, 7)
  assert.ok(result.every(d => d.blocks.length === 0))
})

test('doctor: siete fechas exactas y solo su jornada, consultorio, duración, descanso y ausencia', () => {
  const result = employeeWeek(data, 'doctor', week, groups)
  assert.deepEqual(result.map(d => d.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'])
  assert.deepEqual(result[0].blocks.map(b => b.kind), ['shift', 'consultation', 'break'])
  assert.equal(result[0].blocks[1].room, 'A-01')
  assert.equal(result[0].blocks[1].minutes, 30)
  assert.equal(result[3].blocks[0].kind, 'absence')
  assert.ok(!result.flatMap(d => d.blocks).some(b => ['r-shift', 'other-shift', 'inactive'].includes(b.id)))
  assert.equal(result[6].blocks.length, 0)
})

test('recepcionista: un turno nocturno aparece en ambos días, sin programación de doctores', () => {
  const result = employeeWeek(data, 'reception', week, groups)
  assert.equal(result[1].blocks[0].id, 'r-shift')
  assert.equal(result[2].blocks[0].id, 'r-shift')
  assert.ok(result.flatMap(d => d.blocks).every(b => b.id === 'r-shift'))
  assert.equal(result[2].blocks[0].originDate, '2026-11-17', 'Editar la continuación nocturna apunta a su jornada original')
})

test('los días pasados van al historial y no aparecen en el horario activo, incluso con turno nocturno', () => {
  const original = employeeWeek(data, 'reception', week, groups)
  const { current, history } = partitionStaffWeek(original, '2026-11-18')
  assert.ok(current[1].blocks.length === 0)
  assert.ok(current[2].blocks.length === 0, 'la continuación de una jornada iniciada ayer no vuelve a la cuadrícula')
  assert.deepEqual(history.map(day => day.date), ['2026-11-17'])
  assert.deepEqual(history[0].blocks.map(block => block.id), ['r-shift'])
  assert.equal(original[1].blocks.length, 1, 'la separación no altera los registros cargados')
})

test('edición conserva IDs y versiones de jornada, consultorio y descanso, sin otros empleados', () => {
  const result = employeeWeek(data, 'doctor', week, groups)
  const group = result[0].blocks[0].group
  assert.equal(group.staffId, 'doctor')
  assert.deepEqual(new Set(group.originals.map(o => o.id)), new Set(['d-shift', 'consult', 'break']))
  assert.ok(group.originals.every(o => o.version === '1' && o.date === week))
  assert.ok(result[0].blocks.every(b => b.group.key === group.key))
})

test('semana actual usa El Salvador incluso cerca de medianoche UTC y al cruzar el año', () => {
  assert.equal(staffToday('2026-11-16T05:59:00Z'), '2026-11-15')
  assert.equal(staffWeek('2026-11-16T05:59:00Z'), '2026-11-09')
  assert.equal(staffWeek('2026-11-18T20:00:00Z'), week)
  assert.equal(staffWeek('2027-01-01T12:00:00Z'), '2026-12-28')
})

test('editar o desactivar un día conserva su transacción completa y excluye las otras fechas del grupo', () => {
  const source = employeeWeek(data, 'doctor', week, groups)[0].blocks[0].group
  const nextDate = addDays(week, 1)
  const multi = { ...source, dates: [week, nextDate], originals: [...source.originals, ...source.originals.map(o => ({ ...o, id: `${o.id}-next`, date: nextDate }))] }
  const original = structuredClone(multi)
  const selected = scheduleForDate(multi, nextDate)
  assert.deepEqual(selected.dates, [nextDate])
  assert.deepEqual(selected.originals.map(o => o.id), ['d-shift-next', 'consult-next', 'break-next'])
  assert.equal(selected.consultations[0].roomId, 'room')
  assert.equal(selected.breaks.length, 1)
  assert.deepEqual(multi, original)
  assert.throws(() => scheduleForDate(multi, addDays(week, 5)), /no corresponde/)
})

test('navegación anterior y posterior conserva el filtro exclusivo del empleado', () => {
  for (const adjacent of [addDays(week, -7), addDays(week, 7)]) {
    const result = employeeWeek(data, 'doctor', adjacent, groups)
    assert.equal(result.length, 7)
    assert.equal(result[0].date, adjacent)
    assert.ok(!result.flatMap(d => d.blocks).some(b => b.id === 'r-shift' || b.id === 'other-shift'))
  }
  assert.equal(addDays(addDays(week, -7), 7), week)
})

test('historial desactivado solo aparece cuando se solicita y conserva el empleado', () => {
  const result = employeeWeek(data, 'doctor', week, groups, true)
  assert.equal(result[4].blocks[0].id, 'inactive')
  assert.equal(result[4].blocks[0].active, false)
  assert.ok(!result.flatMap(d => d.blocks).some(b => b.id === 'other-shift'))
})

test('línea de tiempo: jornada y atención no se duplican; el descanso interrumpe y luego continúa la atención', () => {
  const blocks = [
    { id: 'shift', kind: 'shift', starts_at: '2026-11-16T08:00:00-06:00', ends_at: '2026-11-16T16:00:00-06:00', active: true },
    { id: 'care', kind: 'consultation', starts_at: '2026-11-16T08:00:00-06:00', ends_at: '2026-11-16T16:00:00-06:00', active: true, room: 'A-01', minutes: 30 },
    { id: 'lunch', kind: 'break', starts_at: '2026-11-16T12:00:00-06:00', ends_at: '2026-11-16T12:30:00-06:00', active: true, reason: 'Descanso: Almuerzo' },
  ]
  const original = structuredClone(blocks)
  assert.deepEqual(dayTimeline(week, blocks).map(s => [s.start, s.end, s.block.kind]), [[480, 720, 'consultation'], [720, 750, 'break'], [750, 960, 'consultation']])
  assert.deepEqual(blocks, original)
})

test('la escala comparte las mismas horas en los siete días y conserva pausas, ausencias y turnos nocturnos', () => {
  const result = weekTimeline(employeeWeek(data, 'doctor', week, groups))
  assert.equal(result.start, 480)
  assert.equal(result.end, 960)
  assert.deepEqual(result.days[0].segments.map(s => [s.start, s.end, s.block.kind]), [[480, 540, 'shift'], [540, 600, 'consultation'], [600, 630, 'break'], [630, 720, 'consultation'], [720, 960, 'shift']])
  assert.equal(result.days[3].segments[0].block.kind, 'absence')
  const night = weekTimeline(employeeWeek(data, 'reception', week, groups))
  assert.equal(night.start, 0)
  assert.equal(night.end, 1440)
  assert.deepEqual(night.days[1].segments.map(s => [s.start, s.end]), [[1200, 1440]])
  assert.deepEqual(night.days[2].segments.map(s => [s.start, s.end]), [[0, 240]])
  assert.equal(minuteLabel(750), '12:30 PM')
  assert.equal(minuteLabel(1440), '12:00 AM')
  assert.equal(minuteLabel(780), '1:00 PM')
  assert.equal(formatStaffTime('18:00'), '6:00 PM')
  assert.equal(formatStaffTime('08:00'), '8:00 AM')
})

test('horario escolar: tres tramos generan tres filas, independientemente de cuántas horas duren', () => {
  const block = (id, kind, start, end) => ({ id, kind, active: true, starts_at: `2026-11-16T${start}:00-06:00`, ends_at: `2026-11-16T${end}:00-06:00` })
  for (const end of ['16:00', '22:00']) {
    const blocks = [block('shift', 'shift', '08:00', end), block('care', 'consultation', '08:00', end), block('lunch', 'break', '12:00', '12:30')]
    const result = schoolWeek([{ date: week, blocks }])
    assert.equal(result.rows.length, 3)
    assert.deepEqual(result.rows.map(r => r.cells[0].kind), ['consultation', 'break', 'consultation'])
    assert.equal(minuteLabel(result.rows[0].start), '8:00 AM')
    assert.equal(minuteLabel(result.rows[0].end), '12:00 PM')
  }
  assert.equal(schoolWeek([{ date: week, blocks: [] }]).rows.length, 0)
})

test('la vista activa no dibuja jornadas pasadas y conserva la búsqueda del empleado', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { StaffWeekCalendar } = await server.ssrLoadModule('/src/components/StaffWeekCalendar.tsx')
    const base = { data, groups, week, onWeek() {}, canEdit: true, busy: false, loading: false, onEdit() {}, onCreate() {}, onRefresh() {} }
    for (const person of [staff[0], staff[1], undefined]) {
      const html = renderToStaticMarkup(createElement(StaffWeekCalendar, { ...base, person }))
      for (const label of ['Semana anterior', 'Semana siguiente', '>Hoy<']) assert.ok(html.includes(label))
      assert.ok(!html.includes('Otra Persona'))
      assert.ok(!html.includes('staff-day-card-event'))
      if (person) assert.ok(html.includes('Historial'))
      else assert.ok(html.includes('Selecciona un empleado'))
    }
    const current = renderToStaticMarkup(createElement(StaffWeekCalendar, { ...base, person: staff[0], week: staffWeek() }))
    assert.ok(current.includes('staff-day-card'))
    const { StaffScheduleSearch } = await server.ssrLoadModule('/src/components/StaffScheduleSearch.tsx')
    const search = renderToStaticMarkup(createElement(StaffScheduleSearch, { matches: [staff[0]], query: 'maria', onQuery() {}, onSelect() {}, selectedId: 'doctor', disabled: false, loading: false }))
    assert.ok(search.includes('María Elena López'))
    assert.ok(search.includes('001'))
    assert.ok(search.includes('aria-pressed="true"'))
    assert.ok(!search.includes('<select'))
    const { StaffShiftsPage } = await server.ssrLoadModule('/src/pages/StaffShiftsPage.tsx')
    const page = renderToStaticMarkup(createElement(StaffShiftsPage))
    for (const label of ['Ver horario', 'Asignar jornada', 'Consultorios']) assert.ok(page.includes(label))
    assert.ok(!page.includes('Turnos de recepcionistas'))
    assert.ok(!page.includes('Horarios de doctores'))
    assert.match(page, /<option value="doctor"[^>]*>Doctor<\/option>/)
    assert.match(page, /<option value="recepcionista"[^>]*>Recepcionista<\/option>/)
  } finally { await server.close() }
})


test('filtros diurno y nocturno separan una jornada que cruza medianoche', async () => {
  const { filterWeekPeriod, schoolWeek } = await import('../src/lib/staffWeek.ts')
  const date = '2030-01-07'
  const calendar = [{ date, blocks: [{ id: 'night', kind: 'shift', active: true, starts_at: date + 'T00:00:00-06:00', ends_at: date + 'T08:00:00-06:00' }, { id: 'day', kind: 'shift', active: true, starts_at: date + 'T10:00:00-06:00', ends_at: date + 'T16:00:00-06:00' }] }]
  const day = schoolWeek(filterWeekPeriod(calendar, 'day'))
  const night = schoolWeek(filterWeekPeriod(calendar, 'night'))
  assert.deepEqual(day.rows.map(r => [r.start, r.end]), [[360,480],[600,960]])
  assert.deepEqual(night.rows.map(r => [r.start, r.end]), [[0,360]])
  assert.equal(filterWeekPeriod(calendar, 'all'), calendar)
  assert.equal(calendar[0].blocks[0].starts_at, date + 'T00:00:00-06:00')
})
