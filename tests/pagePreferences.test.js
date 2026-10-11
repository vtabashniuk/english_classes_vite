import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAGE_PREFERENCES, PAGE_SIZE_OPTIONS, normalizePagePreferences,
  TEACHER_PAGE_KEYS, STUDENT_PAGE_KEYS,
} from '../src/shared/pagination/pagePreferences.js';

test('Default preferences match agreed teacher and student list sizes', () => {
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherMaterials, 20);
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherCollections, 20);
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherCollectionList, 20);
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherStudentMaterials, 10);
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherPendingAssignments, 2);
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherCompletedAssignments, 3);
  assert.equal(DEFAULT_PAGE_PREFERENCES.teacherNotifications, 20);
  assert.equal(DEFAULT_PAGE_PREFERENCES.studentMaterials, 10);
  assert.equal(DEFAULT_PAGE_PREFERENCES.studentPendingAssignments, 2);
  assert.equal(DEFAULT_PAGE_PREFERENCES.studentCompletedAssignments, 3);
  assert.equal(DEFAULT_PAGE_PREFERENCES.studentNotifications, 20);
});

test('Invalid or unknown preferences are ignored while valid choices survive', () => {
  const result = normalizePagePreferences({ teacherMaterials: 50, studentMaterials: 4,
    teacherNotifications: '20', extra: 3 });
  assert.equal(result.teacherMaterials, 50);
  assert.equal(result.studentMaterials, 10);
  assert.equal(result.teacherNotifications, 20);
  assert.equal(result.extra, undefined);
});

test('All page settings have a default in the supported options', () => {
  for (const key of [...TEACHER_PAGE_KEYS, ...STUDENT_PAGE_KEYS]) {
    assert.ok(PAGE_SIZE_OPTIONS.includes(DEFAULT_PAGE_PREFERENCES[key]));
  }
  assert.equal(new Set([...TEACHER_PAGE_KEYS, ...STUDENT_PAGE_KEYS]).size, 11);
});

test('Collection list and collection contents have independent page sizes', () => {
  const prefs = normalizePagePreferences({ teacherCollectionList: 5, teacherCollections: 50 });
  assert.equal(prefs.teacherCollectionList, 5);
  assert.equal(prefs.teacherCollections, 50);
});
