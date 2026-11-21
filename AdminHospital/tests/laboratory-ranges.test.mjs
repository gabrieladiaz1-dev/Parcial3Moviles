import assert from 'node:assert/strict'
import { test } from 'node:test'
import { laboratoryRangeFlag } from '../src/lib/laboratoryRanges.ts'

test('range flags require a validated universal numeric scope and inclusive boundaries', () => {
  const parameter = { type: 'number', range_scope: 'all_patients', low: '1', high: '10' }
  assert.equal(laboratoryRangeFlag(parameter, '0.9'), 'low')
  assert.equal(laboratoryRangeFlag(parameter, '10.1'), 'high')
  assert.equal(laboratoryRangeFlag(parameter, '1'), 'within')
  assert.equal(laboratoryRangeFlag(parameter, '10'), 'within')
  assert.equal(laboratoryRangeFlag({ ...parameter, range_scope: 'age_specific' }, '15'), null)
  assert.equal(laboratoryRangeFlag({ ...parameter, type: 'qualitative' }, '15'), null)
  assert.equal(laboratoryRangeFlag({ ...parameter, low: '', high: null }, '15'), null)
})

test('empty, nonfinite and invalid ranges are never interpreted as clinical alerts', () => {
  const parameter = { type: 'number', range_scope: 'all_patients', low: 0, high: 2 }
  for (const value of ['', ' ', 'NaN', 'Infinity', '2 mg', '1,5', '1e309']) assert.equal(laboratoryRangeFlag(parameter, value), null)
  assert.equal(laboratoryRangeFlag({ ...parameter, low: 5, high: 1 }, '3'), null)
  assert.equal(laboratoryRangeFlag({ ...parameter, low: null }, '-20'), 'within')
  assert.equal(laboratoryRangeFlag({ ...parameter, high: null }, '-20'), 'low')
})
