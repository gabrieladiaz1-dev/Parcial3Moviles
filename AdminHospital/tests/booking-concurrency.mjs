// Isolated PostgreSQL only; never accepts a remote connection or production URL.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const container = 'hospital-booking-test'
const db = 'booking_' + randomUUID().replaceAll('-', '')
function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe','pipe','pipe'], windowsHide: true })
    let output = '', error = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => error += b)
    child.on('error', reject); child.on('close', code => resolve({ code, output, error })); child.stdin.end(input)
  })
}
const args = ['exec','-i',container,'psql','-U','postgres','-d',db,'-X','-At','-v','ON_ERROR_STOP=1']
async function sql(value) { const r = await command(args, value); assert.equal(r.code, 0, r.error); return r.output }
const admin='00000000-0000-4000-8000-000000000001', doctor='10000000-0000-4000-8000-000000000002', otherDoctor='10000000-0000-4000-8000-000000000005'
const patient='20000000-0000-4000-8000-000000000001', otherPatient='20000000-0000-4000-8000-000000000002', room='30000000-0000-4000-8000-000000000001', otherRoom='30000000-0000-4000-8000-000000000002'
const context = `BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',true);`
const start = hour => `((current_date+14)+time '${hour}') AT TIME ZONE 'America/Guatemala'`
const book = (request, p=patient, d=doctor, r=room, hour='09:00') => `SELECT public.schedule_appointment('${p}','${d}','${r}',${start(hour)},${start(hour)}+interval '30 minutes','${request}');`
async function request(p=patient) { const id=randomUUID(); await sql(`INSERT INTO public.appointment_requests(id,patient_id,specialty_id,preferred_period,reason) VALUES('${id}','${p}',1,'manana','Synthetic booking');`); return id }
async function reset() { await sql('TRUNCATE public.notifications; TRUNCATE public.appointments CASCADE; TRUNCATE public.appointment_requests CASCADE;') }
async function race(first, second, succeeds=1) {
  const previous=Number((await sql('SELECT coalesce(sum(last_number),0) FROM private.appointment_queue_day_counters;')).trim())
  const results = await Promise.all([command(args,context.replace(admin,'00000000-0000-4000-8000-000000000003')+first+'COMMIT;'),command(args,context.replace(admin,'00000000-0000-4000-8000-000000000007')+second+'COMMIT;')])
  assert.equal(results.filter(r=>r.code===0).length,succeeds,JSON.stringify(results))
  assert.equal(Number((await sql('SELECT count(*) FROM public.appointments;')).trim()),1)
  assert.equal((await sql('SELECT count(*) FROM public.appointments WHERE queue_number IS NULL;')).trim(),'0')
  assert.equal((await sql('SELECT count(*)-count(DISTINCT (queue_date,queue_number)) FROM public.appointments;')).trim(),'0')
  assert.equal(Number((await sql('SELECT coalesce(sum(last_number),0) FROM private.appointment_queue_day_counters;')).trim())-previous,1,'failed/retried booking must not allocate another queue')
  if(succeeds===1) assert.match(results.find(r=>r.code!==0).error,/solicitud|disponibilidad|exclusion|conflict|duplicate/i)
}
try {
  let r=await command(['exec',container,'createdb','-U','postgres',db]);assert.equal(r.code,0,r.error)
  for(const path of ['tests/planning-local-auth.sql','supabase/hospital_universitario_supabase.sql','supabase/proposed_staff_planning.sql','supabase/fix_staff_planning_selection.sql','supabase/recurring_staff_journeys.sql','supabase/reception_workflow.sql','supabase/booking_patient_guard.sql','tests/booking-published-fixture.sql']) await sql(await readFile(path,'utf8'))
  await sql("ALTER TABLE public.staff_recurring_journeys ADD COLUMN specialty_ids bigint[] NOT NULL DEFAULT ARRAY[1]::bigint[];")
  await sql(await readFile('supabase/reception_specialty_journeys.sql','utf8'))
  await sql(await readFile('supabase/booking_break_context.sql','utf8'))
  // Reuse only the existing synthetic identity fixture; do not run its unrelated scenarios.
  const fixture=await readFile('tests/planning-database.sql','utf8'); await sql(fixture.slice(0,fixture.indexOf('CREATE FUNCTION pg_temp.reject'))+'COMMIT;')
  await sql(`BEGIN; SET CONSTRAINTS ALL DEFERRED; INSERT INTO public.patients(id,first_name,last_name,phone) VALUES('${otherPatient}','Other','Synthetic','00000000');
    INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-4000-8000-000000000006','paciente') ON CONFLICT DO NOTHING;
    UPDATE public.patients SET profile_id='00000000-0000-4000-8000-000000000006' WHERE id='${patient}';
    INSERT INTO public.medical_records(patient_id) VALUES('${patient}'),('${otherPatient}');
    INSERT INTO public.doctor_specialties(doctor_id,specialty_id) VALUES('${doctor}',1),('${otherDoctor}',1);
    INSERT INTO public.doctor_schedules(doctor_id,weekday,start_time,end_time,valid_from,valid_until) VALUES('${doctor}',extract(dow from current_date+14),time '08:00',time '12:00',current_date+14,current_date+14),('${otherDoctor}',extract(dow from current_date+14),time '08:00',time '12:00',current_date+14,current_date+14);
    INSERT INTO public.staff_shifts(staff_id,starts_at,ends_at,shift_type,status) VALUES
    ('${doctor}',${start('08:00')},${start('12:00')},'ordinario','programado'),('${otherDoctor}',${start('08:00')},${start('12:00')},'ordinario','programado');
    INSERT INTO public.doctor_consulting_rooms(doctor_id,consulting_room_id,starts_at,ends_at,slot_minutes,active) VALUES
    ('${doctor}','${room}',${start('08:00')},${start('12:00')},30,true),('${otherDoctor}','${otherRoom}',${start('08:00')},${start('12:00')},30,true); COMMIT;`)
  await sql("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-000000000007','second-reception@local.test','{}'); INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-4000-8000-000000000007','recepcionista');")
  await sql(context+"SELECT public.reception_specialty_doctors(1,current_date+14); COMMIT;")
  let id=await request(); await race(book(id),book(id,patient,doctor,room,'09:30'));console.log('PASS A: different choices for one request, one commit')
  await reset(); let a=await request(),b=await request(otherPatient);await race(book(a),book(b,otherPatient));console.log('PASS B: same doctor and slot, one commit')
  await reset(); a=await request();b=await request(otherPatient);await race(book(a),book(b,otherPatient,otherDoctor,room));console.log('PASS C: same room, one commit (server also rejects outside room assignment)')
  await reset();a=await request();b=await request();await race(book(a),book(b,patient,otherDoctor,otherRoom));console.log('PASS D: same patient in two available schedules, one commit')
  await reset();id=await request();await race(book(id),book(id),2);console.log('PASS E: identical retries return one appointment')
  assert.equal((await sql("SELECT count(*) FROM public.notifications WHERE event_key LIKE 'patient:appointment:%';")).trim(),'1')
  const original=(await sql(`SELECT id FROM public.appointments WHERE request_id='${id}';`)).trim()
  await sql(context+book(id)+'COMMIT;');assert.equal((await sql(`SELECT id FROM public.appointments WHERE request_id='${id}';`)).trim(),original);assert.equal((await sql("SELECT count(*) FROM public.notifications WHERE event_key LIKE 'patient:appointment:%';")).trim(),'1');console.log('PASS F: lost response retry recovers same appointment, queue and one notice')
  await reset();id=await request();await sql(`INSERT INTO public.staff_absences(staff_id,starts_at,ends_at,reason,active) VALUES('${doctor}',${start('09:00')},${start('09:30')},'Synthetic absence',true);`)
  r=await command(args,context+book(id)+'COMMIT;');assert.notEqual(r.code,0);assert.equal((await sql('SELECT count(*) FROM public.appointments;')).trim(),'0');console.log('PASS G: server rejects stale availability after absence change')
  await sql('TRUNCATE public.staff_absences CASCADE;')
  const changed=await Promise.all([command(args,context+`INSERT INTO public.staff_absences(staff_id,starts_at,ends_at,reason,active) VALUES('${doctor}',${start('09:00')},${start('09:30')},'Synthetic race',true);COMMIT;`),command(args,context+book(id)+'COMMIT;')])
  assert.equal(changed.filter(r=>r.code===0).length,1,JSON.stringify(changed));console.log('PASS G2: concurrent absence and booking serialize; only a compatible final state commits')
  await reset()
  await sql(`INSERT INTO public.appointments(patient_id,doctor_id,consulting_room_id,starts_at,ends_at,status) VALUES('${patient}','${doctor}','${room}',now()-interval '3 hours',now()-interval '2 hours','programada'),('${patient}','${doctor}','${room}',now()-interval '1 hour',now()-interval '30 minutes','en_atencion');`)
  const queue=(await sql("SELECT queue_number FROM public.appointments WHERE status='programada';")).trim()
  await sql('SELECT private.mark_missed_appointments();')
  assert.equal((await sql("SELECT queue_number FROM public.appointments WHERE status='no_asistio';")).trim(),queue)
  assert.equal((await sql("SELECT count(*) FROM public.appointments WHERE status='en_atencion';")).trim(),'1');console.log('PASS H: expired unstarted appointment becomes no_asistio, keeps queue; ongoing consultation stays active')
  console.log('LIMIT: local repository schema; queue and patient notice bodies matched to published definitions; this is not a full production clone or an Android test. No production writes.')
} finally {
  assert.match(db,/^booking_[a-f0-9]{32}$/)
  await command(['exec',container,'dropdb','-U','postgres','--if-exists','--force',db])
}
