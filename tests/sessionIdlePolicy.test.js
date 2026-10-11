import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_LIMIT_MS,
  IDLE_WARNING_MS,
  formatIdleCountdown,
  getIdleActivityStorageKey,
  getIdleSnapshot,
  parseStoredIdleActivity,
  serializeIdleActivity,
} from "../src/features/auth/lib/sessionIdlePolicy.js";

const at = 1_790_000_000_000;
const check = (role, elapsed) => getIdleSnapshot({ role, lastActiveAt: at, now: at + elapsed });

test("idle: teacher stays signed in before 88 minutes", () => {
  assert.equal(check("teacher", IDLE_LIMIT_MS.teacher - IDLE_WARNING_MS - 1).status, "active");
});
test("idle: teacher sees warning exactly two minutes before 90 minute expiry", () => {
  assert.equal(check("teacher", 88 * 60 * 1000).status, "warning");
  assert.equal(check("teacher", 90 * 60 * 1000).status, "expired");
});
test("idle: student sees warning at 58 minutes and expires at 60", () => {
  assert.equal(check("student", 58 * 60 * 1000 - 1).status, "active");
  assert.equal(check("student", 58 * 60 * 1000).status, "warning");
  assert.equal(check("student", 60 * 60 * 1000).status, "expired");
});
test("idle: nothing related to background network or token refresh updates the last activity", () => {
  const lastActiveAt = at;
  const now = at + 61 * 60 * 1000;
  assert.equal(getIdleSnapshot({ role: "student", lastActiveAt, now }).status, "expired");
});
test("idle: other roles cannot inherit a timeout", () => {
  assert.equal(check("admin", 24 * 60 * 60 * 1000).status, "disabled");
});
test("idle: storage key belongs to the user", () => {
  assert.notEqual(getIdleActivityStorageKey("a"), getIdleActivityStorageKey("b"));
});
test("idle: same login restores a previously saved timestamp across refresh", () => {
  const entry = serializeIdleActivity("login-v1", at);
  assert.equal(parseStoredIdleActivity(entry, "login-v1", at + 1000), at);
});
test("idle: a new login does not inherit an expired old session", () => {
  const entry = serializeIdleActivity("old-login", at);
  assert.equal(parseStoredIdleActivity(entry, "new-login", at + 9999), null);
});
test("idle: malformed, future and invalid timestamps are ignored", () => {
  assert.equal(parseStoredIdleActivity("not JSON", "login-v1", at), null);
  assert.equal(parseStoredIdleActivity('{"sessionMarker":"login-v1","lastActiveAt":"oops"}', "login-v1", at), null);
  assert.equal(parseStoredIdleActivity(serializeIdleActivity("login-v1", at + 1000), "login-v1", at), null);
});
test("idle: extending the clock requires actual activity (a new timestamp)", () => {
  const expired = check("student", 60 * 60 * 1000);
  const recent = getIdleSnapshot({ role: "student", lastActiveAt: at + 59 * 60 * 1000, now: at + 60 * 60 * 1000 });
  assert.equal(expired.status, "expired");
  assert.equal(recent.status, "active");
});
test("idle: countdown uses whole seconds and does not go negative", () => {
  assert.equal(formatIdleCountdown(120_000), "02:00");
  assert.equal(formatIdleCountdown(61_001), "01:02");
  assert.equal(formatIdleCountdown(-20), "00:00");
});
