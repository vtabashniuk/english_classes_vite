import assert from "node:assert/strict";
import test from "node:test";

import {
  getPasswordChangeErrorKey,
  validatePasswordChange,
} from "../src/features/auth/lib/passwordValidation.js";

const valid = {
  currentPassword: "previous-password",
  newPassword: "next-password-123",
  confirmPassword: "next-password-123",
};

test("password: valid change", () => {
  assert.equal(validatePasswordChange(valid), null);
});

test("password: existing password is mandatory", () => {
  assert.equal(validatePasswordChange({ ...valid, currentPassword: "" }), "currentRequired");
});

test("password: new password must be at least eight characters", () => {
  assert.equal(validatePasswordChange({ ...valid, newPassword: "short", confirmPassword: "short" }), "tooShort");
});

test("password: confirmation must match", () => {
  assert.equal(validatePasswordChange({ ...valid, confirmPassword: "different" }), "mismatch");
});

test("password: new password must differ from old password", () => {
  assert.equal(validatePasswordChange({ ...valid, newPassword: valid.currentPassword, confirmPassword: valid.currentPassword }), "samePassword");
});

test("password: Supabase current-password mismatch is user-facing", () => {
  assert.equal(getPasswordChangeErrorKey({ code: "current_password_mismatch" }), "currentIncorrect");
  assert.equal(getPasswordChangeErrorKey({ code: "weak_password" }), "tooWeak");
  assert.equal(getPasswordChangeErrorKey({ code: "same_password" }), "samePassword");
  assert.equal(getPasswordChangeErrorKey({ code: "reauthentication_needed" }), "reauthRequired");
});

test("password: unexpected auth errors get safe generic message", () => {
  assert.equal(getPasswordChangeErrorKey(new Error("Network unavailable")), "saveError");
});
