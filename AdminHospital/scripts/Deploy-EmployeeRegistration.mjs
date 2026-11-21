import fs from 'node:fs'
import { connectHospitalMcp, hospitalProject } from './lib/supabaseMcp.mjs'
const mcp = await connectHospitalMcp()
try {
  const previous = await mcp.call('get_edge_function', { function_slug: 'manage-employees' })
  fs.mkdirSync('.private-backups', { recursive: true })
  const backup = `.private-backups/manage-employees-before-registration-v4-${previous.version}.json`
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(previous), { flag: 'wx' })
  const names = ['index.ts', 'validation.ts', 'contract.ts']
  const files = names.map(name => ({ name, content: fs.readFileSync(`supabase/functions/manage-employees/${name}`, 'utf8') }))
  files.push({ name: 'deno.json', content: JSON.stringify({ imports: {} }) })
  if (!files[2].content.includes('employees-2026-11-registration-v4') || !files[1].content.includes("return 'Gaby.0522123'")) throw new Error('Unexpected release content')
  const deployed = await mcp.call('deploy_edge_function', { name: 'manage-employees', entrypoint_path: 'index.ts', import_map_path: 'deno.json', verify_jwt: false, files })
  console.log(JSON.stringify({ project: hospitalProject, function: 'manage-employees', deployed: true, version: deployed.version, status: deployed.status, previousVersion: previous.version }))
  const confirmed = await mcp.call('get_edge_function', { function_slug: 'manage-employees' })
  const source = (confirmed.files ?? []).map(file => file.content).join('\n')
  if (!source.includes('employees-2026-11-registration-v4') || !source.includes("return 'Gaby.0522123'")) throw new Error('Published source did not match release')
  console.log(JSON.stringify({ publishedSourceConfirmed: true, version: confirmed.version, contract: 'employees-2026-11-registration-v4' }))
} finally { mcp.close() }
