import fs from 'node:fs'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp=await connectHospitalMcp()
try{
 const current=await mcp.call('execute_sql',{query:"select pg_get_functiondef('public.register_patient(text,text,text)'::regprocedure) as registration,pg_get_functiondef('public.create_walkin_patient(text,text,text,text,date,text,text)'::regprocedure) as walkin;"})
 fs.mkdirSync('.private-backups',{recursive:true})
 const path='.private-backups/walkin-before-linking.json';if(!fs.existsSync(path))fs.writeFileSync(path,JSON.stringify(current,null,2),{flag:'wx'})
 console.log(JSON.stringify(await mcp.call('apply_migration',{name:'walkin_patient_registration',query:fs.readFileSync('supabase/walkin_patient_registration.sql','utf8')})))
}finally{mcp.close()}
