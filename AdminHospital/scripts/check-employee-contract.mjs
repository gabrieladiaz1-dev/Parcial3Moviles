// Read-only preflight. Tokens must exist only in the calling process environment.
import { employeeContract } from '../supabase/functions/manage-employees/contract.ts'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const token = process.env.HOSPITAL_TEST_ADMIN_ACCESS_TOKEN
const expectedProject = process.argv.find(argument => argument.startsWith('--project-ref='))?.split('=')[1]

if (!url || !key || !token || !expectedProject) {
  console.error('Preflight pendiente: requiere URL, clave pública, sesión administrativa en memoria y --project-ref=REFERENCIA. No se hizo ninguna solicitud.')
  process.exit(2)
}

const endpoint = new URL('/functions/v1/manage-employees', url)
if (endpoint.hostname !== `${expectedProject}.supabase.co` || endpoint.protocol !== 'https:') {
  console.error('El proyecto configurado no coincide con --project-ref. No se hizo ninguna solicitud.')
  process.exit(2)
}

try {
  const response = await fetch(endpoint, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'contract' }), signal: AbortSignal.timeout(15000) })
  const body = await response.json().catch(() => ({}))
  const actions = ['detail', 'update', 'state']
  const compatible = response.ok && body.version === employeeContract.version && actions.every(action => body.actions?.includes(action)) && employeeContract.features.every(feature => body.features?.includes(feature))
  console.log(JSON.stringify({ verified: compatible, status: response.status, expectedVersion: employeeContract.version, deployedVersion: response.ok && typeof body.version === 'string' ? body.version : null, requiredActions: actions, writesPerformed: false }, null, 2))
  if (!compatible) process.exitCode = 1
} catch {
  console.error('No se pudo comprobar el contrato remoto. No se efectuaron escrituras ni se imprimieron credenciales.')
  process.exitCode = 1
}
