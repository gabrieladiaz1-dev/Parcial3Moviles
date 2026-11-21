import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hospitalDate, atMidnight, addDays, monday, overlapsDay, selectedDates } from '../src/lib/planningDates.ts'
import { scheduleDates, toggleDay, savedScheduleGroups } from '../src/lib/planningGroups.ts'

test('hospital date uses Guatemala even when the browser runs elsewhere', () => {
  assert.equal(hospitalDate('2026-11-14T02:00:00Z'), '2026-11-13')
  assert.equal(atMidnight('2026-11-13'), '2026-11-13T00:00:00-06:00')
})
test('weekly navigation crosses months, years and leap days', () => {
  assert.equal(monday('2026-11-15'), '2026-11-09')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
})
test('night shift appears on both days and uses half-open boundaries', () => {
  const start = '2026-11-13T22:00:00-06:00', end = '2026-11-14T06:00:00-06:00'
  assert.equal(overlapsDay(start, end, '2026-11-13'), true)
  assert.equal(overlapsDay(start, end, '2026-11-14'), true)
  assert.equal(overlapsDay(start, end, '2026-11-15'), false)
  assert.equal(overlapsDay(start, '2026-11-14T00:00:00-06:00', '2026-11-14'), false)
})
test('repeating workdays are concrete dates with bounded batches', () => {
  assert.deepEqual(selectedDates('2026-11-09', '2026-11-15', [1,3,5]), ['2026-11-09', '2026-11-11', '2026-11-13'])
  assert.throws(() => selectedDates('2026-11-09', '2026-11-15', []))
  assert.throws(() => selectedDates('2026-11-15', '2026-11-09', [1]))
  assert.throws(() => selectedDates('2026-01-01', '2026-12-31', [0,1,2,3,4,5,6]))
})

test('multi-day state produces five actual dates from a Friday, not just Friday', () => {
  let days = []
  for (const day of [1, 2, 3, 4, 5]) days = toggleDay(days, day)
  assert.deepEqual(scheduleDates('2026-11-13', '', days), ['2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'])
  assert.deepEqual(scheduleDates('2026-11-13', '', [0, 2, 6]), ['2026-11-14', '2026-11-15', '2026-11-17'])
  assert.throws(() => scheduleDates('2026-11-13', '2026-11-13', days), /no incluye todos/)
})
test('saved groups reconstruct the exact persisted dates after reload', () => {
  const dates = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']
  const data = { staff: [], rooms: [], floors: [], ready: true, shifts: [], absences: [], consultations: [],
    saved_shifts: dates.map((date, i) => ({ id: `work-${i}`, staff_id: 'doctor', starts_at: `${date}T08:00:00-06:00`, ends_at: `${date}T16:00:00-06:00`, shift_type: 'ordinario', status: 'programado', version: '1' })),
    saved_consultations: dates.map((date, i) => ({ id: `medical-${i}`, doctor_id: 'doctor', consulting_room_id: 'room', starts_at: `${date}T09:00:00-06:00`, ends_at: `${date}T12:00:00-06:00`, active: true, slot_minutes: 30, version: '1' })), saved_absences: [] }
  const [group] = savedScheduleGroups(JSON.parse(JSON.stringify(data)))
  assert.deepEqual(group.dates, dates)
  assert.equal(group.originals.length, 10)
  assert.equal(group.consultations[0].roomId, 'room')
})
