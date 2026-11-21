// In-memory handler tests: no network, real accounts, or database writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { employeeContract } from '../supabase/functions/manage-employees/contract.ts'
import * as validation from '../supabase/functions/manage-employees/validation.ts'

const source = readFileSync(new URL('../supabase/functions/manage-employees/index.ts', import.meta.url), 'utf8')
  .replace(/import \{ createClient \} from '[^']+'/, 'const { createClient } = testServices')
  .replace(/import \{ employeeContract \} from '[^']+'/, 'const { employeeContract } = testServices')
  .replace(/import postgres from '[^']+'/, 'const { postgres } = testServices')
  .replace(/import \{([^}]+)\} from '\.\/validation.ts'/, 'const {$1} = testServices.validation')
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
const caller = '00000000-0000-4000-8000-000000000001'
const profile = '00000000-0000-4000-8000-000000000002'
const staffId = '00000000-0000-4000-8000-000000000003'

function harness(options = {}) {
  let handler
  let persisted = { active: true, rolesActive: true, deleted: false, banned: Boolean(options.externalBan),
    roles: [{ role: 'doctor', active: true }, ...(options.extraLaborRole ? [{ role: 'enfermera', active: true }, { role: 'recepcionista', active: false }] : [])], givenNames: 'Persona', familyNames: 'Prueba', phone: '7777-1234', birthDate: '1990-01-01', city: 'San Salvador', specialties: ['1'], metadata: {}, bannedUntil: options.externalBan ? '2126-01-01T00:00:00Z' : null }
  const employee = state => ({ id: staffId, profileId: profile, employeeCode: '005', role: 'doctor', active: state.active && state.rolesActive,
    givenNames: state.givenNames, familyNames: state.familyNames, phone: state.phone, birthDate: state.birthDate, city: state.city, email: 'controlled@example.test', specialties: [...state.specialties], staffVersion: 'staff-v1', personVersion: 'person-v1' })
  const writes = []
  const authAdmin = { auth: { getUser: async () => ({ data: { user: { id: caller } }, error: null }) }, from: () => {
    const chain = { select: () => chain, eq: () => chain, order: async () => ({ data: [{ id: 1, name: 'Control local' }], error: null }), maybeSingle: async () => ({ data: options.unauthorized ? null : { user_id: caller }, error: null }) }
    return chain
  } }
  const sql = { begin: async callback => {
    const state = structuredClone(persisted)
    const tx = async (parts, ...values) => {
      const query = parts.join('?').replace(/\s+/g, ' ').trim()
      if (query.startsWith('select set_config') || query.includes('pg_advisory_xact_lock')) return []
      if (query.includes('user_roles') && query.endsWith('for share')) return options.revoked ? [] : [{ user_id: caller }]
      if (query.startsWith('select s.*')) return [{ id: staffId, profile_id: options.self ? caller : profile, employee_code: '005', category: 'doctor', active: state.active, version: 'person-v1', staff_version: 'staff-v1' }]
      if (query.startsWith('select user_id')) return options.targetAdmin ? [{ user_id: profile }] : []
      if (query.startsWith('select role::text as role,active')) return state.roles.map(role => ({ ...role }))
      if (query.startsWith('select not exists(select 1 from public.user_roles')) return [{ valid: !options.roleReadbackFailure && state.roles.every(role => role.role === 'paciente' || !role.active) }]
      if (query.startsWith('select raw_app_meta_data')) return [{ raw_app_meta_data: { ...state.metadata, employee_deleted: Boolean(options.alreadyDeleted) }, banned_until: state.bannedUntil }]
      if (query.startsWith('select s.id, s.profile_id')) return state.deleted ? [] : [{ ...employee(state), ...(options.corruptReadback ? { givenNames: 'No coincide' } : {}) }]
      if (query.startsWith('select (select count')) return [{ pendingAppointments: options.pendingAppointments ?? 0, assignedPatients: options.assignedPatients ?? 0, openEncounters: options.openEncounters ?? 0 }]
      if (query.startsWith('select case when')) return [{ valid: !options.authReadbackFailure && state.banned !== values[0] }]
      if (query.startsWith('select not s.active')) return [{ valid: !options.readbackFailure && !state.active && !state.rolesActive && state.deleted && state.banned }]
      if (query.startsWith('select email')) return [{ email: 'controlled@example.test' }]
      if (query.startsWith('select id from public.specialties')) return options.invalidSpecialty ? [] : [{ id: values[0] }]
      writes.push(query)
      if (query.startsWith('update public.staff')) state.active = query.includes('active=false') ? false : values[0]
      else if (query.startsWith('select public.set_employee_role')) state.rolesActive = values[2]
      else if (query.startsWith('update public.user_roles')) {
        if (query.includes('set active=true')) {
          const restore = values[1]
          state.roles = state.roles.map(role => restore.includes(role.role) ? { ...role, active: true } : role)
        } else state.roles = state.roles.map(role => role.role !== 'paciente' ? { ...role, active: false } : role)
        state.rolesActive = state.roles.find(role => role.role === 'doctor').active
      }
      else if (query.startsWith('update public.profiles')) Object.assign(state, { givenNames: values[0], familyNames: values[1], phone: values[2], birthDate: values[3], city: values[4] })
      else if (query.startsWith('delete from public.doctor_specialties')) state.specialties = []
      else if (query.startsWith('insert into public.doctor_specialties')) state.specialties.push(values[1])
      else if (query.startsWith('update auth.users')) {
        if (query.includes("'employee_deleted'")) { state.deleted = true; state.banned = true }
        else if (query.includes("'employee_access_disabled',true")) {
          state.metadata = { employee_access_roles: values[0], employee_access_disabled: true, employee_access_previous_ban: state.metadata.employee_access_disabled ? state.metadata.employee_access_previous_ban : state.bannedUntil, employee_access_ban_until: '2126-11-18T00:00:00Z' }
          state.bannedUntil = state.metadata.employee_access_ban_until; state.banned = true
        } else { state.bannedUntil = state.metadata.employee_access_previous_ban; state.metadata = {}; state.banned = false }
      }
      else if (query.startsWith('insert into public.audit_logs')) { if (options.auditFailure) throw new Error('Simulated rollback') }
      else throw new Error(`Unexpected SQL in scoped test: ${query}`)
      return []
    }
    tx.json = value => {
      assert.ok(Array.isArray(value), 'Role grants must be encoded as a JSON array, never a JSON string')
      return value
    }
    await callback(tx)
    persisted = state
  } }
  const context = vm.createContext({ Request, Response, Intl, Date, testServices: { validation, employeeContract, createClient: () => authAdmin, postgres: () => sql }, Deno: { env: { get: () => 'in-memory' }, serve: value => { handler = value } } })
  vm.runInContext(code, context)
  return { state: () => ({ active: persisted.active, rolesActive: persisted.rolesActive, deleted: persisted.deleted, banned: persisted.banned }), employee: () => employee(persisted), roles: () => structuredClone(persisted.roles), writes, invoke: async (values = {}) => {
    const response = await handler(new Request('https://local.invalid/manage-employees', { method: 'POST', headers: { Authorization: 'Bearer in-memory', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'state', active: false, id: staffId, staffVersion: 'staff-v1', personVersion: 'person-v1', confirmationCode: '005', ...values }) }))
    return { status: response.status, body: await response.json() }
  } }
}

for (const [title, options, expected] of [
  ['usuario sin permiso administrativo', { unauthorized: true }, 403],
  ['permiso revocado antes de la transacción', { revoked: true }, 403],
  ['intento de desactivar la cuenta propia', { self: true }, 403],
  ['intento de desactivar un administrador', { targetAdmin: true }, 403],
  ['empleado ya eliminado', { alreadyDeleted: true }, 409],
]) test(`rechaza ${title} sin cambiar datos`, async () => {
  const app = harness(options)
  assert.equal((await app.invoke()).status, expected)
  assert.equal(app.writes.length, 0)
  assert.equal(app.state().active, true)
})

test('expone contrato autenticado y clasifica operaciones desconocidas sin escrituras', async () => {
  const app = harness()
  const contract = await app.invoke({ action: 'contract' })
  assert.equal(contract.status, 200)
  assert.equal(contract.body.version, employeeContract.version)
  assert.equal(contract.body.actions.includes('delete'), false)
  assert.ok(contract.body.features.includes('auth-state-control'))
  const catalogs = await app.invoke({ action: 'catalogs' })
  assert.equal(catalogs.status, 200)
  assert.equal(catalogs.body.contract.version, employeeContract.version)
  assert.ok(catalogs.body.contract.features.includes('auth-state-control'))
  assert.ok(catalogs.body.contract.features.includes('deactivation-impact'))
  assert.deepEqual(catalogs.body.specialties, [{ id: '1', name: 'Control local' }])
  const invalid = await app.invoke({ action: 'unsupported' })
  assert.equal(invalid.body.code, 'OPERATION_NOT_SUPPORTED')
  assert.equal(app.writes.length, 0)
})

test('desactiva y reactiva sin crear cuentas ni alterar contraseñas; devuelve estado confirmado', async () => {
  const app = harness()
  const disabled = await app.invoke({ action: 'state', active: false })
  assert.equal(disabled.status, 200)
  assert.equal(disabled.body.employee.active, false)
  assert.deepEqual(app.state(), { active: false, rolesActive: false, deleted: false, banned: true })
  const enabled = await app.invoke({ action: 'state', active: true })
  assert.equal(enabled.status, 200)
  assert.equal(enabled.body.employee.active, true)
  assert.deepEqual(app.state(), { active: true, rolesActive: true, deleted: false, banned: false })
  assert.ok(app.writes.every(query => !query.includes('password') && !query.includes('insert into auth.users')))
})

test('reactivación conserva bloqueos ajenos al módulo', async () => {
  const app = harness({ externalBan: true })
  assert.equal((await app.invoke({ action: 'state', active: true })).status, 409)
  assert.equal(app.writes.length, 0)
  assert.equal(app.state().banned, true)
})

test('edición devuelve perfil persistido y conserva correo, código y cuenta', async () => {
  const app = harness()
  const result = await app.invoke({ action: 'update', values: { given_names: 'Nombre editado', family_names: 'Apellido editado', phone: '7000-1234', birth_date: '1980-02-29', city: 'Santa Tecla', employee_code: '999', email: 'otro@example.test', password: 'ignored', specialties: ['2'] } })
  assert.equal(result.status, 200)
  assert.equal(result.body.employee.givenNames, 'Nombre editado')
  assert.equal(result.body.employee.familyNames, 'Apellido editado')
  assert.equal(result.body.employee.phone, '7000-1234')
  assert.equal(result.body.employee.city, 'Santa Tecla')
  assert.deepEqual(result.body.employee.specialties, ['2'])
  assert.equal(result.body.employee.employeeCode, '005')
  assert.equal(result.body.employee.email, 'controlled@example.test')
  assert.equal(result.body.employee.profileId, profile)
  assert.equal('credentials' in result.body, false)
  assert.ok(app.writes.every(query => !query.includes('password') && !query.includes('update auth.users') && !query.includes('set employee_code')))
})

test('una especialidad inválida revierte la edición completa', async () => {
  const app = harness({ invalidSpecialty: true })
  const before = app.employee()
  const result = await app.invoke({ action: 'update', values: { given_names: 'No persistir', family_names: 'Prueba', phone: '7000-1234', birth_date: '1980-01-01', city: 'Santa Tecla', specialties: ['999'] } })
  assert.equal(result.status, 409)
  assert.deepEqual(app.employee(), before)
})

test('la desactivación repetida conserva el bloqueo original para reactivar correctamente', async () => {
  const app = harness()
  assert.equal((await app.invoke({ action: 'state', active: false })).status, 200)
  assert.equal((await app.invoke({ action: 'state', active: false })).status, 200)
  assert.equal((await app.invoke({ action: 'state', active: true })).status, 200)
  assert.equal(app.state().banned, false)
})

test('datos distintos en la lectura de confirmación revierten la edición', async () => {
  const app = harness({ corruptReadback: true })
  const before = app.employee()
  const result = await app.invoke({ action: 'update', values: { given_names: 'Nombre editado', family_names: 'Prueba', phone: '7000-1234', birth_date: '1980-01-01', city: 'Santa Tecla', specialties: ['2'] } })
  assert.equal(result.status, 409)
  assert.deepEqual(app.employee(), before)
})

test('fallo al confirmar bloqueo Auth revierte permisos y estado', async () => {
  const app = harness({ authReadbackFailure: true })
  assert.equal((await app.invoke({ action: 'state', active: false })).status, 409)
  assert.deepEqual(app.state(), { active: true, rolesActive: true, deleted: false, banned: false })
})

test('eliminación retirada rechaza incluso clientes anteriores sin escrituras', async () => {
  const app = harness()
  const result = await app.invoke({ action: 'delete' })
  assert.equal(result.status, 410)
  assert.equal(result.body.code, 'EMPLOYEE_DELETE_REMOVED')
  assert.equal(app.writes.length, 0)
})

test('protección de cualquier administrador incluye la última cuenta administradora activa', async () => {
  const app = harness({ targetAdmin: true })
  assert.equal((await app.invoke({ action: 'state', active: false })).status, 403)
  assert.equal(app.writes.length, 0)
})

test('citas y pacientes requieren confirmación explícita de las asignaciones actuales', async () => {
  const app = harness({ pendingAppointments: 2, assignedPatients: 3, openEncounters: 1 })
  const denied = await app.invoke()
  assert.equal(denied.status, 409)
  assert.equal(denied.body.code, 'IMPACT_CONFIRMATION_REQUIRED')
  assert.equal(app.writes.length, 0)
  const stale = await app.invoke({ impactAcknowledged: true, impact: { pendingAppointments: 1, assignedPatients: 3, openEncounters: 1 } })
  assert.equal(stale.status, 409)
  assert.equal(app.writes.length, 0)
  const accepted = await app.invoke({ impactAcknowledged: true, impact: { pendingAppointments: 2, assignedPatients: 3, openEncounters: 1 } })
  assert.equal(accepted.status, 200)
  assert.deepEqual(app.state(), { active: false, rolesActive: false, deleted: false, banned: true })
  assert.ok(app.writes.every(query => !query.includes('update public.appointments') && !query.includes('update public.care_team_assignments') && !query.includes('update public.clinical_encounters')))
})

test('fallo en auditoría revierte la desactivación y conserva el acceso anterior', async () => {
  const app = harness({ auditFailure: true })
  assert.equal((await app.invoke()).status, 409)
  assert.deepEqual(app.state(), { active: true, rolesActive: true, deleted: false, banned: false })
})

test('revoca todos los roles laborales de sesiones existentes y restaura solo los autorizados', async () => {
  const app = harness({ extraLaborRole: true })
  const original = app.roles()
  assert.equal((await app.invoke()).status, 200)
  assert.ok(app.roles().every(role => !role.active))
  assert.equal((await app.invoke({ active: true })).status, 200)
  assert.deepEqual(app.roles(), original)
  assert.equal(app.roles().length, 3)
  assert.ok(app.writes.every(query => !query.includes('insert into public.user_roles')))
})

test('no confirma desactivación si falla la comprobación de revocación de roles', async () => {
  const app = harness({ extraLaborRole: true, roleReadbackFailure: true })
  const original = app.roles()
  assert.equal((await app.invoke()).status, 409)
  assert.deepEqual(app.roles(), original)
  assert.equal(app.state().active, true)
  assert.equal(app.state().banned, false)
})
