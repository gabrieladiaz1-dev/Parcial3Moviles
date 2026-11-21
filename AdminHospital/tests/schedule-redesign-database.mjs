import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const bin = process.env.PG_TEST_BIN || 'C:/Program Files/PostgreSQL/17/bin'
const dir = await mkdtemp(join(tmpdir(), 'hospital-schedule-test-'))
const port = '55439'
function run(exe, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(join(bin, exe), args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
    child.on('error', reject); child.on('exit', code => code ? reject(new Error(output)) : resolve(output))
    child.stdin.end(input)
  })
}
let started = false
try {
  await run('initdb', ['-D', dir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'])
  await run('pg_ctl', ['-D', dir, '-l', join(dir, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -c wal_level=logical`, '-w', 'start'])
  started = true
  const query = sql => run('psql', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], sql)
  for (const file of ['tests/planning-local-auth.sql', 'supabase/hospital_universitario_supabase.sql', 'supabase/proposed_staff_planning.sql', 'supabase/fix_staff_planning_selection.sql', 'supabase/recurring_staff_journeys.sql', 'supabase/recurring_weekday_editing.sql', 'supabase/recurring_same_day_editing.sql', 'supabase/recurring_advance_start.sql']) await query(await readFile(file, 'utf8'))
  await query('CREATE PUBLICATION supabase_realtime;')
  await query(await readFile('supabase/migrations/20261120061108_schedule_realtime_and_single_day.sql', 'utf8'))
  console.log(await query((await readFile('tests/schedule-redesign.database.sql', 'utf8')).replace('ROLLBACK;', 'COMMIT;')))
  // Two independent sessions begin with the same editor version. Exactly one wins.
  const rows = await run('psql', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-c', "SELECT id||'|'||xmin::text FROM public.staff_recurring_journeys WHERE staff_id='fb000000-0000-4000-8000-000000000002' AND active AND valid_until IS NULL ORDER BY valid_from DESC LIMIT 1"])
  const [id, version] = rows.trim().split('|')
  assert.match(id, /^[a-f0-9-]{36}$/); assert.match(version, /^\d+$/)
  const race = () => query(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
    SELECT public.save_recurring_journey_day(jsonb_build_object('staff_id','fb000000-0000-4000-8000-000000000002','valid_from',(now() AT TIME ZONE 'America/El_Salvador')::date+42,'active',false),'${id}','${version}',gen_random_uuid()); COMMIT;`)
  const results = await Promise.allSettled([race(), race()])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.match(results.find(r => r.status === 'rejected').reason.message, /jornada cambi/)
  console.log('PASS: two concurrent editors; one commit and one explicit conflict')
} finally {
  if (started) await run('pg_ctl', ['-D', dir, '-m', 'fast', '-w', 'stop'])
  assert.ok(dir.startsWith(join(tmpdir(), 'hospital-schedule-test-')))
  await rm(dir, { recursive: true, force: true })
}
