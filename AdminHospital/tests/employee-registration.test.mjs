import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmEmployeeRegistration } from '../src/lib/employeeRegistration.ts'

const input = { requestId: 'local-request', givenNames: 'Empleado', familyNames: 'Local', email: 'LOCAL@example.test', phone: '7777-1234', birthDate: '1990-01-01', city: 'San Salvador', role: 'doctor', specialties: ['1'], active: true }
const employee = { ...input, id: 'local-staff', profileId: 'local-profile', employeeCode: '007', email: 'local@example.test', staffVersion: '1', personVersion: '1' }

test('confirma ficha y datos persistidos antes de informar registro exitoso', async () => {
  const calls = []
  const confirmed = await confirmEmployeeRegistration({ success: true, staffId: employee.id }, input, async (action, data) => { calls.push([action, data]); return employee })
  assert.equal(confirmed.id, employee.id)
  assert.deepEqual(calls, [['detail', { id: employee.id }]])
})

test('versiones antiguas sin staffId se confirman por correo exacto y después por ficha', async () => {
  const calls = []
  await confirmEmployeeRegistration({ success: true }, input, async (action, data) => { calls.push([action, data]); return action === 'list' ? { employees: [employee, { ...employee, id: 'irrelevant', email: 'other@example.test' }] } : employee })
  assert.deepEqual(calls.map(c => c[0]), ['list', 'detail'])
})

test('rechaza respuestas falsas, registros ausentes y diferencias en los datos sin ejecutar create', async () => {
  let called = false
  await assert.rejects(confirmEmployeeRegistration({ success: false }, input, async () => { called = true }), /no confirmó/)
  assert.equal(called, false)
  await assert.rejects(confirmEmployeeRegistration({ success: true }, input, async () => ({ employees: [] })), /no confirma/)
  await assert.rejects(confirmEmployeeRegistration({ success: true, staffId: employee.id }, input, async action => { assert.equal(action, 'detail'); return { ...employee, active: false } }), /no confirma todos/)
})
