import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('student sidebar advertises an implemented protected balance route', () => {
  const router = src('src/router.jsx');
  const sidebar = src('src/components/dashboard/DashboardSidebar/DashboardSidebar.jsx');
  assert.match(sidebar, /to:\s*["']\/student-area\/balance["']/);
  assert.match(router, /path:\s*["']balance["']/);
  assert.match(router, /import\("\.\/pages\/StudentBalance\/StudentBalance"\)/);
});

test('Vite development origin matches the local Auth redirect configuration', () => {
  const vite = src('vite.config.js');
  const config = src('supabase/config.toml');
  const example = src('.env.example');
  assert.match(vite, /port:\s*5173\b/);
  assert.doesNotMatch(vite, /strictPort:\s*true/);
  assert.match(config, /site_url\s*=\s*"http:\/\/127\.0\.0\.1:5173"/);
  assert.match(example, /^VITE_APP_URL=http:\/\/127\.0\.0\.1:5173$/m);
});

test('payment ownership is checked via RLS before service_role reporting RPC', () => {
  const code = src('supabase/functions/resolve-payment-tax/index.ts');
  const ownership = code.indexOf('.from("payments")');
  const matchOwner = code.indexOf('.eq("teacher_id", user.id)', ownership);
  const ownError = code.indexOf('if (!ownedPayment)', matchOwner);
  const firstPrivilegedRpc = code.indexOf('supabaseAdmin.rpc(');
  assert.ok(ownership > -1 && matchOwner > ownership && ownError > matchOwner);
  assert.ok(firstPrivilegedRpc > ownError, 'privileged RPC must follow ownership check');
  assert.match(code.slice(ownership, firstPrivilegedRpc), /return jsonResponse\(\{ error: "FORBIDDEN" \}, 403\)/);
});
