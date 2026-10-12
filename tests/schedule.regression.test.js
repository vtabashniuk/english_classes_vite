import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTimeSlots,
  createDisplayTimeSlots,
  getDatePartsInTimezone,
  formatZonedDateForInput,
  isSlotBlockedByLesson,
  isSlotBlockedByScheduleBlock,
  parseInputDate,
} from '../src/features/schedule/lib/scheduleUtils.js';

const TIME_ZONE = 'Europe/Kyiv';
const DATE = parseInputDate('2026-10-14');
// 10:30–11:20 and 11:00–12:00 Kyiv, while daylight saving time is active.
const lesson = {
  starts_at: '2026-10-14T07:30:00Z',
  ends_at: '2026-10-14T08:20:00Z',
  status: 'scheduled',
};
const block = {
  starts_at: '2026-10-14T08:00:00Z',
  ends_at: '2026-10-14T09:00:00Z',
};

test('schedule: 50-minute lessons in 30-minute slots cannot start after the workday', () => {
  const slots = createTimeSlots('09:00', '19:00', 50, 30);
  assert.equal(slots[0], '09:00');
  assert.equal(slots.at(-1), '18:00');
  assert.equal(slots.length, 19);
  assert.equal(slots.includes('18:30'), false);
});

test('schedule: display grid retains half-hour markers until the end of the day', () => {
  const slots = createDisplayTimeSlots('09:00', '19:00', 30);
  assert.deepEqual(slots.slice(0, 3), ['09:00', '09:30', '10:00']);
  assert.equal(slots.at(-1), '18:30');
  assert.equal(slots.length, 20);
});

test('schedule: a scheduled lesson blocks partial overlap but not a touching boundary', () => {
  assert.equal(isSlotBlockedByLesson(DATE, '10:00', [lesson], TIME_ZONE, 50), true);
  assert.equal(isSlotBlockedByLesson(DATE, '11:20', [lesson], TIME_ZONE, 50), false);
  assert.equal(isSlotBlockedByLesson(DATE, '10:30', [lesson], TIME_ZONE, 50), true);
});

test('schedule: cancelled lessons do not block availability', () => {
  assert.equal(isSlotBlockedByLesson(DATE, '10:30', [{ ...lesson, status: 'cancelled' }], TIME_ZONE, 50), false);
});

test('schedule: a block prevents partial overlap, but not slots ending or starting at the boundary', () => {
  assert.equal(isSlotBlockedByScheduleBlock(DATE, '10:30', [block], TIME_ZONE, 50), true);
  assert.equal(isSlotBlockedByScheduleBlock(DATE, '10:00', [block], TIME_ZONE, 50), false);
  assert.equal(isSlotBlockedByScheduleBlock(DATE, '12:00', [block], TIME_ZONE, 50), false);
});

test('schedule: blocks on another Kyiv calendar day do not occupy this day', () => {
  const otherDay = parseInputDate('2026-10-15');
  assert.equal(isSlotBlockedByScheduleBlock(otherDay, '11:00', [block], TIME_ZONE, 50), false);
});

test('schedule: a UTC timestamp maps to different calendar days in Kyiv and Los Angeles', () => {
  const utc = '2026-10-24T22:30:00Z';
  assert.equal(formatZonedDateForInput(utc, TIME_ZONE), '2026-10-25');
  assert.equal(formatZonedDateForInput(utc, 'America/Los_Angeles'), '2026-10-24');
});

test('schedule: fall daylight-saving change preserves Kyiv-local wall-clock time', () => {
  const before = getDatePartsInTimezone('2026-10-25T00:30:00Z', TIME_ZONE);
  const after = getDatePartsInTimezone('2026-10-25T01:30:00Z', TIME_ZONE);
  assert.equal(before.hour, 3);
  assert.equal(after.hour, 3);
  assert.equal(before.minute, 30);
  assert.equal(after.minute, 30);
});
