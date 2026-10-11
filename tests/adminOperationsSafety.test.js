import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RESET_CONFIRMATION_FLAG,
  assertLocalAdminResetConfig,
  assertLocalSupabaseUrl,
  assertUserMatchesExpectedEmail,
} from "../scripts/lib/localAdminSafety.mjs";

const userId = "a1b2c3d4-a123-4123-8123-0123456789ab";
const valid = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-test-only-key",
  TEST_USER_ID: userId,
  TEST_USER_EMAIL: "local-student@example.test",
  TEST_USER_PASSWORD: "new-local-password-123",
};

const dangerousUrls = [
  "https://project.supabase.co",
  "https://project.supabase.co:54321",
  "http://project.supabase.co:54321",
  "http://localhost:54322",
  "http://localhost:54321@project.supabase.co:54321",
  "http://localhost.evil.example:54321",
  "http://127.0.0.1:54321/path",
  "http://127.0.0.1:54321?api=remote",
  "https://127.0.0.1:54321",
  "",
  "not-a-url",
];

test("admin reset: strict local endpoint allowlist", () => {
  assert.equal(assertLocalSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assert.equal(assertLocalSupabaseUrl("http://localhost:54321/"), "http://localhost:54321");
  assert.equal(assertLocalSupabaseUrl("http://[::1]:54321"), "http://[::1]:54321");
});

test("admin reset: refuse every cloud or unexpected URL", () => {
  for (const url of dangerousUrls) {
    assert.throws(() => assertLocalSupabaseUrl(url), undefined, url);
  }
});

test("admin reset: must have explicit confirmation flag", () => {
  assert.throws(() => assertLocalAdminResetConfig(valid, []), /confirmation/i);
  assert.throws(() => assertLocalAdminResetConfig(valid, ["--confirm-prod"]), /confirmation/i);
  assert.throws(() => assertLocalAdminResetConfig(valid, [RESET_CONFIRMATION_FLAG, "extra"]), /confirmation/i);
});

test("admin reset: remote endpoint is refused even with confirmation", () => {
  const env = { ...valid, SUPABASE_URL: "https://project.supabase.co" };
  assert.throws(() => assertLocalAdminResetConfig(env, [RESET_CONFIRMATION_FLAG]), /never allowed/i);
});

test("admin reset: requires test user's ID and email", () => {
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "TEST_USER_ID", "TEST_USER_EMAIL", "TEST_USER_PASSWORD"]) {
    assert.throws(
      () => assertLocalAdminResetConfig({ ...valid, [name]: "" }, [RESET_CONFIRMATION_FLAG]),
      /Missing required environment variables/,
    );
  }
  assert.throws(() => assertLocalAdminResetConfig({ ...valid, TEST_USER_ID: "abc" }, [RESET_CONFIRMATION_FLAG]), /UUID/);
  assert.throws(() => assertLocalAdminResetConfig({ ...valid, TEST_USER_EMAIL: "bad" }, [RESET_CONFIRMATION_FLAG]), /email/);
  assert.throws(() => assertLocalAdminResetConfig({ ...valid, TEST_USER_PASSWORD: "short" }, [RESET_CONFIRMATION_FLAG]), /eight/);
});

test("admin reset: accepts confirmed local-only configuration", () => {
  const output = assertLocalAdminResetConfig(valid, [RESET_CONFIRMATION_FLAG]);
  assert.equal(output.supabaseUrl, valid.SUPABASE_URL);
  assert.equal(output.userId, valid.TEST_USER_ID);
  assert.equal(output.expectedEmail, valid.TEST_USER_EMAIL);
});

test("admin reset: refuses mismatched email before password update", () => {
  assertUserMatchesExpectedEmail("LOCAL-STUDENT@example.test", valid.TEST_USER_EMAIL);
  assert.throws(() => assertUserMatchesExpectedEmail("another@example.test", valid.TEST_USER_EMAIL), /does not match/);
  assert.throws(() => assertUserMatchesExpectedEmail(null, valid.TEST_USER_EMAIL), /does not match/);
});

test("admin reset: entry point blocks production URL without contacting Supabase", () => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(dirname, "../scripts/reset-test-student-password.mjs");
  const result = spawnSync(process.execPath, [script, RESET_CONFIRMATION_FLAG], {
    env: { ...process.env, ...valid, SUPABASE_URL: "https://project.supabase.co" },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cloud\/Production URLs are never allowed/);
  assert.doesNotMatch(result.stderr, /local-test-only-key|new-local-password-123/);
});

test("admin reset: no service role access in browser src/", () => {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(dirname, "../src");
  const files = [srcRoot];
  while (files.length) {
    const p = files.pop();
    if (statSync(p).isDirectory()) {
      files.push(...readdirSync(p).map((entry) => path.join(p, entry)));
    } else if (/\.(js|jsx|ts|tsx)$/.test(p)) {
      const content = readFileSync(p, "utf8");
      assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY|service_role|auth\.admin\./i, p);
    }
  }
});

