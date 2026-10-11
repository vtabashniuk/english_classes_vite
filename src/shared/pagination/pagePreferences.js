/** Page lengths are per account, not per student being viewed. */
export const PAGE_SIZE_OPTIONS = Object.freeze([2, 3, 5, 10, 20, 50]);
export const DEFAULT_PAGE_PREFERENCES = Object.freeze({
  teacherMaterials: 20,
  teacherCollections: 20,
  teacherCollectionList: 20,
  teacherStudentMaterials: 10,
  teacherPendingAssignments: 2,
  teacherCompletedAssignments: 3,
  teacherNotifications: 20,
  studentMaterials: 10,
  studentPendingAssignments: 2,
  studentCompletedAssignments: 3,
  studentNotifications: 20,
});
export const TEACHER_PAGE_KEYS = Object.freeze([
  "teacherMaterials", "teacherCollectionList", "teacherCollections", "teacherStudentMaterials",
  "teacherPendingAssignments", "teacherCompletedAssignments", "teacherNotifications",
]);
export const STUDENT_PAGE_KEYS = Object.freeze([
  "studentMaterials", "studentPendingAssignments", "studentCompletedAssignments", "studentNotifications",
]);

export const normalizePagePreferences = (raw) =>
  Object.fromEntries(Object.entries(DEFAULT_PAGE_PREFERENCES).map(([key, fallback]) => {
    const value = raw?.[key];
    return [key, Number.isInteger(value) && PAGE_SIZE_OPTIONS.includes(value) ? value : fallback];
  }));
