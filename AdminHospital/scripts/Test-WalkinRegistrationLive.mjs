// Authorized synthetic acceptance test. Never changes real patient identities.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes, randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { connectHospitalMcp,hospitalProject } from './lib/supabaseMcp.mjs'
const env=Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}))
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY
assert.equal(new URL(url).hostname,`${hospitalProject}.supabase.co`)
const mcp=await connectHospitalMcp(),run=randomUUID().replaceAll('-',''),emails=[],clients=[],ownedPatients=[]
const lit=v=>`'${String(v).replaceAll("'","''")}'`,sql=async query=>mcp.call('execute_sql',{query})
const report=(step,details={})=>console.log(JSON.stringify({step,...details}))
let failure,adminId
async function account(label,first='Prueba MCP',last=run,birth='1995-03-14'){
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});clients.push(client)
 const email=`walkin-${label}-${run}@example.com`,password=randomBytes(24).toString('hex')+'Aa7!';emails.push(email)
 const signup=await client.auth.signUp({email,password,options:{data:{first_name:first,last_name:last,birth_date:birth,hospital_test_run:run}}});assert.ifError(signup.error);assert.ok(signup.data.user?.id)
 const id=signup.data.user.id
 await sql(`update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id=${lit(id)}::uuid and email=${lit(email)} and raw_user_meta_data->>'hospital_test_run'=${lit(run)};`)
 const login=await client.auth.signInWithPassword({email,password});assert.ifError(login.error)
 return {id,email,client,session:login.data.session,password}
}
async function rpc(client,name,args){const result=await client.rpc(name,args);if(result.error)throw Object.assign(new Error(`${name}: ${result.error.message}`),result.error);return result.data}
try{
 const admin=await account('admin');adminId=admin.id
 const reception=await account('reception')
 await sql(`insert into public.user_roles(user_id,role,active) values(${lit(admin.id)}::uuid,'admin',true),(${lit(reception.id)}::uuid,'recepcionista',true) on conflict(user_id,role) do update set active=true;`)
 const unauthorized=await account('unauthorized')
 let dui
 for(let i=0;i<20;i++){const digits=String(randomInt(100000000,999999999));const candidate=digits.slice(0,8)+'-'+digits.slice(8);const [row]=await sql(`select count(*)::int as n from public.patients where dui=${lit(candidate)};`);if(!row.n){dui=candidate;break}}
 assert.ok(dui)
 const form={p_first:'Paciente Sintético',p_last:run,p_dui:dui,p_phone:'7000-1234',p_birth:'1995-03-14',p_city:'San Salvador',p_email:`walkin-contact-${run}@example.com`}
 const [first,duplicate]=await Promise.all([rpc(reception.client,'create_walkin_patient',form),rpc(reception.client,'create_walkin_patient',form)])
 ownedPatients.push(first);assert.equal(first,duplicate)
 const read=async()=>{const result=await reception.client.from('patients').select('*,medical_records(*)').eq('id',first).single();assert.ifError(result.error);const data=result.data;data.medical_records=Array.isArray(data.medical_records)?data.medical_records:data.medical_records?[data.medical_records]:[];return data}
 const patient=await read(),record=patient.medical_records[0]
 assert.equal(patient.profile_id,null);assert.equal(patient.registration_source,'presencial');assert.equal(patient.created_by,reception.id)
 assert.equal(patient.medical_records.length,1);assert.equal(record.patient_id,first);assert.equal(record.opened_by,reception.id);assert.ok(patient.patient_code&&record.record_code&&record.opened_at)
 const [noAuth]=await sql(`select (select count(*) from auth.users where email=${lit(form.p_email)})::int as accounts,(select count(*) from public.profiles where id=${lit(first)}::uuid)::int as fake_profiles;`)
 assert.equal(noAuth.accounts,0);assert.equal(noAuth.fake_profiles,0)
 report('create_without_auth_and_atomic_record',{passed:true})
 report('concurrent_duplicate_dui',{passed:true,samePatient:true,singleRecord:true})
 const search=await reception.client.from('patients').select('id,patient_code,medical_records(record_code)').eq('dui',dui);assert.ifError(search.error);assert.equal(search.data.length,1);assert.equal(search.data[0].id,first)
 const again=await rpc(reception.client,'create_walkin_patient',form);assert.equal(again,first);assert.equal((await read()).medical_records[0].record_code,record.record_code)
 report('recover_existing_without_duplicate',{passed:true})
 const denied=await unauthorized.client.rpc('create_walkin_patient',form);assert.equal(denied.error?.code,'42501')
 const arbitrary=await reception.client.from('patients').update({profile_id:unauthorized.id,created_by:unauthorized.id}).eq('id',first);assert.ok(arbitrary.error)
 report('unauthorized_creation_and_arbitrary_ownership_blocked',{passed:true})
 const mismatch=await account('mismatch','Otro Nombre',run)
 const notLinked=await mismatch.client.rpc('register_patient',{p_dui:dui,p_phone:null,p_city:null});assert.ok(notLinked.error);assert.equal((await read()).profile_id,null)
 const hidden=await mismatch.client.from('medical_records').select('id').eq('patient_id',first);assert.ifError(hidden.error);assert.equal(hidden.data.length,0)
 report('mismatched_identity_and_record_access_blocked',{passed:true})
 const ios=await account('ios',form.p_first,form.p_last,form.p_birth)
 const linked=await rpc(ios.client,'register_patient',{p_dui:dui.replace('-',''),p_phone:'7777-1234',p_city:'Otra ciudad'})
 assert.equal(linked,first)
 const after=await read();assert.equal(after.profile_id,ios.id);assert.equal(after.medical_records[0].record_code,record.record_code);assert.equal(after.medical_records.length,1)
 assert.equal(after.patient_code,patient.patient_code);assert.equal(after.registration_source,'presencial');assert.equal(after.phone,patient.phone);assert.equal(after.city,patient.city)
 const self=await ios.client.from('medical_records').select('id,record_code').eq('patient_id',first);assert.ifError(self.error);assert.equal(self.data.length,1);assert.equal(self.data[0].record_code,record.record_code)
 assert.equal(await rpc(ios.client,'register_patient',{p_dui:dui,p_phone:null,p_city:null}),first)
 report('ios_link_keeps_patient_record_and_contact',{passed:true,samePatientId:true,sameRecordCode:true,samePatientCode:true})
 const attacker=await account('second-ios',form.p_first,form.p_last,form.p_birth)
 const refused=await attacker.client.rpc('register_patient',{p_dui:dui,p_phone:null,p_city:null});assert.equal(refused.error?.code,'23505');assert.equal((await read()).profile_id,ios.id)
 report('linked_dui_cannot_be_reassigned',{passed:true})
 const invalid=await reception.client.rpc('create_walkin_patient',{...form,p_birth:'2099-01-01'});assert.equal(invalid.error?.code,'22023')
 const invalidEmail=await reception.client.rpc('create_walkin_patient',{...form,p_email:'correo incorrecto'});assert.equal(invalidEmail.error?.code,'22023')
 report('invalid_birth_and_email_rejected',{passed:true})
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/El_Salvador',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 const birth17=String(Number(today.slice(0,4))-17)+today.slice(4),birth18=String(Number(today.slice(0,4))-18)+today.slice(4)
 for(const args of [{...form,p_birth:birth17},{...form,p_city:'Ciudad inexistente 123'}]){const denied=await reception.client.rpc('create_walkin_patient',args);assert.equal(denied.error?.code,'22023')}
 const six={...form,p_birth:birth17};delete six.p_email
 assert.equal((await reception.client.rpc('create_walkin_patient',six)).error?.code,'22023')
 const digits18=String(randomInt(100000000,999999999)),dui18=digits18.slice(0,8)+'-'+digits18.slice(8)
 const adult18=await rpc(reception.client,'create_walkin_patient',{...form,p_dui:dui18,p_birth:birth18});assert.ok(adult18)
 report('backend_adult_and_locality_validation',{age17Rejected:true,age18Accepted:true,invalidCityRejected:true,sixArgumentBypassBlocked:true})
 // Optional UI acceptance uses these temporary sessions in an isolated browser context.
 if(process.argv.includes('--ui')){
  const {verifyWalkinBrowser}=await import('./lib/walkinBrowser.mjs')
  let uiDui
  for(let i=0;i<20;i++){const digits=String(randomInt(100000000,999999999));const candidate=digits.slice(0,8)+'-'+digits.slice(8);const [row]=await sql(`select count(*)::int as n from public.patients where dui=${lit(candidate)};`);if(!row.n){uiDui=candidate;break}}
  assert.ok(uiDui)
  await verifyWalkinBrowser({session:reception.session,form:{...form,p_dui:uiDui},onReview:async()=>{const [row]=await sql(`select count(*)::int as n from public.patients where dui=${lit(uiDui)};`);assert.equal(row.n,0,'Enter and review must not create patients')}})
  const [uiSaved]=await sql(`select count(*)::int as n from public.patients p join public.medical_records m on m.patient_id=p.id where p.dui=${lit(uiDui)} and p.last_name=${lit(run)} and p.profile_id is null and p.created_by=${lit(reception.id)}::uuid;`)
  assert.equal(uiSaved.n,1)
 }
}catch(error){failure=error;report('verification_failed',{error:error.message})}
finally{
 try{
  const owned=await sql(`select id from auth.users where email in(${emails.map(lit).join(',')}) and raw_user_meta_data->>'hospital_test_run'=${lit(run)};`)
  if(owned.length){
   const ids=owned.map(r=>lit(r.id)+'::uuid').join(',')
   const patients=await sql(`select p.id from public.patients p where p.created_by in(${ids}) and p.last_name=${lit(run)} and p.email=${lit(`walkin-contact-${run}@example.com`)};`)
   if(patients.length){const pids=patients.map(r=>lit(r.id)+'::uuid').join(',');const [guard]=await sql(`select (select count(*) from public.appointments where patient_id in(${pids}))::int as appointments,(select count(*) from public.clinical_encounters where record_id in(select id from public.medical_records where patient_id in(${pids})))::int as encounters;`);assert.equal(guard.appointments,0);assert.equal(guard.encounters,0)
    await sql(`begin;select set_config('request.jwt.claim.sub',${lit(adminId)},true);delete from public.medical_records where patient_id in(${pids});delete from public.patients where id in(${pids});commit;`)}
   await sql(`begin;delete from public.audit_logs where actor_id in(${ids}) or entity_id in(${owned.map(r=>lit(r.id)).join(',')});delete from public.user_roles where user_id in(${ids});delete from public.profiles where id in(${ids});delete from auth.users where id in(${ids});commit;`)
  }
  const [left]=await sql(`select (select count(*) from auth.users where email in(${emails.map(lit).join(',')}))::int as accounts,(select count(*) from public.patients where last_name=${lit(run)})::int as patients;`)
  assert.equal(left.accounts,0);assert.equal(left.patients,0);report('temporary_data_cleaned',{accounts:0,patients:0})
 }catch(error){failure??=error;report('cleanup_failed',{error:error.message})}
 for(const c of clients)await c.auth.signOut().catch(()=>{})
 mcp.close()
}
if(failure)process.exitCode=1
