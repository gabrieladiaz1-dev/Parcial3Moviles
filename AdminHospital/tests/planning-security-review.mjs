// Local review only. Receives the decrypted, ignored backup through stdin.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
let input = ''
for await (const chunk of process.stdin) input += chunk
const snapshot = JSON.parse(input.replace(/^\uFEFF/, ''))
assert.equal(snapshot.project_ref, 'uvebpsbbwofthucghccc')
const container = 'hospital-planning-test'
const database = `planning_review_${randomUUID().replaceAll('-', '')}`
function run(args, text = '') {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
  child.stdin.end(text)
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })) })
}
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
async function query(text) { const r = await run(args, text); assert.equal(r.code, 0, r.stderr); return r.stdout.trim() }
const literal = value => `'${String(value).replaceAll("'", "''")}'`
const tableNames = ['staff','profiles','user_roles','staff_shifts','staff_absences','doctor_schedules','doctor_consulting_rooms','consulting_rooms','appointments']
const digestSQL = name => `select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by id),'')) from public.${name} x;`
try {
  assert.equal((await run(['exec', container, 'createdb', '-U', 'postgres', database])).code, 0)
  for (const name of ['tests/planning-local-auth.sql','supabase/hospital_universitario_supabase.sql']) await query(await readFile(name,'utf8'))
  const actualColumns = JSON.parse(await query(`select json_agg(x order by table_name,ordinal_position) from(select table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name in(${tableNames.map(literal).join(',')}))x;`))
  const simplify = rows => rows.map(r => [r.table_name,r.column_name,r.ordinal_position,r.data_type,r.udt_name,r.is_nullable,r.column_default])
  assert.deepEqual(simplify(actualColumns), simplify(snapshot.columns), 'Local base differs from live column contract')
  const actualConstraints = JSON.parse(await query(`select json_agg(json_build_object('table',c.conrelid::regclass::text,'name',conname,'definition',pg_get_constraintdef(c.oid)) order by c.conrelid::regclass::text,conname) from pg_constraint c where c.conrelid in(${tableNames.map(n=>`${literal('public.'+n)}::regclass`).join(',')});`))
  assert.deepEqual(actualConstraints, snapshot.constraints, 'Constraint drift from the live project')
  // Use the actual current function bodies, not an assumed schema version.
  for (const fn of snapshot.functions) await query(fn.definition+';')
  for (const room of snapshot.rows.consulting_rooms) await query(`insert into public.consulting_rooms(id,code,floor_id,active) values(${literal(room.id)},${literal(room.code)},${room.floor_id ?? 'NULL'},${room.active});`)
  for (const [name, base] of Object.entries(snapshot.baseline)) {
    assert.equal(await query(`select count(*) from public.${name};`), String(base.count))
    assert.equal(await query(digestSQL(name)), base.md5, `Backup restoration checksum ${name}`)
  }
  console.log('PASS live columns/constraints match local base; backup data restoration checksums verified')
  await query(await readFile('supabase/preflight_staff_planning.sql','utf8'))
  console.log('PASS read-only preflight on restored baseline')
  await query(await readFile('supabase/proposed_staff_planning.sql','utf8'))
  const routines = snapshot.functions.filter(f=>!f.signature.startsWith('schedule_appointment('))
  for (const fn of routines) {
    const definition = await query(`select pg_get_functiondef(${literal(fn.signature)}::regprocedure);`)
    assert.equal(definition.replaceAll('\r\n','\n').trim(), fn.definition.replaceAll('\r\n','\n').trim(), `Employee/Auth RPC changed: ${fn.signature}`)
  }
  console.log('PASS migration preserves employee/Auth function definitions')
  await query(await readFile('tests/planning-employee-compat.sql','utf8'))
  console.log('PASS doctor and receptionist registration database flow, editing and deactivation')
  const employeeFlow = (await readFile('tests/planning-employee-compat.sql','utf8')).replace(/^BEGIN;\s*$/m,'').replace(/^ROLLBACK;\s*$/m,'')
  const suite = (await readFile('tests/planning-database.sql','utf8')).replace(/\nROLLBACK;\s*$/,()=>`\n${employeeFlow}\nROLLBACK;`)
  await query(suite)
  console.log('PASS scheduling/RLS/privacy and employee registration while confirmed synthetic appointments exist')
  // Simulate any newly used scheduling configuration. Rollback must refuse, not erase it.
  await query("insert into public.consulting_rooms(code,active) values('ROLLBACK-MUST-NOT-ERASE',true);")
  const refused = await run(args, await readFile('supabase/rollback_staff_planning.sql','utf8'))
  assert.notEqual(refused.code,0); assert.match(refused.stderr,/Rollback blocked/)
  assert.equal(await query("select count(*) from public.consulting_rooms where code='ROLLBACK-MUST-NOT-ERASE';"),'1')
  console.log('PASS rollback refuses after new data and leaves that data intact')
  // Remove only our synthetic marker in the disposable local DB, then test the immediate rollback.
  await query("delete from public.consulting_rooms where code='ROLLBACK-MUST-NOT-ERASE';")
  await query(await readFile('supabase/rollback_staff_planning.sql','utf8'))
  assert.equal(await query("select to_regprocedure('public.save_staff_planning(text,jsonb,uuid,text)') is null;"),'t')
  const original = snapshot.functions.find(f=>f.signature.startsWith('schedule_appointment('))
  assert.equal((await query(`select pg_get_functiondef(${literal(original.signature)}::regprocedure);`)).replaceAll('\r\n','\n').trim(), original.definition.replaceAll('\r\n','\n').trim())
  for (const [name, base] of Object.entries(snapshot.baseline)) {
    const removed = name==='doctor_schedules' ? ['active','consulting_assignment_id'] : name==='doctor_consulting_rooms' ? ['active','slot_minutes'] : name==='staff_absences' ? ['active'] : []
    const hash=await query(`select md5(coalesce(string_agg((to_jsonb(x)-ARRAY[${removed.map(literal).join(',')}]::text[])::text,chr(10) order by id),'')) from public.${name} x;`)
    assert.equal(hash,base.md5, `Post-rollback data changed: ${name}`)
  }
  for (const name of ['schedules_read','doctor_rooms_read','absences_read']) {
    const expected = snapshot.policies.find(p=>p.policyname===name)
    const actual = JSON.parse(await query(`select row_to_json(p) from pg_policies p where schemaname='public' and policyname=${literal(name)};`))
    assert.equal(actual.qual,expected.qual); assert.deepEqual(actual.roles,expected.roles)
  }
  console.log('PASS immediate operational rollback restores original RPC/policies, keeps five columns and preserves all baseline rows')
} finally {
  assert.match(database,/^planning_review_[a-f0-9]{32}$/)
  const cleaned = await run(['exec',container,'dropdb','-U','postgres','--if-exists','--force',database])
  assert.equal(cleaned.code,0,cleaned.stderr)
}
