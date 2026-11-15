import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = fs.readFileSync(
  "src/pages/TeacherSettings/TeacherSettings.jsx",
  "utf8",
);
const child = (name) => fs.readFileSync(name, "utf8");

test("teacher settings uses shared navigation guard and confirmation dialog", () => {
  
  assert.match(root, /useUnsavedChangesGuard\(\)/);
  assert.match(root, /<UnsavedChangesDialog/);
  assert.match(root, /setFormDirty\("taxParameters"/);
});
test("teacher settings guards tax date changes before loading", () => {
  const source = fs.readFileSync(
    "src/pages/TeacherSettings/TeacherSettings.jsx",
    "utf8",
  );

  assert.match(
    source,
    /if\s*\(hasDirtyParameters\)\s*\{[\s\S]*?setPendingParameterDate\(nextDate\);[\s\S]*?return;/,
  );
});

test("payment instructions compares all currencies, not just the selected one", () => {
  const source = fs.readFileSync(
    "src/features/finance/components/TeacherPaymentInstructionsSection.jsx",
    "utf8",
  );

  assert.match(source, /setSavedItems\(nextSavedItems\)/);
  assert.match(source, /CURRENCIES\.some\(/);
  assert.match(source, /savedItems\[code\]/);
});
test("password passes a dirty flag, not credentials", () => {
  const text = child("src/features/auth/components/ChangePasswordForm.jsx");
  assert.match(text, /const dirty = Boolean/);
  assert.match(text, /onDirtyChange\?\.\(dirty\)/);
});
