import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/pages/TeacherSettings/TeacherSettings.jsx", "utf8");
const css = readFileSync("src/pages/TeacherSettings/TeacherSettings.module.css", "utf8");

for (const tab of ["profile", "learning", "finance", "taxes", "display", "security"]) {
  test(`teacher settings retains a mounted ${tab} tab panel`, () => {
    assert.match(page, new RegExp(`hidden=\\{activeTab !== "${tab}"\\}`));
  });
}
test("legacy anchors resolve to the existing sections", () => {
  for (const anchor of ["finance-preferences", "payment-accounts", "tax-profile", "tax-parameters"]) {
    assert.ok(page.includes(`id="${anchor}"`));
  }
});
test("hidden form panels are removed from layout without unmounting", () => {
  assert.match(css, /\.tabPanel\[hidden\]\s*\{\s*display:\s*none/);
});
for (const lang of ["ua", "en", "ru"]) {
  test(`${lang} has labels for all teacher tabs`, () => {
    const locale = JSON.parse(readFileSync(`src/locales/${lang}/translation.json`, "utf8"));
    for (const tab of ["profile", "learning", "finance", "taxes", "display", "security"]) {
      assert.ok(locale.teacherSettings.tabs[tab]);
    }
  });
}
