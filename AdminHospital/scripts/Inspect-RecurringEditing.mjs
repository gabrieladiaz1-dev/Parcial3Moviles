import fs from 'node:fs'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp = await connectHospitalMcp()
try {
  const rows = await mcp.call('execute_sql', {query: `select 'function' as kind,n.nspname||'.'||p.proname as name,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname in ('save_recurring_journey','read_staff_planning','get_medical_availability')) or (n.nspname='private' and p.proname in ('assert_staff_planning','recurring_work')) union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.staff_recurring_journeys'::regclass;`})
  fs.mkdirSync('.private-backups',{recursive:true})
  fs.writeFileSync('.private-backups/recurring-editing-contract.json',JSON.stringify(rows,null,2))
  console.log(JSON.stringify(rows.filter(r=>r.kind==='constraint')))
} finally { mcp.close() }
