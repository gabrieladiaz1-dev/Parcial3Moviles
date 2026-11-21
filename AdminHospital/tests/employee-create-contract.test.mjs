import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as validation from '../supabase/functions/manage-employees/validation.ts'

// Exercise the actual backend validator, without Auth accounts, network or SQL writes.
const source = readFileSync(new URL('../supabase/functions/manage-employees/index.ts', import.meta.url), 'utf8')
const begin = source.indexOf('class Failure')
const end = source.indexOf('type EmployeeQuery')
const validators = source.slice(begin, end).replace(/^const admin =.*$/m, '').replace(/^const sql =.*$/m, '')
const context = vm.createContext({ ...validation, Intl, Date })
vm.runInContext(ts.transpileModule(`${validators}\nglobalThis.validateEmployee = validate`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText, context)
const values = { givenNames: 'Persona', familyNames: 'Prueba', email: 'controlled@example.test', phone: '7777-1234', role: 'doctor', specialties: ['1'], active: true }

test('create acepta doctor o recepción sin código ni contraseña aportados por ADMIN', () => {
  const doctor = context.validateEmployee(values)
  assert.equal(doctor.employeeCode, '')
  assert.equal(doctor.birthDate, '')
  assert.equal(doctor.city, '')
  const receptionist = context.validateEmployee({ ...values, role: 'receptionist', specialties: [] })
  assert.equal(receptionist.employeeCode, '')
  assert.ok(!('password' in doctor))
})

test('la validación identifica el campo exacto sin incluir datos personales', () => {
  for (const [key, value, label] of [['givenNames', '', 'nombres'], ['familyNames', '', 'apellidos'], ['email', '', 'correo electrónico'], ['phone', '', 'teléfono']]) {
    assert.throws(() => context.validateEmployee({ ...values, [key]: value }), error => error.code === 'INVALID_FIELD' && error.message.includes(label) && !error.message.includes(values.email))
  }
})

test('el alta usa contraseña inicial del servidor y asignación serializada del siguiente código', () => {
  assert.match(source, /initialPassword = temporaryEmployeePassword\(\)/)
  assert.match(source, /password: initialPassword/)
  assert.match(source, /validate\(\{ \.\.\.b, employeeCode: '' \}\)/)
  assert.match(source, /lock table public\.staff in share row exclusive mode/)
  assert.match(source, /payload\.employeeCode = nextEmployeeCode\(sequence\.last\)/)
})

test('la contraseña inicial coincide con la política solicitada por administración', () => {
  assert.equal(validation.temporaryEmployeePassword(), 'Gaby.0522123')
})
