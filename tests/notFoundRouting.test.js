import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const router = read("src/router.jsx");
const page = read("src/pages/NotFoundPage/NotFoundPage.jsx");

test("404 is rendered inside public and both protected dashboard layouts", () => {
  assert.equal((router.match(/path: "\*"/g) || []).length, 3);
  const publicBlock = router.slice(router.indexOf('element: <PublicLayout />'), router.indexOf('path: "/student-area"'));
  const studentBlock = router.slice(router.indexOf('path: "/student-area"'), router.indexOf('path: "/teacher-dashboard"'));
  const teacherBlock = router.slice(router.indexOf('path: "/teacher-dashboard"'), router.indexOf('path: "/auth/google/callback"'));
  for (const block of [publicBlock, studentBlock, teacherBlock]) {
    assert.match(block, /path: "\*",\s*element: showPage\(NotFoundPage\)/);
  }
  assert.match(studentBlock, /<ProtectedRoute allowedRoles=\{\["student"\]\}>/);
  assert.match(teacherBlock, /<ProtectedRoute allowedRoles=\{\["teacher"\]\}>/);
});

test("404 return link respects dashboard route prefix", () => {
  assert.match(page, /pathname\.startsWith\("\/teacher-dashboard\/"\)/);
  assert.match(page, /pathname\.startsWith\("\/student-area\/"\)/);
  assert.match(page, /to=\{dashboardPath \?\? "\/"\}/);
});

test("404 strings exist for all supported languages", () => {
  for (const lang of ["ua", "en", "ru"]) {
    const translation = JSON.parse(read(`src/locales/${lang}/translation.json`));
    for (const key of ["title", "description", "backHome", "backDashboard"]) {
      assert.ok(translation.notFound[key], `${lang}: notFound.${key}`);
    }
  }
});
