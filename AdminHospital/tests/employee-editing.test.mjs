import test from 'node:test'
import assert from 'node:assert/strict'
import { employeeUpdatePayload, employeeUpdateMatches } from '../src/lib/employeeEditing.ts'

const employee = { id: 'controlled-staff', profileId: 'controlled-profile', employeeCode: '005', givenNames: 'Nombre', familyNames: 'Apellido', email: 'controlled@example.test', role: 'doctor', active: true, staffVersion: 'staff-v1', personVersion: 'person-v1', phone: '7000-1234', city: 'San Salvador', birthDate: '1980-01-01', specialties: ['1'] }
const form = { ...employee, requestId: 'local-only', employeeCode: '999', givenNames: ' Nombre editado ', city: ' Santa Tecla ' }

test('edición incluye el código original que exige el backend anterior', () => {
  const payload = employeeUpdatePayload(employee, form)
  // This was the missing required value in the original deployed validate contract.
  assert.equal(payload.values.employee_code, '005')
  assert.ok(payload.values.employee_code.trim())
  assert.equal(payload.id, employee.id)
  assert.equal(payload.staffVersion, employee.staffVersion)
  assert.equal(payload.personVersion, employee.personVersion)
  assert.equal(payload.values.given_names, 'Nombre editado')
  assert.equal(payload.values.city, 'Santa Tecla')
  for (const key of ['password', 'email', 'role', 'active', 'profile_id']) assert.equal(key in payload.values, false)
})

test('no confirma guardado si la lectura devuelve los valores anteriores', () => {
  assert.equal(employeeUpdateMatches(employee, employee, form), false)
  const saved = { ...employee, givenNames: 'Nombre editado', city: 'Santa Tecla' }
  assert.equal(employeeUpdateMatches(saved, employee, form), true)
  for (const changed of [{ id: 'other' }, { profileId: 'other' }, { employeeCode: '999' }, { email: 'other@example.test' }, { specialties: [] }]) assert.equal(employeeUpdateMatches({ ...saved, ...changed }, employee, form), false)
})

test('compara especialidades sin depender del orden y normaliza los campos opcionales vacíos', () => {
  const optional = { ...form, city: '', birthDate: '', specialties: ['1', '2'] }
  assert.equal(employeeUpdateMatches({ ...employee, givenNames: 'Nombre editado', city: null, birthDate: null, specialties: ['2', '1'] }, employee, optional), true)
})
