import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssignmentOverdue, splitAssignmentsByCompletion } from '../src/features/assignments/lib/assignmentStatus.js';

test('Due date remains on time through the full local calendar day', () => {
  assert.equal(isAssignmentOverdue({ status: 'assigned', due_date: '2026-10-11' }, '2026-10-11'), false);
  assert.equal(isAssignmentOverdue({ status: 'assigned', due_date: '2026-10-11' }, '2026-10-12'), true);
});
test('No deadline and completed assignments are never overdue', () => {
  assert.equal(isAssignmentOverdue({ status: 'assigned', due_date: null }, '2026-10-12'), false);
  assert.equal(isAssignmentOverdue({ status: 'completed', due_date: '2026-09-01' }, '2026-10-12'), false);
});
test('Completed and incomplete remain separate without losing unbound homework', () => {
  const entries = [{ id: 1, status: 'assigned', lesson_id: null }, { id: 2, status: 'completed', lesson_id: 'lesson' }];
  const groups = splitAssignmentsByCompletion(entries);
  assert.deepEqual(groups.pending.map(x => x.id), [1]);
  assert.deepEqual(groups.completed.map(x => x.id), [2]);
});
