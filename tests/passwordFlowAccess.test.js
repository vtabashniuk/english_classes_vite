import test from "node:test";
import assert from "node:assert/strict";

import {
  hasValidPasswordFlowGrant,
  isVerifiedImplicitInvitation,
  validateNewPassword,
  PASSWORD_FLOW_TTL_MS,
} from "../src/features/auth/lib/passwordFlowAccess.js";

test("ordinary signed-in users have no invite or recovery grant", () => {
  const now = 1000000;
  assert.equal(hasValidPasswordFlowGrant(null, { kind: "invite", userId: "u1", now }), false);
  assert.equal(hasValidPasswordFlowGrant(null, { kind: "recovery", userId: "u1", now }), false);
});

test("password flow is bound to exact user and purpose", () => {
  const issuedAt = 1234;
  const grant = { kind: "recovery", userId: "student-a", issuedAt };
  const check = (kind, userId) => hasValidPasswordFlowGrant(grant, { kind, userId, now: 2000 });
  assert.equal(check("recovery", "student-a"), true);
  assert.equal(check("invite", "student-a"), false);
  assert.equal(check("recovery", "student-b"), false);
});

test("expired and future grants are rejected", () => {
  const grant = { kind: "invite", userId: "a", issuedAt: 100 };
  const check = (now) => hasValidPasswordFlowGrant(grant, { kind: "invite", userId: "a", now });
  assert.equal(check(99), false);
  assert.equal(check(100 + PASSWORD_FLOW_TTL_MS - 1), true);
  assert.equal(check(100 + PASSWORD_FLOW_TTL_MS), false);
});

test("forged URL flags and mismatched tokens do not open invitation UI", () => {
  const session = { user: { id: "user" }, access_token: "valid-token" };
  assert.equal(isVerifiedImplicitInvitation("#type=invite", session, "/set-password"), false);
  assert.equal(isVerifiedImplicitInvitation("#type=invite&access_token=wrong&refresh_token=x", session, "/set-password"), false);
  assert.equal(isVerifiedImplicitInvitation("#type=invite&access_token=valid-token&refresh_token=x", session, "/login"), false);
  assert.equal(isVerifiedImplicitInvitation("#type=recovery&access_token=valid-token&refresh_token=x", session, "/set-password"), false);
  assert.equal(isVerifiedImplicitInvitation("#type=invite&access_token=valid-token&refresh_token=x", session, "/set-password"), true);
});

test("new password validation shared by invite and recovery", () => {
  assert.equal(validateNewPassword("short", "short"), "tooShort");
  assert.equal(validateNewPassword("eightchars", "different"), "mismatch");
  assert.equal(validateNewPassword("eightchars", "eightchars"), null);
});
