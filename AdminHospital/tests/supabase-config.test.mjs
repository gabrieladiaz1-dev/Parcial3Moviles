import assert from 'node:assert/strict'
import { test } from 'node:test'
import { productionProjectRef, resolveSupabaseUrl } from '../src/lib/supabaseConfig.ts'
const production = `https://${productionProjectRef}.supabase.co`
const stageRef = 'abcdefghijklmnopqrst'
const stage = `https://${stageRef}.supabase.co`
test('production is pinned even if staging configuration is present', () => {
  assert.equal(resolveSupabaseUrl(production + '/rest/v1/', 'production', stageRef), production)
  assert.equal(resolveSupabaseUrl(stage, 'production', stageRef), null)
})
test('staging fails closed without a distinct explicit ref', () => {
  assert.equal(resolveSupabaseUrl(stage, 'staging'), null)
  assert.equal(resolveSupabaseUrl(production, 'staging', productionProjectRef), null)
  assert.equal(resolveSupabaseUrl(production, 'staging', stageRef), null)
  assert.equal(resolveSupabaseUrl(stage, 'staging', stageRef), stage)
})
test('reject unsafe origins and embedded credentials', () => {
  assert.equal(resolveSupabaseUrl(production.replace('https:', 'http:'), 'production'), null)
  assert.equal(resolveSupabaseUrl(production + '.evil.test', 'production'), null)
  assert.equal(resolveSupabaseUrl(production.replace('https://', 'https://user:pass@'), 'production'), null)
})
