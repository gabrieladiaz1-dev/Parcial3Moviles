import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
export const hospitalProject = 'uvebpsbbwofthucghccc'
export function decodeMcp(result) {
  if (result?.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'MCP tool failed')
  const text = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? ''
  let value = result.structuredContent ?? text
  for (let i = 0; i < 12; i++) {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); continue } catch {}
      const safe = value.match(/<untrusted-data-([^>]+)>\s*(?=[\[{])([\s\S]*?)<\/untrusted-data-\1>/)
      if (safe) { value = JSON.parse(safe[2].trim()); continue }
    }
    if (value && typeof value === 'object' && 'result' in value && Object.keys(value).length <= 3) { value = value.result; continue }
    break
  }
  return value
}
export async function connectHospitalMcp() {
  const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  child.stderr.resume()
  const pending = new Map()
  let id = 0
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    let message; try { message = JSON.parse(line) } catch { return }
    if (pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timer)
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result)
    } else if (message.method && message.id !== undefined) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Interactive approval is not handled by this transport.' } }) + '\n')
  })
  child.on('error', error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) } })
  child.on('exit', () => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('MCP transport closed')) } })
  const request = (method, params) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`MCP timeout: ${method}`)) }, 120000)
    pending.set(requestId, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
  })
  const close = () => { lines.close(); child.kill() }
  try {
    await request('initialize', { clientInfo: { name: 'hospital_authorized_maintenance', title: 'Hospital Móviles', version: '1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n')
    const thread = await request('thread/start', { cwd: process.cwd(), ephemeral: true })
    const server = 'supabase-hospital-moviles'
    const status = await request('mcpServerStatus/list', { threadId: thread.thread.id, serverName: server, detail: 'toolsAndAuthOnly' })
    if (status.data.find(s => s.name === server)?.runtimeStatus !== 'connected') throw new Error('Hospital MCP is not connected')
    const call = async (tool, args = {}) => decodeMcp(await request('mcpServer/tool/call', { threadId: thread.thread.id, server, tool, arguments: args }))
    const url = await call('get_project_url')
    if (!JSON.stringify(url).includes(`https://${hospitalProject}.supabase.co`)) throw new Error('Wrong Supabase project; operation stopped')
    return { call, close }
  } catch (error) { close(); throw error }
}
