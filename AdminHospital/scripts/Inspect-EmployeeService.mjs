import { connectHospitalMcp } from './lib/supabaseMcp.mjs'
const mcp = await connectHospitalMcp()
try {
  const remote = await mcp.call('get_edge_function', { function_slug: 'manage-employees' })
  const files = remote.files ?? remote.data?.files ?? []
  console.log(JSON.stringify({ responseKeys: Object.keys(remote), files: files.map(f => f.name ?? f.path) }))
  const source = files.map(f => f.content ?? '').join('\n')
  const validation = source.slice(source.indexOf('function validate'), source.indexOf('Deno.serve'))
  console.log(JSON.stringify({ validation: validation.split('\n').filter(line => /text\(|employeeCode|givenNames|familyNames|return \{/.test(line) && !/password|secret|token/i.test(line)).join('\n'), codeAllocation: source.includes('nextEmployeeCode'), fixedInitialPassword: /(?:INITIAL_EMPLOYEE_PASSWORD|INITIAL_PASSWORD)\s*=\s*['"]/.test(source), ignoresClientCode: /validate\(\{\s*\.\.\.b,\s*employeeCode:\s*''/.test(source), hasState: source.includes("b.action === 'state'"), hasVersionHeader: source.includes('X-Employee-Contract') }))
  const metadata = await mcp.call('execute_sql', { query: "select (select count(*) from public.staff) as staff_count, (select coalesce(max(case when employee_code ~ '^[0-9]+$' then employee_code::numeric end),0)::text from public.staff) as last_numeric_code, to_regprocedure('public.set_employee_role(uuid,public.hospital_role,boolean)') is not null as role_rpc, to_regprocedure('public.upsert_staff(uuid,text,text)') is not null as staff_rpc, (select json_agg(column_name) from information_schema.columns where table_schema='auth' and table_name='users' and column_name in ('instance_id','encrypted_password','email_confirmed_at','is_sso_user','is_anonymous')) as test_auth_columns;" })
  console.log(JSON.stringify({ metadata }))
} finally { mcp.close() }
