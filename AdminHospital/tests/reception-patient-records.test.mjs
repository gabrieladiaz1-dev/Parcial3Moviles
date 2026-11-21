import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapPatientRecord } from '../src/lib/receptionPatientRecords.ts'

test('maps an embedded medical record without changing the patient row', () => {
  const row = { id: 'patient-1', first_name: 'Paciente', medical_records: [{ id: 'record-1', record_code: 'EXP-001' }] }
  const patient = mapPatientRecord(row)
  assert.deepEqual(patient, { id: 'patient-1', first_name: 'Paciente', record_id: 'record-1', record_code: 'EXP-001' })
  assert.equal(row.medical_records.length, 1)
})

test('preserves a patient with no medical record as an unmatched candidate', () => {
  assert.deepEqual(mapPatientRecord({ id: 'patient-2', medical_records: [] }), {
    id: 'patient-2',
    record_id: null,
    record_code: null,
  })
})

test('rejects ambiguous duplicate records instead of selecting one silently', () => {
  assert.throws(
    () => mapPatientRecord({ id: 'patient-3', medical_records: [{ id: 'record-1', record_code: 'EXP-001' }, { id: 'record-2', record_code: 'EXP-002' }] }),
    /expediente único/,
  )
})
