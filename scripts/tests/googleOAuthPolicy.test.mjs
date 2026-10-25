import assert from "node:assert/strict";
import { test } from "node:test";

import { getGooglePostLoginRoute, hasGoogleIdentity, isRecentGoogleOAuthStart } from "../../src/features/auth/lib/googleOAuthPolicy.js";

test("existing teacher routes to teacher dashboard", () => {
  assert.equal(getGooglePostLoginRoute({ profile: { role: "teacher", is_active: true }, hasTeacherLink: false }), "/teacher-dashboard");
});
test("pending student without teacher routes to consent", () => {
  assert.equal(getGooglePostLoginRoute({ profile: { role: "student", is_active: true }, hasTeacherLink: false }), "/google/accept-invitation");
});
test("existing student with teacher routes to dashboard", () => {
  assert.equal(getGooglePostLoginRoute({ profile: { role: "student", is_active: true }, hasTeacherLink: true }), "/student-area");
});
test("inactive, unknown, and missing profiles are rejected", () => {
  assert.equal(getGooglePostLoginRoute({ profile: { role: "teacher", is_active: false } }), null);
  assert.equal(getGooglePostLoginRoute({ profile: { role: "admin", is_active: true } }), null);
  assert.equal(getGooglePostLoginRoute({ profile: null }), null);
});
test("Google identity must exist", () => {
  assert.equal(hasGoogleIdentity({ identities: [{ provider: "email" }] }), false);
  assert.equal(hasGoogleIdentity({ identities: [{ provider: "email" }, { provider: "google" }] }), true);
  assert.equal(hasGoogleIdentity({}), false);
});
test("OAuth initiation marker cannot be stale or in the future", () => {
  const now = 1000000;
  assert.equal(isRecentGoogleOAuthStart(now - 1000, now), true);
  assert.equal(isRecentGoogleOAuthStart(now - 600001, now), false);
  assert.equal(isRecentGoogleOAuthStart(now + 1, now), false);
  assert.equal(isRecentGoogleOAuthStart(NaN, now), false);
});
