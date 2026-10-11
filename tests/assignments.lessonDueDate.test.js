import test from 'node:test';
import assert from 'node:assert/strict';
import { getLessonDueDate } from '../src/features/assignments/lib/lessonDueDate.js';

test('Lesson-linked deadline uses the teacher schedule date, not the browser timezone', () => {
  assert.equal(getLessonDueDate('2026-10-12T22:30:00Z','Europe/Kyiv'), '2026-10-13');
  assert.equal(getLessonDueDate('2026-10-12T22:30:00Z','UTC'), '2026-10-12');
  assert.equal(getLessonDueDate('2026-10-12T22:30:00Z','America/New_York'), '2026-10-12');
});
test('Daylight saving transition does not shift local deadline', () => {
  assert.equal(getLessonDueDate('2026-10-25T00:30:00Z','Europe/Kyiv'), '2026-10-25');
  assert.equal(getLessonDueDate('2026-10-25T23:30:00Z','Europe/Kyiv'), '2026-10-26');
});
