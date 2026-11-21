import assert from 'node:assert/strict'
import { test } from 'node:test'
import { institutionMapUrl } from '../src/lib/institutionMap.ts'
import { panelNoticeTarget } from '../src/lib/panelNavigation.ts'

test('maps use configured coordinates or address and never guess a location', () => {
  assert.equal(institutionMapUrl(null), null)
  assert.equal(institutionMapUrl({ latitude: null, longitude: null, address: '  ' }), null)
  assert.equal(new URL(institutionMapUrl({ latitude: 14, longitude: -89, address: 'Synthetic' })).searchParams.get('query'), '14,-89')
  const url = new URL(institutionMapUrl({ latitude: null, longitude: null, address: 'Official address & entrance #2' }))
  assert.equal(url.origin, 'https://www.google.com')
  assert.equal(url.searchParams.get('query'), 'Official address & entrance #2')
})

test('notifications open their specific existing record and reject invalid targets', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  assert.deepEqual(panelNoticeTarget({ entity_type: 'appointment_requests', entity_id: id }), { page: 'Recepción', tab: 'Solicitudes de atención', id })
  assert.deepEqual(panelNoticeTarget({ entity_type: 'hospital_admissions', entity_id: id }), { page: 'Recepción', tab: 'Hospitalización', id })
  assert.deepEqual(panelNoticeTarget({ entity_type: 'lab_orders', entity_id: id }), { page: 'Laboratorios', id })
  assert.deepEqual(panelNoticeTarget({ entity_type: 'ambulance_requests', entity_id: id }), { page: 'Ambulancia', requestId: id })
  assert.deepEqual(panelNoticeTarget({ entity_type: 'ambulances', entity_id: '2' }), { page: 'Ambulancia', unitId: 2 })
  assert.equal(panelNoticeTarget({ entity_type: 'profiles', entity_id: id }), null)
  assert.equal(panelNoticeTarget({ entity_type: 'ambulances', entity_id: 'NaN' }), null)
  assert.equal(panelNoticeTarget({ entity_type: 'appointment_requests', entity_id: 'invalid' }), null)
})
