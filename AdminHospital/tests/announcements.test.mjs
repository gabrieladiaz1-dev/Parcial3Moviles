import test from 'node:test'
import assert from 'node:assert/strict'
import { announcementProblem, announcementState, isoToLocal, localToIso } from '../src/lib/announcementRules.ts'

const now = new Date('2026-11-21T12:00:00Z')
const item = values => ({ id: 'a', title: 'T', content: 'C', published_at: '2026-11-20T12:00:00Z', expires_at: null, is_public: true, author: null, ...values })

test('estado del aviso igual que lo que ve el paciente', () => {
  assert.equal(announcementState(item({}), now), 'Visible')
  assert.equal(announcementState(item({ is_public: false }), now), 'Borrador')
  assert.equal(announcementState(item({ expires_at: '2026-11-21T11:59:00Z' }), now), 'Vencido')
  assert.equal(announcementState(item({ published_at: '2026-11-22T00:00:00Z' }), now), 'Programado')
})

test('fecha local de El Salvador (UTC-6) ida y vuelta', () => {
  assert.equal(localToIso('2026-11-21T08:30'), '2026-11-21T14:30:00.000Z')
  assert.equal(isoToLocal('2026-11-21T14:30:00.000Z'), '2026-11-21T08:30')
  assert.equal(localToIso(''), null)
})

test('validación igual que save_announcement', () => {
  const ok = { title: 'Horario de visitas', content: 'De 2 a 5 p. m.', isPublic: true, publishedAt: '', expiresAt: '' }
  assert.equal(announcementProblem(ok), null)
  assert.match(announcementProblem({ ...ok, title: ' ' }), /título/)
  assert.match(announcementProblem({ ...ok, content: 'x'.repeat(2001) }), /contenido/)
  assert.match(announcementProblem({ ...ok, publishedAt: '2026-11-22T10:00', expiresAt: '2026-11-22T09:00' }), /posterior/)
})
