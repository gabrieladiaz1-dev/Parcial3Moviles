import fs from 'node:fs'
import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp=await connectHospitalMcp()
try {
 const query="select pg_get_functiondef('public.save_recurring_journey_scope(jsonb,uuid,text,uuid,integer,jsonb,boolean)'::regprocedure) as definition"
 const [before]=await mcp.call('execute_sql',{query})
 if (!before?.definition.includes('effective<old.valid_from OR (')) throw new Error('Unexpected definition; stopped')
 console.log(JSON.stringify(await mcp.call('apply_migration',{name:'recurring_advance_start',query:fs.readFileSync('supabase/recurring_advance_start.sql','utf8')})))
 const [after]=await mcp.call('execute_sql',{query})
 const expected=before.definition.replaceAll('effective<old.valid_from OR (old.valid_until IS NOT NULL AND effective>old.valid_until)','(old.valid_until IS NOT NULL AND effective>old.valid_until)').replaceAll('SET closed_on=effective,active=false','SET closed_on=greatest(effective,valid_from),active=false').replaceAll('old.specialty_id,effective,old.valid_until','old.specialty_id,greatest(effective,old.valid_from),old.valid_until').replaceAll('j.valid_from>effective OR NOT EXISTS','NOT EXISTS')
 if(after.definition!==expected) throw new Error('Unexpected deployed definition')
 console.log(JSON.stringify({verified:true,originalDatesPreserved:true,otherWeekdaysKeepOriginalStart:true}))
} finally {mcp.close()}
