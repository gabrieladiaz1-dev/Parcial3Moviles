// Read-only MCP verification through Codex's authenticated app-server transport.
// OAuth credentials stay inside Codex; no token is read, printed, or stored here.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const serverName = 'supabase-hospital-moviles'
const projectRef = 'uvebpsbbwofthucghccc'
const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
const pending = new Map()
let nextId = 0
let stopped = false
child.stderr.resume() // Never echo app-server startup/account information.
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.id !== undefined && pending.has(message.id)) {
    const item = pending.get(message.id)
    pending.delete(message.id); clearTimeout(item.timer)
    if (message.error) item.reject(new Error(`${message.error.code}: ${message.error.message}`))
    else item.resolve(message.result)
  } else if (message.id !== undefined && message.method) {
    // Configuration verification must never auto-approve an elicitation or write.
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Interactive requests are not handled by this read-only verifier.' } }) + '\n')
  }
})
child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) } })
child.on('exit', code => { stopped = true; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Codex transport exited (${code}).`)) } })
function request(method, params) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 60000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
function report(value) { process.stdout.write(JSON.stringify(value) + '\n') }
try {
  await request('initialize', { clientInfo: { name: 'hospital_mcp_verification', title: 'Hospital Móviles MCP verification', version: '1.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
  const thread = await request('thread/start', { cwd: process.cwd(), ephemeral: true })
  const threadId = thread.thread.id
  const status = await request('mcpServerStatus/list', { threadId, serverName, detail: 'toolsAndAuthOnly' })
  const server = status.data.find(item => item.name === serverName)
  if (!server) throw new Error('Configured Supabase MCP server was not returned.')
  report({ server: server.name, auth: server.authStatus, runtime: server.runtimeStatus, origin: server.httpOrigin, toolsError: server.toolsError })
  const tools = Object.values(server.tools ?? {})
  if (process.argv.includes('--inventory-only')) {
    report({ tools: tools.map(tool => ({ name: tool.name, required: tool.inputSchema?.required ?? [], properties: Object.keys(tool.inputSchema?.properties ?? {}) })) })
    process.exitCode = server.toolsError || !tools.length ? 1 : 0
  }
  else {
    async function readTool(name, args = {}) {
      if (!['get_project_url', 'list_tables', 'execute_sql', 'list_migrations', 'list_edge_functions', 'get_edge_function', 'query_logs'].includes(name)) throw new Error('Only read-only verification calls are allowed.')
      if (!tools.some(tool => tool.name === name)) throw new Error(`Tool unavailable: ${name}`)
      const result = await request('mcpServer/tool/call', { threadId, server: serverName, tool: name, arguments: args })
      if (result.isError) { report({ tool: name, success: false, error: result.content.filter(c => c.type === 'text').map(c => c.text).join(' ').slice(0, 600) }); return null }
      return result
    }
    report({ enabledTools: tools.map(tool => tool.name), deploymentToolAvailable: tools.some(t => t.name === 'deploy_edge_function'), migrationToolAvailable: tools.some(t => t.name === 'apply_migration') })
    const result = await readTool('get_project_url')
    if (!result) throw new Error('Project URL read failed; check OAuth organization access.')
    if (result.isError) throw new Error('Project URL read failed; check OAuth organization access.')
    const texts = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
    if (!texts.includes(`https://${projectRef}.supabase.co`)) throw new Error('The returned project URL does not match Hospital Móviles.')
    report({ project: projectRef, apiUrlVerified: true })
    for (const [name, args] of [
      ['list_tables', { schemas: ['public'], verbose: false }],
      ['execute_sql', { query: "select current_database() as database_name, current_user as execution_role, has_schema_privilege(current_user,'public','CREATE') as schema_create_privilege, to_regprocedure('public.save_recurring_journey(jsonb,uuid,text,uuid)') is not null as recurring_rpc_exists, to_regprocedure('public.read_staff_planning(timestamptz,timestamptz)') is not null as planning_read_exists, (select count(*)::int from pg_catalog.pg_tables where schemaname='public') as public_table_count;" }],
      ['list_migrations', {}],
      ['list_edge_functions', {}],
      ['get_edge_function', { function_slug: 'manage-employees' }],
      ['query_logs', { sql: 'select count(*) as event_count from function_edge_logs', iso_timestamp_start: new Date(Date.now() - 3600000).toISOString(), iso_timestamp_end: new Date().toISOString() }],
    ]) {
      const response = await readTool(name, args)
      if (response) {
        // Never print function source or log contents: either could contain secrets or PII.
        report({ tool: name, success: true, ...(name === 'execute_sql' ? { metadata: response.content.filter(c => c.type === 'text').map(c => c.text).join(' ').slice(0, 1700) } : {}) })
      } else process.exitCode = 1
    }
  }
} catch (error) { report({ verificationError: error instanceof Error ? error.message : String(error) }); process.exitCode = 1 }
finally { lines.close(); if (!stopped) child.kill() }
