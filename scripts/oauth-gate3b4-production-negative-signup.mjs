/**
 * Gate 3b.4: guarded, SINGLE negative public-signup probe against Production.
 *
 * This file NEVER changes Supabase settings, issues RPC tickets, uses admin APIs,
 * executes SQL, or deletes accounts. Only run once the cloud Hook is confirmed ON.
 * A misconfigured Hook can allow a user to be created: STOP and investigate.
 *
 * Invoke with explicit environment-based acknowledgement as described in docs.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const PROJECT_REF = 'zqanhujauejfaxywqckc';
const API = `https://${PROJECT_REF}.supabase.co`;
const mode = process.argv[2];
if (mode !== 'probe' || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/oauth-gate3b4-production-negative-signup.mjs probe');
}
if (basename(process.cwd()).toLowerCase() !== 'english_classes_vite') {
  throw new Error('REFUSED: run only from the CRM repository root.');
}
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch !== 'feature/oauth-google') {
  throw new Error('REFUSED: expected feature/oauth-google.');
}
const linked = readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim();
if (linked !== PROJECT_REF) {
  throw new Error('REFUSED: linked Production project reference does not match.');
}
if (process.env.CRM_GATE3B4_HOOK_CONFIRMED_ON !== 'YES' ||
    process.env.CRM_GATE3B4_ALLOW_PRODUCTION_HTTP !== 'YES') {
  throw new Error('REFUSED: Hook ON and explicit Production HTTP acknowledgement required.');
}
const key = (process.env.CRM_GATE3B4_PUBLIC_API_KEY ?? '').trim();
if (!key || key.startsWith('sb_secret_')) {
  throw new Error('REFUSED: only Production publishable or legacy anon API key is permitted.');
}
if (key.startsWith('eyJ')) {
  let claims;
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
  catch { throw new Error('REFUSED: invalid legacy JWT API key.'); }
  if (claims.role !== 'anon') {
    throw new Error('REFUSED: legacy JWT must have role=anon, never service_role.');
  }
} else if (!key.startsWith('sb_publishable_')) {
  throw new Error('REFUSED: unsupported API key format.');
}
const gmail = (process.env.CRM_GATE3B4_CONTROLLED_GMAIL ?? '').trim().toLowerCase();
const match = gmail.match(/^([a-z0-9][a-z0-9.+_-]*)@gmail\.com$/);
if (!match || match[1].includes('+')) {
  throw new Error('REFUSED: supply a controlled base @gmail.com inbox, without +alias.');
}
// Gmail plus-addresses arrive at the specified controlled Gmail mailbox.
const alias = `${match[1]}+crm-gate3b4-deny-${randomBytes(6).toString('hex')}@gmail.com`;
const password = `${randomBytes(25).toString('base64url')}Aa1!`;
console.log('Gate 3b.4 / Production negative signup probe');
console.log('  Endpoint: Production Auth (/auth/v1/signup), one request only');
console.log('  Account: unique Gmail +alias controlled by operator');
console.log('  WARNING: if the Hook is not active, this call might create an Auth user.');
console.log('  Check the alias for cleanup if the probe fails.');
console.log(`  Local-only alias (REDACT before sharing): ${alias}`);
let response;
try {
  response = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'apikey': key,
      'content-type': 'application/json',
      ...(key.startsWith('eyJ') ? { 'authorization': `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ email: alias, password, data: { role: 'teacher' } }),
    signal: AbortSignal.timeout(15000),
  });
} catch {
  throw new Error('INCONCLUSIVE: request failed or timed out. Inspect Auth logs; do not retry blindly.');
}
const responseText = await response.text();
console.log(`  Auth HTTP status: ${response.status}`);
if (response.status !== 403 ||
    !responseText.toLowerCase().includes('invitation required to create a crm account')) {
  throw new Error('FAIL / INCONCLUSIVE: no verified 403 from our admission Hook. STOP and check Auth users for the alias; rollback Hook if needed. Never treat a generic 401/403/429/500 as PASS.');
}
console.log('  PASS: REAL production public signup blocked by the CRM admission Hook (HTTP 403 + expected message).');
console.log('  Next: READ-ONLY SQL must show zero Auth users/profiles/tickets for this exact alias.');
