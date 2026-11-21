import fs from 'node:fs'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp = await connectHospitalMcp()
try {
  const [state] = await mcp.call('execute_sql', {query: "select to_regprocedure('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)') is not null as installed;"})
  if (state.installed) throw new Error('Incremental migration already installed; do not rerun')
  console.log(JSON.stringify(await mcp.call('apply_migration', { name:'recurring_weekday_editing', query: fs.readFileSync('supabase/recurring_weekday_editing.sql','utf8') })))
  console.log(JSON.stringify(await mcp.call('execute_sql', {query: "select has_function_privilege('authenticated','public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)','EXECUTE') as admin_client_can_invoke,not has_function_privilege('anon','public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)','EXECUTE') as anon_blocked;"})))
} finally { mcp.close() }
