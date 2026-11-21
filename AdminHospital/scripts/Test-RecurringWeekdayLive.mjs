// Explicitly authorized integration test: only identities created by this run are written.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { connectHospitalMcp, hospitalProject } from './lib/supabaseMcp.mjs'
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}))
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY
assert.equal(new URL(url).hostname,`${hospitalProject}.supabase.co`)
const mcp=await connectHospitalMcp(),run=randomUUID().replaceAll('-',''),emails=[],clients=[],staffIds=[]
const lit=v=>`'${String(v).replaceAll("'","''")}'`
const query=async sql=>mcp.call('execute_sql',{query:sql})
const client=()=>{const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});clients.push(c);return c}
const add=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10)
const midnight=d=>d+'T00:00:00-06:00'
const localDate=t=>new Date(Date.parse(t)-6*3600000).toISOString().slice(0,10)
const time=t=>new Date(Date.parse(t)-6*3600000).toISOString().slice(11,16)
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/El_Salvador',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const base=add(today,14+(8-new Date(today+'T12:00:00Z').getUTCDay())%7)
let adminId,roomId,failure
try {
 const admin=client(),adminEmail=`mcp-weekday-admin-${run}@example.com`,password=randomBytes(24).toString('hex')+'Aa7!';emails.push(adminEmail)
 const signup=await admin.auth.signUp({email:adminEmail,password,options:{data:{first_name:'Prueba MCP',last_name:run,hospital_test_run:run}}});assert.ifError(signup.error);adminId=signup.data.user.id
 await query(`with owned as(update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id=${lit(adminId)}::uuid and email=${lit(adminEmail)} and raw_user_meta_data->>'hospital_test_run'=${lit(run)} returning id) insert into public.user_roles(user_id,role,active) select id,'admin',true from owned on conflict(user_id,role) do update set active=true;`)
 const login=await admin.auth.signInWithPassword({email:adminEmail,password});assert.ifError(login.error)
 const invoke=async(action,values={})=>{const response=await fetch(url+'/functions/v1/manage-employees',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${login.data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...values}),signal:AbortSignal.timeout(45000)});const body=await response.json();assert.equal(response.status,200,body.error);return body}
 const rpc=async(name,params)=>{const result=await admin.rpc(name,params);if(result.error)throw new Error(`${name}: ${result.error.code} ${result.error.message}`);return result.data}
 const read=async(date)=>rpc('read_staff_planning',{p_from:midnight(date),p_until:midnight(add(date,7))})
 const availability=async(date,id)=>rpc('get_medical_availability',{p_from:midnight(date),p_until:midnight(add(date,7)),p_doctor:id,p_room:roomId})
 const catalog=await invoke('catalogs');assert.ok(catalog.specialties.length)
 roomId=randomUUID();await query(`insert into public.consulting_rooms(id,code,active) values(${lit(roomId)}::uuid,${lit('TEST-'+run.slice(0,16))},true);`)
 for(const role of ['doctor','receptionist']) {
  const email=`mcp-weekday-${role}-${run}@example.com`;emails.push(email)
  const created=await invoke('create',{givenNames:'Prueba MCP',familyNames:`${role}-${run}`,email,phone:'7000-1234',birthDate:'',city:'',role,specialties:role==='doctor'?[catalog.specialties[0].id]:[],active:true})
  const id=created.staffId;assert.ok(id);staffIds.push(id)
  const v={staff_id:id,weekdays:[0,1,2,3,4,5,6],valid_from:base,valid_until:null,start_time:'08:00',end_time:'16:00',shift_type:'ordinario',breaks:[{start_time:'12:00',end_time:'12:30',reason:'Almuerzo'}],consultations:role==='doctor'?[{start_time:'08:00',end_time:'16:00',slot_minutes:30}]:[],room_id:role==='doctor'?roomId:null,specialty_id:role==='doctor'?Number(catalog.specialties[0].id):null,active:true}
  const first=await rpc('save_recurring_journey',{p_values:v,p_id:null,p_version:null,p_key:randomUUID()})
  let snapshot=await read(base),old=snapshot.recurring_journeys.find(j=>j.id===first.id)
  assert.ok(old)
  const effective=add(base,7),sat={...v,valid_from:effective,weekdays:[6],end_time:'12:00',breaks:[],consultations:role==='doctor'?[{start_time:'08:00',end_time:'12:00',slot_minutes:30}]:[]}
  const params={p_values:sat,p_id:old.id,p_version:old.version,p_key:randomUUID(),p_weekday:6,p_originals:[]}
  const preview=await rpc('save_recurring_journey_scope',{...params,p_preview:true});assert.equal(preview.valid,true)
  assert.equal((await read(effective)).recurring_journeys.filter(j=>j.staff_id===id).length,1,'preview must not persist')
  const result=await rpc('save_recurring_journey_scope',{...params,p_preview:false})
  assert.equal((await rpc('save_recurring_journey_scope',{...params,p_preview:false})).id,result.id,'retry must not duplicate')
  for(const weeks of [0,4,12]) {
   const date=add(effective,weeks*7);snapshot=await read(date)
   const shifts=snapshot.shifts.filter(s=>s.staff_id===id&&localDate(s.starts_at)>=date&&localDate(s.starts_at)<add(date,7))
   assert.equal(shifts.length,7)
   for(const shift of shifts) {const saturday=new Date(localDate(shift.starts_at)+'T12:00:00Z').getUTCDay()===6;assert.equal(time(shift.starts_at),'08:00');assert.equal(time(shift.ends_at),saturday?'12:00':'16:00')}
   const preserved=snapshot.recurring_journeys.find(j=>j.staff_id===id&&j.active&&j.id!==result.id)
   assert.deepEqual(preserved.weekdays,[0,1,2,3,4,5]);assert.deepEqual(preserved.breaks,old.breaks);assert.deepEqual(preserved.consultations,old.consultations);assert.equal(preserved.consulting_room_id,old.consulting_room_id)
   if(role==='doctor') {const slots=await availability(date,id);assert.equal(slots.filter(s=>new Date(localDate(s.starts_at)+'T12:00:00Z').getUTCDay()===6).length,8);assert.equal(slots.length,98);assert.ok(slots.every(s=>time(s.starts_at)!=='12:00'||new Date(localDate(s.starts_at)+'T12:00:00Z').getUTCDay()===6))}
  }
  const fullDate=add(effective,14);snapshot=await read(fullDate)
  const originals=snapshot.recurring_journeys.filter(j=>j.staff_id===id&&j.active&&!j.closed_on),chosen=originals.find(j=>j.id===result.id)
  const full={...v,valid_from:fullDate,weekdays:[1,2,3,4,5],start_time:'09:00',end_time:'15:00',consultations:role==='doctor'?[{start_time:'09:00',end_time:'15:00',slot_minutes:30}]:[]}
  const fullParams={p_values:full,p_id:chosen.id,p_version:chosen.version,p_key:randomUUID(),p_weekday:null,p_originals:originals.map(j=>({id:j.id,version:j.version}))}
  await rpc('save_recurring_journey_scope',{...fullParams,p_preview:true})
  await rpc('save_recurring_journey_scope',{...fullParams,p_preview:false})
  for(const weeks of [0,8]) {const date=add(fullDate,weeks*7),now=await read(date),shifts=now.shifts.filter(s=>s.staff_id===id);assert.equal(shifts.length,5);assert.ok(shifts.every(s=>time(s.starts_at)==='09:00'&&time(s.ends_at)==='15:00'));if(role==='doctor')assert.equal((await availability(date,id)).length,55)}
  const historic=await read(base);assert.equal(historic.shifts.filter(s=>s.staff_id===id).length,7);assert.ok(historic.shifts.filter(s=>s.staff_id===id).every(s=>time(s.ends_at)==='16:00'))
  const definitions=historic.recurring_journeys.filter(j=>j.staff_id===id);assert.equal(definitions.length,4);assert.equal(definitions.filter(j=>j.closed_on).length,3)
  console.log(JSON.stringify({role,saturdayAcrossWeeks:[0,4,12],otherSixDaysUnchanged:true,fullJourneyAcrossWeeks:[0,8],historyPreserved:true,availabilityVerified:role==='doctor',previewRollback:true,idempotentRetry:true}))
 }
} catch(error) {failure=error;console.log(JSON.stringify({verificationFailed:error.message}))}
finally {
 try {
  const owned=await query(`select id from auth.users where email in(${emails.map(lit).join(',')}) and (raw_user_meta_data->>'hospital_test_run'=${lit(run)} or(raw_user_meta_data->>'first_name'='Prueba MCP' and raw_user_meta_data->>'last_name' like ${lit('%'+run)}));`)
  if(owned.length) {
   const ids=owned.map(r=>lit(r.id)+'::uuid').join(',')
   const [guard]=await query(`select (select count(*) from public.appointments where doctor_id in(select id from public.staff where profile_id in(${ids})))::int as appointments,(select count(*) from public.patients where profile_id in(${ids}))::int as patients;`);assert.equal(guard.appointments,0);assert.equal(guard.patients,0)
   await query(`begin; select set_config('request.jwt.claim.sub',${lit(adminId||'')},true);
    delete from public.staff_recurring_journeys where staff_id in(select id from public.staff where profile_id in(${ids}));
    delete from public.doctor_specialties where doctor_id in(select id from public.staff where profile_id in(${ids}));
    delete from public.staff where profile_id in(${ids});delete from public.user_roles where user_id in(${ids});set constraints all immediate;
    delete from public.audit_logs where actor_id in(${ids}) or entity_id in(select id::text from public.profiles where id in(${ids}));
    delete from public.profiles where id in(${ids});delete from auth.users where id in(${ids});
    ${roomId?`delete from public.consulting_rooms where id=${lit(roomId)}::uuid and code=${lit('TEST-'+run.slice(0,16))};`:''}commit;`)
  }
  const [remaining]=await query(`select count(*)::int as count from auth.users where email in(${emails.map(lit).join(',')});`);assert.equal(remaining.count,0)
  console.log(JSON.stringify({temporaryAccountsCleaned:true,remaining:0}))
 } catch(error){failure??=error;console.log(JSON.stringify({cleanupFailed:error.message}))}
 for(const c of clients)await c.auth.signOut().catch(()=>{})
 mcp.close()
}
if(failure)process.exitCode=1
