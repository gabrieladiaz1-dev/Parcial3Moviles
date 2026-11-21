import test from 'node:test'
import assert from 'node:assert/strict'
import { invokePlanningRpc, planningError } from '../src/lib/planningRpc.ts'
import { confirmRecurringScope, confirmRecurringWrite } from '../src/lib/planningPersistence.ts'

// Transport fixtures only. Production always uses the shared authenticated Supabase client.
test('sin sesión no se envían RPC anónimas y con sesión se conservan nombre y parámetros', async () => {
  let calls = 0
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: null }) }, rpc: async (name, args) => { calls++; return { data: { name, args }, error: null } } }
  await assert.rejects(invokePlanningRpc(client, 'read_staff_planning', {}), error => error.code === 'AUTH_SESSION_MISSING')
  assert.equal(calls, 0)
  client.auth.getSession = async () => ({ data: { session: { user: { id: 'local-admin' } } }, error: null })
  const args = { p_values: { staff_id: 'test-person' }, p_id: null, p_version: null, p_key: 'stable-test-operation' }
  assert.deepEqual(await invokePlanningRpc(client, 'save_recurring_journey', args), { name: 'save_recurring_journey', args })
  assert.equal(calls, 1)
})

test('distingue red, sesión, permisos, RLS, clave inválida y firma RPC', () => {
  for (const [source, category, status] of [[new TypeError('Failed to fetch'), 'network'], [{ code: 'PGRST301', message: 'JWT expired' }, 'authentication'], [{ code: '42501', message: 'permission denied for function' }, 'permissions'], [{ code: '42501', message: 'new row violates row-level security policy' }, 'rls'], [{ code: 'PGRST202', message: 'Could not find the function' }, 'rpc'], [{ message: 'Invalid API key' }, 'configuration', 401]]) {
    const error = planningError('read_staff_planning', source, status)
    assert.equal(error.category, category)
    assert.ok(error.message.includes('read_staff_planning'))
  }
})

const values = { staff_id: 'local-doctor', valid_from: '2030-01-07', valid_until: null, active: true, weekdays: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '16:00', shift_type: 'ordinario', room_id: 'local-room', specialty_id: 1, specialty_ids: [1], breaks: [{ start_time: '12:00', end_time: '12:30', reason: 'Almuerzo' }], consultations: [{ start_time: '08:00', end_time: '16:00', slot_minutes: 30 }] }
const saved = { ...values, id: 'saved-version', staff_role: 'doctor', consulting_room_id: values.room_id, closed_on: null, version: '1', start_time: '08:00:00', end_time: '16:00:00' }
const snapshot = { recurring_ready: true, recurring_journeys: [saved], shifts: [] }
test('éxito exige releer la versión, confirmar una semana futura y consultar disponibilidad real', async () => {
  const calls = []
  await confirmRecurringWrite({ read: async week => { calls.push(['read', week]); return week === '2030-01-07' ? snapshot : { ...snapshot, shifts: [{ recurring_id: saved.id, staff_id: saved.staff_id, status: 'programado' }] } }, availability: async (...args) => { calls.push(['availability', ...args]); return [] } }, values, saved.id)
  assert.deepEqual(calls, [['read', '2030-01-07'], ['read', '2030-02-04'], ['availability', '2030-02-04', 'local-doctor', 'local-room']])
})

test('respuesta de guardado sin datos persistidos o con valores diferentes no muestra éxito', async () => {
  for (const result of [{ ...snapshot, recurring_journeys: [] }, { ...snapshot, recurring_journeys: [{ ...saved, end_time: '17:00:00' }] }]) {
    await assert.rejects(confirmRecurringWrite({ read: async () => result, availability: async () => [] }, values, saved.id), error => error.code === 'SAVE_UNCONFIRMED')
  }
  await assert.rejects(confirmRecurringWrite({ read: async () => { throw planningError('read_staff_planning', { code: '42501', message: 'permission denied' }) }, availability: async () => [] }, values, saved.id), error => error.code === 'SAVE_UNCONFIRMED' && error.message.includes('42501'))
})

test('edición comprueba cierre anterior y desactivación comprueba fecha e inexistencia de nuevas ocurrencias', async () => {
  const previous = { ...saved, id: 'previous', valid_from: '2029-01-01' }
  const final = { ...snapshot, recurring_journeys: [saved, { ...previous, active: false, closed_on: values.valid_from }], shifts: [{ recurring_id: saved.id, staff_id: saved.staff_id, status: 'programado' }] }
  await confirmRecurringWrite({ read: async () => final, availability: async () => [] }, values, saved.id, previous)
  await assert.rejects(confirmRecurringWrite({ read: async () => ({ ...final, recurring_journeys: [saved, previous] }), availability: async () => [] }, values, saved.id, previous), error => error.code === 'SAVE_UNCONFIRMED')
  const closed = { ...snapshot, recurring_journeys: [{ ...saved, active: false, closed_on: values.valid_from }] }
  await confirmRecurringWrite({ read: async () => closed, availability: async () => { throw new Error('No debe consultar nuevos espacios al desactivar') } }, { staff_id: saved.staff_id, valid_from: values.valid_from, active: false }, saved.id)
  await assert.rejects(confirmRecurringWrite({ read: async () => ({ ...closed, shifts: [{ recurring_id: saved.id, staff_id: saved.staff_id, starts_at: '2030-01-08T08:00:00-06:00', status: 'programado' }] }), availability: async () => [] }, { staff_id: saved.staff_id, valid_from: values.valid_from, active: false }, saved.id), error => error.code === 'SAVE_UNCONFIRMED')
})

test('editar un día confirma que los restantes conservan horas, descansos, consultorio y atención', async () => {
  const original = { ...saved, weekdays: [1,2,3,4,5,6] }
  const kept = { ...original, id: 'remaining', weekdays: [1,2,3,4,5], valid_from: values.valid_from }
  const scope = { weekday: 6, originals: [original] }
  await confirmRecurringScope(async () => ({ recurring_journeys: [kept] }), values, original, scope)
  for (const patch of [{ end_time: '12:00:00' }, { breaks: [] }, { consulting_room_id: 'different-room' }, { weekdays: [1,2,3,4] }]) {
    await assert.rejects(confirmRecurringScope(async () => ({ recurring_journeys: [{ ...kept, ...patch }] }), values, original, scope), e => e.code === 'SAVE_UNCONFIRMED')
  }
})

test('jornada completa confirma todas las versiones anteriores, incluso después de editar un día', async () => {
  const originals = [{ ...saved, id: 'weekdays' }, { ...saved, id: 'saturday', weekdays: [6] }]
  const versions = originals.map(j => ({ ...j, active: false, closed_on: values.valid_from }))
  await confirmRecurringScope(async () => ({ recurring_journeys: versions }), values, originals[0], { weekday: null, originals })
  await assert.rejects(confirmRecurringScope(async () => ({ recurring_journeys: versions.slice(0,1) }), values, originals[0], { weekday: null, originals }), e => e.code === 'SAVE_UNCONFIRMED')
})


test('adelantar una jornada futura conserva su inicio hist?rico y la vigencia de los otros d?as', async () => {
  const previous = { ...saved, id: 'future-original', valid_from: '2030-01-10', weekdays: [1,2,3,4,5,6] }
  const closed = { ...previous, active: false, closed_on: previous.valid_from }
  const kept = { ...previous, id: 'remaining', weekdays: [1,2,3,4,5] }
  const final = { recurring_journeys: [saved, closed, kept], shifts: [{ recurring_id: saved.id, staff_id: saved.staff_id, status: 'programado' }] }
  await confirmRecurringWrite({ read: async () => final, availability: async () => [] }, values, saved.id, previous)
  await confirmRecurringScope(async () => final, values, previous, { weekday: null, originals: [previous] })
  await confirmRecurringScope(async () => final, values, previous, { weekday: 6, originals: [previous] })
  await assert.rejects(confirmRecurringScope(async () => ({ ...final, recurring_journeys: [saved, closed, { ...kept, valid_from: values.valid_from }] }), values, previous, { weekday: 6, originals: [previous] }), e => e.code === 'SAVE_UNCONFIRMED')
})
