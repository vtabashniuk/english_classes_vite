import test from "node:test";
import assert from "node:assert/strict";

const stored = new Map();
const storage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key),
};

// Load tracker with a simulated first-load implicit invitation callback.
globalThis.window = {
  sessionStorage: storage,
  location: {
    pathname: "/set-password",
    hash: "#type=invite&access_token=issued-token&refresh_token=issued-refresh",
  },
};

const {
  recordPasswordAuthEvent,
  canUsePasswordFlow,
  clearPasswordFlow,
} = await import("../src/features/auth/lib/passwordFlowState.js");

test("existing session does not permit setting password", () => {
  clearPasswordFlow();
  recordPasswordAuthEvent("INITIAL_SESSION", {
    access_token: "issued-token",
    user: { id: "a" },
  });
  assert.equal(canUsePasswordFlow("invite", "a"), false);
});

test("regular login without matching callback tokens is denied", () => {
  clearPasswordFlow();
  recordPasswordAuthEvent("SIGNED_IN", { access_token: "different-token", user: { id: "a" } });
  assert.equal(canUsePasswordFlow("invite", "a"), false);
});

test("verified invitation event authorizes only invited identity and purpose", () => {
  clearPasswordFlow();
  recordPasswordAuthEvent("SIGNED_IN", { access_token: "issued-token", user: { id: "a" } });
  assert.equal(canUsePasswordFlow("invite", "a"), true);
  assert.equal(canUsePasswordFlow("invite", "b"), false);
  assert.equal(canUsePasswordFlow("recovery", "a"), false);
});

test("sign-out removes the invitation grant", () => {
  recordPasswordAuthEvent("SIGNED_OUT", null);
  assert.equal(canUsePasswordFlow("invite", "a"), false);
});

test("recovery grant comes from dedicated Supabase auth event", () => {
  recordPasswordAuthEvent("PASSWORD_RECOVERY", { user: { id: "teacher" } });
  assert.equal(canUsePasswordFlow("recovery", "teacher"), true);
  assert.equal(canUsePasswordFlow("invite", "teacher"), false);
  clearPasswordFlow();
  assert.equal(canUsePasswordFlow("recovery", "teacher"), false);
});
