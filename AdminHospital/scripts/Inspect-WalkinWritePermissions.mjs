import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp=await connectHospitalMcp()
try { console.log(JSON.stringify(await mcp.call('execute_sql',{query:"select p.proname,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f' and (p.proname like '%profile%' or p.proname like '%auth_user%');"}))) }finally{mcp.close()}
