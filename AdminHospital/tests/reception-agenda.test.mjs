import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { agendaCounts, appointmentMatches, availablePatientSlots, bookingCall, definitiveBookingFailure } from '../src/lib/receptionBooking.ts'
import { agendaMatches, slotGroups, bookingTime } from '../src/lib/receptionBooking.ts'

// Isolated synthetic inputs. This suite never connects to Supabase or writes patient data.
const slot = { doctor_id: 'doctor-a', doctor_name: 'Médico de prueba local', consulting_room_id: 'room-a', room_code: 'A', starts_at: '2030-01-02T08:00:00-06:00', ends_at: '2030-01-02T08:30:00-06:00', slot_minutes: 30 }
const intent = { patientId: 'local-patient', slot, specialtyId: 1, key: 'stable-local-key', reason: ' Consulta ', symptoms: ' Síntoma ' }
const now = Date.parse('2030-01-02T07:00:00-06:00')

test('vigencia usa el final exacto, incluye confirmadas y conserva consulta e historial', () => {
  const row = { status: 'programada', ends_at: '2030-01-02T07:00:00-06:00' }
  assert.equal(agendaMatches('programada', row, now), false)
  assert.equal(agendaMatches('history', row, now), true)
  assert.equal(agendaMatches('programada', { ...row, status: 'confirmada', ends_at: slot.ends_at }, now), true)
  assert.equal(agendaMatches('', { ...row, status: 'en_atencion' }, now), true)
  assert.equal(agendaMatches('en_atencion', { ...row, status: 'en_atencion' }, now), true)
  assert.equal(agendaMatches('history', { ...row, status: 'cancelada' }, now), true)
  assert.equal(row.status, 'programada', 'filtrar no simula el vencimiento del servidor')
})
test('horas nocturnas ordenan instantes completos y no duplican la misma opción', () => {
  const night = { ...slot, starts_at: '2030-01-02T22:00:00-06:00', ends_at: '2030-01-02T22:30:00-06:00' }
  const dawn = { ...slot, starts_at: '2030-01-03T00:00:00-06:00', ends_at: '2030-01-03T00:30:00-06:00' }
  const source = [dawn, night, { ...night }]
  const before = structuredClone(source)
  const groups = slotGroups(source)
  assert.deepEqual(groups.map(g => [g.date, g.period, g.slots.length]), [['2030-01-02', 'Noche', 1], ['2030-01-03', 'Madrugada', 1]])
  assert.deepEqual(source, before)
  assert.match(bookingTime(night.starts_at), /10:00/)
  assert.match(bookingTime(dawn.starts_at), /12:00/)
})
const available = (slots = [slot], booked = [], patientId = intent.patientId) => availablePatientSlots(slots, booked, new Set(['doctor-a']), patientId, now)

test('solicitud con expediente: conserva solicitud original y usa schedule_appointment', () => {
  const call = bookingCall({ ...intent, requestId: 'ios-request' })
  assert.equal(call.name, 'schedule_appointment')
  assert.deepEqual(call.args, { p_request: 'ios-request', p_patient: intent.patientId, p_doctor: slot.doctor_id, p_room: slot.consulting_room_id, p_start: slot.starts_at, p_end: slot.ends_at })
})

test('presencial con expediente: no crea usuarios, reutiliza contrato de atención e identidad verificada', () => {
  const call = bookingCall(intent)
  assert.equal(call.name, 'reception_walkin_attention')
  assert.equal(call.args.p_key, intent.key)
  assert.equal(call.args.p_values.identity_confirmed, true)
  assert.equal(call.args.p_values.mode, 'scheduled')
  assert.equal(call.args.p_values.reason, 'Consulta')
  assert.equal(call.args.p_values.symptoms, 'Síntoma')
})

test('reintentar conserva exactamente clave y payload; no genera solicitudes nuevas', () => {
  const before = structuredClone(intent)
  assert.deepEqual(bookingCall(intent), bookingCall(structuredClone(intent)))
  assert.deepEqual(intent, before)
  assert.ok(!definitiveBookingFailure(new TypeError('Failed to fetch')))
  assert.ok(!definitiveBookingFailure({ code: '57014' }))
  assert.ok(definitiveBookingFailure({ code: '23P01' }))
  assert.ok(definitiveBookingFailure({ code: '42501' }))
})

test('médico sin disponibilidad y horarios pasados no producen espacios reservables', () => {
  assert.deepEqual(available([]), [])
  assert.deepEqual(available([{ ...slot, starts_at: '2020-01-02T08:00:00-06:00' }]), [])
  assert.deepEqual(available([{ ...slot, doctor_id: 'inactive-or-other-specialty' }]), [])
})

test('excluye cruces de médico, consultorio y paciente; permite intervalos adyacentes', () => {
  for (const conflict of [{ doctor_id: slot.doctor_id }, { consulting_room_id: slot.consulting_room_id }, { patient_id: intent.patientId }]) {
    const booked = { doctor_id: 'other', consulting_room_id: 'other', patient_id: 'other', starts_at: '2030-01-02T08:10:00-06:00', ends_at: '2030-01-02T08:40:00-06:00', ...conflict }
    assert.deepEqual(available([slot], [booked]), [])
  }
  assert.equal(available([slot], [{ doctor_id: slot.doctor_id, consulting_room_id: slot.consulting_room_id, patient_id: intent.patientId, starts_at: slot.ends_at, ends_at: '2030-01-02T09:00:00-06:00' }]).length, 1)
})

test('recuperación identifica la cita por paciente, médico, sala y ambos extremos', () => {
  const appointment = { ...slot, patient_id: intent.patientId, status: 'programada' }
  assert.ok(appointmentMatches(appointment, intent.patientId, slot))
  assert.ok(!appointmentMatches({ ...appointment, status: 'cancelada' }, intent.patientId, slot))
  assert.ok(!appointmentMatches(appointment, 'other-patient', slot))
  assert.ok(!appointmentMatches({ ...appointment, ends_at: '2030-01-02T09:00:00-06:00' }, intent.patientId, slot))
})

test('contadores separan total, programadas, pendientes y en atención', () => {
  assert.deepEqual(agendaCounts(['programada', 'confirmada', 'en_atencion', 'completada', 'cancelada'].map(status => ({ status }))), { total: 5, scheduled: 1, waiting: 2, attending: 1 })
})

test('SQL preparado para solicitud y presencial sin expediente conserva identidad y unicidad', () => {
  const sql = readFileSync(new URL('../supabase/reception_agenda_workspace.sql', import.meta.url), 'utf8')
  assert.match(sql, /p_identity_confirmed IS DISTINCT FROM true/)
  assert.match(sql, /p\.profile_id IS DISTINCT FROM r\.requester_id/)
  assert.match(sql, /public\.link_attention_patient\(p_request,v_id,true\)/)
  assert.match(sql, /public\.create_walkin_patient\(v_first,v_last,v_dui,v_phone,v_birth,v_city,v_email\)/)
  assert.match(sql, /ON CONFLICT\(patient_id\) DO NOTHING/)
  assert.match(sql, /FOR UPDATE/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /FROM PUBLIC,anon/)
  assert.ok(!/\b(?:ALTER TABLE|CREATE TABLE|CREATE POLICY|DELETE FROM|auth\.users)\b/i.test(sql))
  const scheduling = readFileSync(new URL('../supabase/reception_workflow.sql', import.meta.url), 'utf8')
  assert.match(scheduling, /private\.planning_valid_slot\(p_doctor,p_room,p_start,p_end\)/)
  assert.match(scheduling, /v_id IS NOT NULL AND r\.status='agendada' THEN RETURN v_id/)
})

test('detecta horario ocupado por otra recepcionista', async () => {
  const { sameSlot, isSlotConflict } = await import('../src/lib/receptionBooking.ts')
  assert.equal(sameSlot(slot, structuredClone(slot)), true)
  assert.equal(sameSlot(slot, { ...slot, consulting_room_id: 'otro' }), false)
  assert.equal(isSlotConflict({ code: '23P01' }), true)
  assert.equal(isSlotConflict({ code: '23505' }), false)
})
