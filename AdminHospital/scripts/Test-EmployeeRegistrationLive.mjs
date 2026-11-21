// Authorized live acceptance test. Only unique, temporary accounts created here are changed.
// Passwords/JWTs stay in memory. Cleanup is restricted by run-specific emails and markers.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { connectHospitalMcp, hospitalProject } from './lib/supabaseMcp.mjs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const url = env.VITE_SUPABASE_URL
if (new URL(url).hostname !== `${hospitalProject}.supabase.co`) throw new Error('Wrong project')
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
const newClient = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const mcp = await connectHospitalMcp()
const run = randomUUID().replaceAll('-', '')
const adminEmail = `mcp-registration-admin-${run}@example.com`
const emails = [adminEmail]
const clients = []
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const query = async sql => { const rows = await mcp.call('execute_sql', { query: sql }); if (!Array.isArray(rows)) throw new Error('Unexpected SQL response'); return rows }
const report = (step, extra = {}) => console.log(JSON.stringify({ step, ...extra }))
let adminId, adminSession, cleanupSucceeded = false
let firstFailure
try {
  const bootstrap = newClient(); clients.push(bootstrap)
  const adminPassword = randomBytes(24).toString('hex') + 'Aa7!'
  const signup = await bootstrap.auth.signUp({ email: adminEmail, password: adminPassword, options: { data: { first_name: 'Prueba MCP', last_name: run, hospital_test_run: run } } })
  if (signup.error) throw new Error(`Temporary test signup failed: ${signup.error.message}`)
  adminId = signup.data.user?.id
  if (!adminId) throw new Error('Test signup did not return an identity')
  // Confirm and promote only the freshly created identity with our exact, unique marker.
  const promoted = await query(`with owned as (update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id=${literal(adminId)}::uuid and email=${literal(adminEmail)} and raw_user_meta_data->>'hospital_test_run'=${literal(run)} returning id) insert into public.user_roles(user_id,role,active) select id,'admin',true from owned on conflict(user_id,role) do update set active=true returning user_id;`)
  assert.equal(promoted.length, 1)
  const adminLogin = await bootstrap.auth.signInWithPassword({ email: adminEmail, password: adminPassword })
  assert.ifError(adminLogin.error)
  adminSession = adminLogin.data.session
  report('temporary_admin_ready')
  async function invoke(action, data = {}, token = adminSession.access_token) {
    const response = await fetch(`${url}/functions/v1/manage-employees`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(45000) })
    const body = await response.json()
    if (response.status >= 400 && body?.error) report('service_rejection', { action, status: response.status, code: body.code ?? null, error: body.error })
    return { status: response.status, body }
  }
  const catalog = await invoke('catalogs')
  assert.equal(catalog.status, 200)
  assert.equal(catalog.body.contract.version, 'employees-2026-11-registration-v4')
  assert.ok(catalog.body.specialties.length)
  const passwords = new Set()
  const codes = []
  for (const role of ['doctor', 'receptionist']) {
    const email = `mcp-registration-${role}-${run}@example.com`; emails.push(email)
    const input = { requestId: randomUUID(), givenNames: 'Prueba MCP', familyNames: `${role}-${run}`, email, phone: '7000-1234', birthDate: '', city: '', role, specialties: role === 'doctor' ? [catalog.body.specialties[0].id] : [], active: true }
    const created = await invoke('create', input)
    assert.equal(created.status, 200, 'create must succeed without client code or password')
    assert.equal(created.body.success, true)
    assert.match(created.body.employeeCode, /^(?!000)\d{3}$/)
    codes.push(created.body.employeeCode)
    const password = created.body.credentials?.password
    assert.equal(password, 'Gaby.0522123')
    passwords.add(password)
    let detail = await invoke('detail', { id: created.body.staffId })
    assert.equal(detail.status, 200)
    assert.equal(detail.body.email, email)
    assert.equal(detail.body.role, role)
    assert.equal(detail.body.employeeCode, created.body.employeeCode)
    assert.equal(detail.body.active, true)
    assert.ok(!('credentials' in detail.body) && !('password' in detail.body))
    const personId = detail.body.profileId
    const employee = newClient(); clients.push(employee)
    const login = await employee.auth.signInWithPassword({ email, password })
    assert.ifError(login.error)
    const token = login.data.session.access_token
    assert.equal((await invoke('catalogs', {}, token)).status, 403)
    const before = await employee.rpc('get_medical_availability', { p_from: '2030-01-07T00:00:00-06:00', p_until: '2030-01-08T00:00:00-06:00', p_doctor: detail.body.id, p_room: null })
    assert.ifError(before.error)
    const updated = await invoke('update', { id: detail.body.id, staffVersion: detail.body.staffVersion, personVersion: detail.body.personVersion, values: { given_names: input.givenNames, family_names: input.familyNames, phone: '7000-1235', birth_date: '', city: 'Registro de prueba', employee_code: detail.body.employeeCode, specialties: input.specialties } })
    assert.equal(updated.status, 200)
    detail = await invoke('detail', { id: detail.body.id })
    assert.equal(detail.body.profileId, personId)
    assert.equal(detail.body.phone, '7000-1235')
    assert.equal(detail.body.employeeCode, created.body.employeeCode)
    const disabled = await invoke('state', { id: detail.body.id, staffVersion: detail.body.staffVersion, active: false, impactAcknowledged: true, impact: detail.body.impact })
    assert.equal(disabled.status, 200)
    assert.equal(disabled.body.employee.active, false)
    const blocked = await newClient().auth.signInWithPassword({ email, password })
    assert.ok(blocked.error)
    const after = await employee.rpc('get_medical_availability', { p_from: '2030-01-07T00:00:00-06:00', p_until: '2030-01-08T00:00:00-06:00', p_doctor: detail.body.id, p_room: null })
    assert.ok(after.error, 'Existing JWT must lose labor authorization')
    const activeRoles = await employee.from('user_roles').select('role').eq('user_id', personId).eq('active', true)
    assert.deepEqual(activeRoles.data, [])
    detail = await invoke('detail', { id: detail.body.id })
    const reactivated = await invoke('state', { id: detail.body.id, staffVersion: detail.body.staffVersion, active: true })
    assert.equal(reactivated.status, 200)
    assert.equal(reactivated.body.employee.active, true)
    const relogin = await employee.auth.signInWithPassword({ email, password })
    assert.ifError(relogin.error)
    const roles = await employee.from('user_roles').select('role').eq('user_id', personId).eq('active', true)
    assert.deepEqual(roles.data.map(r => r.role), [role === 'doctor' ? 'doctor' : 'recepcionista'])
    report('employee_verified', { role, code: created.body.employeeCode, create: true, detail: true, update: true, deactivate: true, oldSessionBlocked: true, reactivate: true, loginRestored: true })
  }
  assert.equal(passwords.size, 1)
  assert.equal(Number(codes[1]), Number(codes[0]) + 1)
  report('configured_initial_password_and_sequential_codes_verified')
} catch (error) { firstFailure = error; report('verification_failed', { error: error instanceof Error ? error.message : String(error) }) }
finally {
  try {
    // No pattern-wide deletion: only the exact run-specific identities created above.
    const list = emails.map(literal).join(',')
    const owned = await query(`select id from auth.users where email in (${list}) and (raw_user_meta_data->>'hospital_test_run'=${literal(run)} or (raw_user_meta_data->>'first_name'='Prueba MCP' and raw_user_meta_data->>'last_name' like ${literal('%' + run)}));`)
    if (owned.length) {
      const ids = owned.map(r => `${literal(r.id)}::uuid`).join(',')
      const guard = await query(`select (select count(*) from public.patients where profile_id in (${ids}))::int as patients, (select count(*) from public.appointments where doctor_id in(select id from public.staff where profile_id in (${ids})))::int as appointments;`)
      assert.equal(guard[0].patients, 0); assert.equal(guard[0].appointments, 0)
      await query(`begin;
        select set_config('request.jwt.claim.sub',${literal(adminId || '')},true);
        delete from public.doctor_specialties where doctor_id in(select id from public.staff where profile_id in (${ids}));
        delete from public.staff where profile_id in (${ids});
        delete from public.user_roles where user_id in (${ids});
        set constraints all immediate;
        delete from public.audit_logs where actor_id in (${ids}) or entity_id in(select id::text from public.profiles where id in (${ids}));
        delete from public.profiles where id in (${ids});
        delete from auth.users where id in (${ids});
        commit;`)
    }
    const remaining = await query(`select count(*)::int as count from auth.users where email in (${list});`)
    assert.equal(remaining[0].count, 0)
    cleanupSucceeded = true
    report('temporary_data_cleaned', { remainingAccounts: 0 })
  } catch (error) { report('cleanup_failed', { error: error instanceof Error ? error.message : String(error) }); firstFailure ??= error }
  for (const client of clients) await client.auth.signOut().catch(() => {})
  mcp.close()
}
if (firstFailure || !cleanupSucceeded) process.exitCode = 1
