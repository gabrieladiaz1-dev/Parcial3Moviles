import fs from 'node:fs'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp=await connectHospitalMcp()
try {
 const result=await mcp.call('execute_sql',{query:`select 'column' kind,table_name name,jsonb_build_object('column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default)::text definition from information_schema.columns where table_schema='public' and table_name in('patients','medical_records','profiles')
 union all select 'function',n.nspname||'.'||p.proname,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and ((n.nspname='public' and (p.proname in('register_patient','create_walkin_patient','reception_search_patients','reception_patient_search','reception_patient_summary') or p.proname like '%link%patient%' or p.proname like '%claim%patient%')) or (n.nspname='private' and p.proname in('has_role','treats_patient')))
 union all select 'policy',tablename,concat(policyname,': ',cmd,' USING ',qual,' CHECK ',with_check) from pg_policies where schemaname='public' and tablename in('patients','medical_records','profiles')
 union all select 'constraint',conrelid::regclass::text,pg_get_constraintdef(oid) from pg_constraint where conrelid in('public.patients'::regclass,'public.medical_records'::regclass)
 union all select 'trigger',tgrelid::regclass::text,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in('public.patients'::regclass,'public.medical_records'::regclass,'auth.users'::regclass);`})
 fs.mkdirSync('.private-backups',{recursive:true});fs.writeFileSync('.private-backups/walkin-contract.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify(result.filter(r=>r.kind==='column'||r.kind==='constraint'||r.kind==='policy')))
 console.log(JSON.stringify(result.filter(r=>r.kind==='function').map(r=>({name:r.name,definition:r.definition}))))
}finally{mcp.close()}
