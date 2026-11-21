import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp = await connectHospitalMcp()
try {
  const rows = await mcp.call('execute_sql', { query: `select p.proname, pg_get_function_arguments(p.oid) as arguments,
    case when p.proname='save_recurring_journey' then p.prosrc like '%final_day date=nullif(p_values->>''valid_until'','''')::date%' else null end as accepts_indefinite,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execution
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_recurring_journey','read_staff_planning','get_medical_availability');` })
  console.log(JSON.stringify(rows))
} finally { mcp.close() }
