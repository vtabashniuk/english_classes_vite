import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFileSync(path.join(root, file), "utf8");
const router = source("src/router.jsx");
const login = source("src/pages/LoginPage/LoginPage.jsx");
const footer = source("src/components/common/Footer.jsx");
const informationPage = source("src/pages/PublicInfoPage/PublicInfoPage.jsx");
const languages = ["ua", "en", "ru"];
const sectionsByPage = { about: 4, privacy: 9, terms: 7 };

test("all three public information routes belong to the public layout", () => {
  const publicBlock = router.split('path: "/student-area"')[0];
  assert.match(publicBlock, /element: <PublicLayout\s*\/>/);
  assert.match(publicBlock, /const PublicInfoPage = lazy/);
  for (const route of Object.keys(sectionsByPage)) {
    assert.match(publicBlock, new RegExp(`path: "/${route}",[\\s\\S]*?element: showPage\\(PublicInfoPage\\)`));
  }
  assert.doesNotMatch(publicBlock, /<ProtectedRoute/);
});

test("the login page and footer link to every information route", () => {
  for (const route of Object.keys(sectionsByPage)) {
    assert.ok(login.includes(`<Link to="/${route}">`), `login missing /${route}`);
    assert.ok(footer.includes(`<Link to="/${route}">`), `footer missing /${route}`);
    assert.ok(informationPage.includes(`"/${route}": "${route}"`));
  }
});

test("information policy has equivalent structure in each of the three locales", () => {
  for (const language of languages) {
    const locale = JSON.parse(source(`src/locales/${language}/translation.json`));
    const info = locale.publicInfo;
    assert.ok(info.navigationLabel);
    assert.ok(info.contactText);
    for (const [page, count] of Object.entries(sectionsByPage)) {
      assert.ok(info.navigation[page], `${language}: ${page} link`);
      assert.ok(info[page].title, `${language}: ${page} title`);
      assert.ok(info[page].lead, `${language}: ${page} lead`);
      assert.equal(info[page].sections.length, count, `${language}: ${page} sections`);
      for (const section of info[page].sections) {
        assert.ok(section.title);
        assert.ok(section.paragraphs.length > 0 || section.bullets?.length > 0);
      }
    }
  }
});

test("public policy content requires no authentication and includes accessible contact", () => {
  assert.doesNotMatch(informationPage, /useAuth|ProtectedRoute|signInWithGoogle|supabase/i);
  assert.match(informationPage, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(informationPage, /<main /);
  assert.match(informationPage, /aria-label=/);
});
