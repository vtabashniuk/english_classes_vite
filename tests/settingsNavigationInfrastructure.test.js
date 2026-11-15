import assert from "node:assert/strict";
import test from "node:test";
import { getSettingsTab, getLegacyTeacherSettingsTab, withSettingsTab } from "../src/shared/settings/settingsTabs.js";
import { hasUnsavedChanges, updateDirtyForm } from "../src/shared/unsavedChanges/dirtyForms.js";

const teacherTabs = ["profile", "learning", "finance", "taxes", "display", "security"];

test("tab selection uses a supported tab or the default", () => {
  assert.equal(getSettingsTab("?tab=finance", teacherTabs), "finance");
  assert.equal(getSettingsTab("?tab=other", teacherTabs), "profile");
  assert.equal(getSettingsTab("?tab=__proto__", teacherTabs), "profile");
  assert.equal(getSettingsTab("", teacherTabs), "profile");
});

test("changing tabs preserves other query parameters", () => {
  assert.equal(withSettingsTab("?foo=one&tab=profile", "security"), "?foo=one&tab=security");
});

test("existing teacher deep links map to their target tabs", () => {
  assert.equal(getLegacyTeacherSettingsTab("#finance-preferences"), "finance");
  assert.equal(getLegacyTeacherSettingsTab("#payment-accounts"), "finance");
  assert.equal(getLegacyTeacherSettingsTab("#tax-profile"), "taxes");
  assert.equal(getLegacyTeacherSettingsTab("#tax-parameters"), "taxes");
  assert.equal(getLegacyTeacherSettingsTab("#does-not-exist"), null);
});

test("dirty registry tracks independent forms and supports resetting", () => {
  const a = updateDirtyForm({}, "profile", true);
  const b = updateDirtyForm(a, "finance", true);
  const c = updateDirtyForm(b, "profile", false);
  assert.equal(hasUnsavedChanges(a), true);
  assert.equal(hasUnsavedChanges(b), true);
  assert.equal(hasUnsavedChanges(c), true);
  assert.deepEqual(updateDirtyForm(c, "finance", false), {});
  assert.equal(hasUnsavedChanges({}), false);
  assert.equal(updateDirtyForm(b, "finance", true), b);
});

test("registry does not store field values", () => {
  assert.deepEqual(updateDirtyForm({}, "password", true), { password: true });
});
