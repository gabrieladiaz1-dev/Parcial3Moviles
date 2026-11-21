// Local only: reproduce the old lock-order deadlock and verify the prepared fix.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
const container='hospital-planning-test', database=`planning_lock_${randomUUID().replaceAll('-','')}`
const args=['exec','-i',container,'psql','-U','postgres','-d',database,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1']
function open() {
 const process=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true})
 const output={stdout:'',stderr:''}
 process.stdout.on('data',d=>{output.stdout+=d});process.stderr.on('data',d=>{output.stderr+=d})
 const done=new Promise((resolve,reject)=>{process.on('error',reject);process.on('close',code=>resolve({...output,code}))})
 return {process,output,done}
}
async function run(text) {const p=open();p.process.stdin.end(text);return p.done}
async function query(text) {const r=await run(text);assert.equal(r.code,0,r.stderr);return r.stdout.trim()}
async function waitFor(test) {for(let i=0;i<80;i++){if(await test())return;await new Promise(r=>setTimeout(r,50))}throw Error('Local lock test timed out')}
async function race(fixed,day) {
 const first=open()
 first.process.stdin.write(`BEGIN; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 ${fixed?'select pg_advisory_xact_lock(726391054201::bigint);':''}
 select id from public.staff where id='10000000-0000-4000-8000-000000000002' for update;
 \\echo EMPLOYEE_READY
 `)
 await waitFor(()=>first.output.stdout.includes('EMPLOYEE_READY'))
 const second=run(`BEGIN; SET LOCAL ROLE authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 select public.save_staff_planning('shift',jsonb_build_object('staff_id','10000000-0000-4000-8000-000000000002','dates',jsonb_build_array(current_date+${day}),'start_time','08:00','end_time','16:00','shift_type','ordinario','active',true)); COMMIT;`)
 await waitFor(async()=>/\b1\b/.test(await query(`select count(*) from pg_stat_activity where datname=current_database() and wait_event='${fixed?'advisory':'transactionid'}';`)))
 first.process.stdin.end("update public.staff set employee_code=employee_code where id='10000000-0000-4000-8000-000000000002'; COMMIT;\n")
 const [a,b]=await Promise.all([first.done,second])
 if(fixed){assert.equal(a.code,0,a.stderr);assert.equal(b.code,0,b.stderr)}
 else {assert.ok(a.code!==0||b.code!==0);assert.match(a.stderr+b.stderr,/deadlock detected/)}
}
try {
 const create=spawn('docker',['exec',container,'createdb','-U','postgres',database],{windowsHide:true})
 assert.equal(await new Promise(r=>create.on('close',r)),0)
 for(const path of ['tests/planning-local-auth.sql','supabase/hospital_universitario_supabase.sql','supabase/proposed_staff_planning.sql'])await query(await readFile(path,'utf8'))
 const fixtures=(await readFile('tests/planning-database.sql','utf8')).split('CREATE FUNCTION pg_temp.reject')[0]
 await query(fixtures+'\nCOMMIT;')
 await race(false,14)
 console.log('CONFIRMED: previous employee row-first order can deadlock against planning')
 await race(true,15)
 console.log('PASS: prepared global-lock-first employee order completes both concurrent operations')
 const source=await readFile('supabase/functions/manage-employees/index.ts','utf8')
 assert.ok(source.indexOf('pg_advisory_xact_lock')<source.indexOf('for share'),'Employee source must acquire the planning lock before row locks')
} finally {
 assert.match(database,/^planning_lock_[a-f0-9]{32}$/)
 const clean=spawn('docker',['exec',container,'dropdb','-U','postgres','--if-exists','--force',database],{windowsHide:true})
 assert.equal(await new Promise(r=>clean.on('close',r)),0)
}
