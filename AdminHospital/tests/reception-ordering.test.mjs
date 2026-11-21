import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderAttentionRequests } from '../src/lib/receptionOrdering.ts'

test('pending work is ordered by state then oldest date, without mutating the input', () => {
  const rows = [
    { id: 'scheduled', status: 'agendada', created_at: '2026-01-01T00:00:00Z' },
    { id: 'new', status: 'pendiente', created_at: '2026-11-13T12:00:00Z' },
    { id: 'review', status: 'en_revision', created_at: '2026-11-01T12:00:00Z' },
    { id: 'old', status: 'pendiente', created_at: '2026-11-01T12:00:00Z' },
    { id: 'rejected', status: 'rechazada', created_at: '2025-01-01T00:00:00Z' },
  ]
  const before = structuredClone(rows)
  assert.deepEqual(orderAttentionRequests(rows).map(r => r.id), ['old', 'new', 'review', 'scheduled', 'rejected'])
  assert.deepEqual(orderAttentionRequests(rows, 'newest').map(r => r.id), ['new', 'old', 'review', 'scheduled', 'rejected'])
  assert.deepEqual(rows, before)
})

test('equal dates have deterministic ordering across loaded pages', () => {
  const rows = ['b', 'a'].map(id => ({ id, status: 'pendiente', created_at: '2026-11-13T12:00:00Z' }))
  assert.deepEqual(orderAttentionRequests(rows).map(r => r.id), ['a', 'b'])
})
