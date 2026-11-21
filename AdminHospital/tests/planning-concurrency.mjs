// Requires the dedicated hospital-planning-test container. No remote DB is accessed.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const container = 'hospital-planning-test'
const database = `planning_test_${randomUUID().replaceAll('-', '')}`
function command(args, input = '') {
  const process = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stdout = '', stderr = ''
  process.stdout.on('data', chunk => { stdout += chunk })
  process.stderr.on('data', chunk => { stderr += chunk })
  process.stdin.end(input)
  return new Promise((resolve, reject) => {
    process.on('error', reject)
    process.on('close', code => resolve({ code, stdout, stderr }))
  })
}
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-v', 'ON_ERROR_STOP=1']
async function query(sql) { const result = await command(args, sql); assert.equal(result.code, 0, result.stderr); return result.stdout }
const context = "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);\n"
const doctor = '10000000-0000-4000-8000-000000000002'
const room = '30000000-0000-4000-8000-000000000001'
const instant = time => `((current_date+7)+time '${time}') AT TIME ZONE 'America/Guatemala'`
const book = time => `SELECT public.schedule_appointment('20000000-0000-4000-8000-000000000001','${doctor}','${room}',${instant(time)},(${instant(time)})+interval '30 minutes');`
const absence = time => `SELECT public.save_staff_planning('absence',jsonb_build_object('staff_id','${doctor}','dates',jsonb_build_array(current_date+7),'start_time','${time}','end_time','${time.slice(0,2)}:30','reason','Ausencia: prueba concurrente','active',true));`
async function race(first, second, pattern) {
  const process = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let output = '', errors = ''
  const closed = new Promise(resolve => process.on('close', code => resolve(code)))
  const locked = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { process.kill(); reject(new Error('First transaction did not acquire lock')) }, 15000)
    process.stdout.on('data', chunk => { output += chunk; if (output.includes('FIRST_READY')) { clearTimeout(timeout); resolve() } })
    process.on('error', error => { clearTimeout(timeout); reject(error) })
  })
  process.stderr.on('data', chunk => { errors += chunk })
  process.stdin.write(`${context}${first}\n\\echo FIRST_READY\n`)
  await locked
  const waiting = command(args, `${context}${second}\nCOMMIT;`)
  let blocked = false
  for (let i = 0; i < 40; i++) {
    const result = await query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory';")
    if (/\b1\b/.test(result)) { blocked = true; break }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  process.stdin.end('COMMIT;\n')
  assert.equal(await closed, 0, errors)
  const secondResult = await waiting
  assert.ok(blocked, 'Second transaction must wait for the planning lock')
  assert.notEqual(secondResult.code, 0, 'Second operation must fail after seeing the first commit')
  assert.match(secondResult.stderr, pattern)
}
try {
  assert.equal((await command(['exec', container, 'createdb', '-U', 'postgres', database])).code, 0)
  for (const path of ['tests/planning-local-auth.sql', 'supabase/hospital_universitario_supabase.sql', 'supabase/proposed_staff_planning.sql', 'tests/planning-database.sql']) await query(await readFile(path, 'utf8'))
  console.log('PASS: complete local database / RLS test suite')
  const fixture = (await readFile('tests/planning-database.sql', 'utf8')).split('CREATE FUNCTION pg_temp.reject')[0]
  await query(`${fixture}
    SELECT public.save_staff_planning('shift',jsonb_build_object('staff_id','${doctor}','dates',jsonb_build_array(current_date+7),'start_time','08:00','end_time','16:00','shift_type','ordinario','active',true));
    SELECT public.save_staff_planning('consultation',jsonb_build_object('staff_id','${doctor}','dates',jsonb_build_array(current_date+7),'start_time','09:00','end_time','12:00','room_id','${room}','slot_minutes',30,'active',true));
    COMMIT;`)
  await race(book('09:00'), absence('09:00'), /Conflicto con citas/)
  console.log('PASS: booking commits first; conflicting absence waits and is rejected')
  await race(absence('10:00'), book('10:00'), /fuera de disponibilidad/)
  console.log('PASS: absence commits first; booking waits and is rejected')
} finally {
  // Only the randomly named local database created above is removed.
  assert.match(database, /^planning_test_[a-f0-9]{32}$/)
  const cleanup = await command(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database])
  assert.equal(cleanup.code, 0, cleanup.stderr)
}
