// PREPARED ONLY. Explicitly refuses the production project before any request.
// Run after separate staging authorization. Tokens remain in process memory.
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { productionProjectRef, resolveSupabaseUrl } from '../src/lib/supabaseConfig.ts'
import { addDays, atMidnight, hospitalDate, selectedDates } from '../src/lib/planningDates.ts'

const ref = process.env.PLANNING_ACCEPTANCE_PROJECT_REF ?? process.env.VITE_STAGING_SUPABASE_PROJECT_REF
const candidate = process.env.PLANNING_ACCEPTANCE_URL ?? process.env.VITE_SUPABASE_URL
const url = resolveSupabaseUrl(candidate, 'staging', ref)
assert.ok(ref && ref !== productionProjectRef && url, 'Only a distinct, explicit staging project is allowed; production is forbidden')
assert.equal(process.env.PLANNING_ACCEPTANCE_ALLOW_WRITES, 'staging-only', 'Staging writes must be explicitly enabled for this test')
const key = process.env.PLANNING_ACCEPTANCE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const token = process.env.PLANNING_ACCEPTANCE_ADMIN_TOKEN
assert.ok(key && token, 'Supply staging publishable key and a temporary staging administrator session')
const doctorId = process.env.PLANNING_ACCEPTANCE_DOCTOR_ID
const receptionistId = process.env.PLANNING_ACCEPTANCE_RECEPTIONIST_ID
assert.ok(doctorId && receptionistId && doctorId !== receptionistId, 'Two distinct synthetic employees are required')
const date = process.env.PLANNING_ACCEPTANCE_DATE ?? addDays(hospitalDate(), 7)
selectedDates(date, date, [0, 1, 2, 3, 4, 5, 6])
assert.ok(date > hospitalDate(), 'Choose a future date in Guatemala')
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
})
function check(result, phase) {
  if (result.error) throw new Error(`${phase}: ${result.error.code ?? ''} ${result.error.message}`)
  return result.data
}
const identity = check(await client.auth.getUser(token), 'Validate staging session').user
const admin = check(await client.from('user_roles').select('user_id').eq('user_id', identity.id).eq('role', 'admin').eq('active', true).maybeSingle(), 'Verify administrator role')
assert.ok(admin, 'An active administrator role is required')
const people = check(await client.from('staff').select('id,profile_id,employee_code,category,active').in('id', [doctorId, receptionistId]), 'Read synthetic staff')
for (const [id, category] of [[doctorId, 'doctor'], [receptionistId, 'recepcionista']]) {
  const staff = people.find(p => p.id === id)
  assert.ok(staff?.active && staff.category === category && staff.employee_code.startsWith('STG-PLAN-') && staff.profile_id !== identity.id, 'Use only synthetic STG-PLAN- employees, not a copied real employee or the administrator')
  const role = check(await client.from('user_roles').select('role').eq('user_id', staff.profile_id).eq('role', category).eq('active', true).maybeSingle(), 'Verify employee role')
  assert.ok(role)
}
const room = check(await client.from('consulting_rooms').select('id,code').eq('code', process.env.PLANNING_ACCEPTANCE_ROOM_CODE ?? 'CONS-01').eq('active', true).single(), 'Read active consulting room')
const created = []
async function save(label, kind, values) {
  const result = check(await client.rpc('save_staff_planning', { p_kind: kind, p_values: values, p_id: null, p_version: null }), label)
  assert.ok(result.id && result.count === 1)
  created.push({ label, id: result.id })
  return result.id
}
try {
  const doctorShift = await save('Doctor work shift', 'shift', { staff_id: doctorId, dates: [date], start_time: '08:00', end_time: '16:00', shift_type: 'ordinario', active: true })
  const consultation = await save('Doctor consultation', 'consultation', { staff_id: doctorId, dates: [date], start_time: '09:00', end_time: '12:00', room_id: room.id, slot_minutes: 30, active: true })
  const receptionistShift = await save('Receptionist night shift', 'shift', { staff_id: receptionistId, dates: [date], start_time: '22:00', end_time: '06:00', shift_type: 'ordinario', active: true })
  const plan = check(await client.rpc('read_staff_planning', { p_from: atMidnight(date), p_until: atMidnight(addDays(date, 2)) }), 'Read saved plan')
  assert.ok(plan.ready)
  const work = plan.shifts.find(s => s.id === doctorShift)
  const reception = plan.shifts.find(s => s.id === receptionistShift)
  const medical = plan.consultations.find(c => c.id === consultation)
  assert.ok(work?.staff_id === doctorId && work.status !== 'cancelado')
  assert.ok(reception?.staff_id === receptionistId && reception.status !== 'cancelado')
  assert.equal(new Date(reception.ends_at).getTime() - new Date(reception.starts_at).getTime(), 8 * 3600000)
  assert.equal(hospitalDate(reception.ends_at), addDays(date, 1))
  assert.ok(medical?.active && medical.doctor_id === doctorId && medical.consulting_room_id === room.id && medical.slot_minutes === 30)
  const medicalHours = check(await client.from('doctor_schedules').select('id').eq('consulting_assignment_id', consultation).eq('active', true), 'Read linked medical schedule')
  assert.equal(medicalHours.length, 1)
  const slots = check(await client.rpc('get_medical_availability', { p_from: atMidnight(date), p_until: atMidnight(addDays(date, 1)), p_doctor: doctorId, p_room: room.id }), 'Read availability')
  assert.equal(slots.length, 6)
  for (const slot of slots) {
    assert.equal(slot.slot_minutes, 30)
    assert.equal(new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime(), 30 * 60000)
  }
  console.log(JSON.stringify({ result: 'PASS', scope: 'staging-only', date, room: room.code, created, availableSlots: slots.length }, null, 2))
  console.log('No patients or appointments were created. Verify the calendar visually. These staging records remain for inspection.')
} catch (error) {
  console.error(JSON.stringify({ result: 'FAIL', scope: 'staging-only', created, message: error.message }, null, 2))
  console.error('Each successful RPC committed separately. Inspect the listed staging IDs before correcting or retrying; no automatic deletion is performed.')
  process.exitCode = 1
}
