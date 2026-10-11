import assert from "node:assert/strict";
import test from "node:test";

import { changePasswordWithServerPolicy } from "../src/features/auth/lib/passwordChangeFlow.js";
import { getPasswordChangeErrorKey } from "../src/features/auth/lib/passwordValidation.js";

const account = { id: "teacher-123", email: "teacher@example.test" };
const input = { currentPassword: "old-secret-password", newPassword: "new-secret-password" };

const setup = ({ first = account, second = account, updateError = null, firstError = null, secondError = null } = {}) => {
  const events = [];
  let lookupCount = 0;
  const deps = {
    getAuthenticatedUser: async () => {
      events.push("getUser");
      lookupCount += 1;
      if (lookupCount === 1) return { data: { user: first }, error: firstError };
      return { data: { user: second }, error: secondError };
    },
    updatePassword: async (attributes) => {
      events.push("update");
      assert.deepEqual(attributes, {
        current_password: input.currentPassword,
        password: input.newPassword,
      });
      return { error: updateError };
    },
  };
  return { events, deps };
};

test("password: sends current_password with the new password via the active Supabase session", async () => {
  const { events, deps } = setup();
  assert.deepEqual(await changePasswordWithServerPolicy(input, deps), { error: null });
  assert.deepEqual(events, ["getUser", "getUser", "update"]);
});

test("password: server current_password_mismatch must fail, never treated as success", async () => {
  const { events, deps } = setup({ updateError: { code: "current_password_mismatch" } });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(result.error.code, "current_password_mismatch");
  assert.equal(getPasswordChangeErrorKey(result.error), "currentIncorrect");
  assert.deepEqual(events, ["getUser", "getUser", "update"]);
});

test("password: server current_password_required must fail", async () => {
  const { deps } = setup({ updateError: { code: "current_password_required" } });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(getPasswordChangeErrorKey(result.error), "currentIncorrect");
});

test("password: missing current password never calls Supabase", async () => {
  const { events, deps } = setup();
  const result = await changePasswordWithServerPolicy({ ...input, currentPassword: "" }, deps);
  assert.equal(result.error.code, "current_password_required");
  assert.deepEqual(events, []);
});

test("password: invalid new password and unchanged password never call Supabase", async () => {
  const { events, deps } = setup();
  const invalid = await changePasswordWithServerPolicy({ ...input, newPassword: "short" }, deps);
  assert.equal(invalid.error.code, "weak_password");
  const unchanged = await changePasswordWithServerPolicy({ ...input, newPassword: input.currentPassword }, deps);
  assert.equal(unchanged.error.code, "same_password");
  assert.deepEqual(events, []);
});

test("password: rejects an unauthenticated user", async () => {
  const { events, deps } = setup({ first: null });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(result.error.code, "auth_required");
  assert.deepEqual(events, ["getUser"]);
});

test("password: detects a user switch in another tab", async () => {
  const { events, deps } = setup({ second: { id: "another-user" } });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(result.error.code, "auth_identity_mismatch");
  assert.deepEqual(events, ["getUser", "getUser"]);
});

test("password: aborts if first getUser fails", async () => {
  const { events, deps } = setup({ firstError: { code: "network_error" } });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(result.error.code, "network_error");
  assert.deepEqual(events, ["getUser"]);
});

test("password: aborts if second getUser fails", async () => {
  const { events, deps } = setup({ secondError: { code: "network_error" } });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(result.error.code, "network_error");
  assert.deepEqual(events, ["getUser", "getUser"]);
});

test("password: server can demand reauthentication without success", async () => {
  const { deps } = setup({ updateError: { code: "reauthentication_needed" } });
  const result = await changePasswordWithServerPolicy(input, deps);
  assert.equal(getPasswordChangeErrorKey(result.error), "reauthRequired");
});
