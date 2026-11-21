import fs from 'node:fs'
import { localities } from '../src/lib/elSalvadorLocalities.ts'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp=await connectHospitalMcp()
try {
 const rows=await mcp.call('execute_sql',{query:"select pg_get_functiondef(p.oid) as definition,pg_get_function_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_walkin_patient';"})
 if(rows.length!==2)throw new Error('Unexpected walk-in contracts; stop')
 const names=[...new Set(localities.map(l=>l.name))].map(n=>`'${n.replaceAll("'","''")}'`).join(',')
 const guard=`
 IF p_birth IS NULL OR p_birth>((now() AT TIME ZONE 'America/El_Salvador')::date-interval '18 years')::date THEN
  RAISE EXCEPTION 'El paciente debe tener al menos 18 años. Comprueba su fecha de nacimiento' USING ERRCODE='22023',HINT='birth'; END IF;
 IF p_city IS NULL OR NOT (trim(p_city)=ANY(ARRAY[${names}]::text[])) THEN
  RAISE EXCEPTION 'Selecciona una localidad válida de El Salvador en la lista' USING ERRCODE='22023',HINT='city'; END IF;
`
 const definitions=rows.map(row=>{
  if(row.definition.includes('El paciente debe tener al menos 18 años'))throw new Error('Form validation already deployed; do not repeat')
  const marker=" IF nullif(trim(p_first),'') IS NULL"
  if(!row.definition.includes(marker))throw new Error('Unexpected validator; stop')
  return row.definition.replace(marker,guard+marker)
 })
 fs.mkdirSync('.private-backups',{recursive:true})
 if(!fs.existsSync('.private-backups/walkin-before-adult-validation.json'))fs.writeFileSync('.private-backups/walkin-before-adult-validation.json',JSON.stringify(rows,null,2),{flag:'wx'})
 const migration='-- Locality literals generated from src/lib/elSalvadorLocalities.ts; do not maintain a second catalog.\n'+definitions.join(';\n')+";\nNOTIFY pgrst,'reload schema';\n"
 fs.writeFileSync('supabase/walkin_adult_locality_validation.sql',migration)
 console.log(JSON.stringify(await mcp.call('apply_migration',{name:'walkin_adult_locality_validation',query:migration})))
}finally{mcp.close()}
