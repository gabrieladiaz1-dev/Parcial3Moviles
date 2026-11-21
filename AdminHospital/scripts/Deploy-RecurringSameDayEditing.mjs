import fs from 'node:fs'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'

const mcp = await connectHospitalMcp()
const query = "select pg_get_functiondef('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)'::regprocedure) as definition"
try {
  const [before] = await mcp.call('execute_sql', { query })
  if (!before?.definition?.includes('effective<=today')) throw new Error('Expected deployed date guard missing; stopped without changes')
  console.log(JSON.stringify(await mcp.call('apply_migration', {
    name: 'recurring_same_day_editing',
    query: fs.readFileSync('supabase/recurring_same_day_editing.sql', 'utf8'),
  })))
  const [after] = await mcp.call('execute_sql', { query })
  const expected = before.definition.replaceAll('effective<=today', 'effective<today').replaceAll('una fecha efectiva futura', 'una fecha efectiva de hoy o posterior')
  if (after?.definition !== expected) throw new Error('Deployed definition differs from expected change')
  console.log(JSON.stringify({ verified: true, todayAllowed: true, otherGuardsUnchanged: true }))
} finally { mcp.close() }
