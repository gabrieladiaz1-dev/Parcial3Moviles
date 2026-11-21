import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { productionProjectRef } from '../src/lib/supabaseConfig.ts'

test('final acceptance refuses production before attempting a network request', () => {
  const script = fileURLToPath(new URL('./planning-acceptance.mjs', import.meta.url))
  const noNetwork = 'data:text/javascript,' + encodeURIComponent("globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_GUARD_TEST') }")
  const result = spawnSync(process.execPath, ['--import', noNetwork, script], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
    env: { ...process.env,
      PLANNING_ACCEPTANCE_PROJECT_REF: productionProjectRef,
      PLANNING_ACCEPTANCE_URL: `https://${productionProjectRef}.supabase.co`,
      PLANNING_ACCEPTANCE_ALLOW_WRITES: 'staging-only',
      PLANNING_ACCEPTANCE_PUBLISHABLE_KEY: 'not-a-real-key',
      PLANNING_ACCEPTANCE_ADMIN_TOKEN: 'not-a-real-token',
    },
  })
  assert.ifError(result.error)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /production is forbidden/)
  assert.doesNotMatch(result.stderr, /NETWORK_FORBIDDEN_IN_GUARD_TEST/)
})
