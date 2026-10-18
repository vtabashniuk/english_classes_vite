/**
 * Gate 3b.1 — OFFLINE / READ-ONLY repository preflight.
 * NO Production requests, NO Supabase CLI, NO network, NO SQL execution.
 * Reports local readiness only; cloud state is UNKNOWN until independently checked.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const command = (args) => spawnSync('git', args, {
  cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1_000_000,
});
let passes = 0;
function verify(ok, label) {
  if (!ok) throw new Error(`FAIL: ${label}`);
  passes++;
  console.log(`  PASS: ${label}`);
}
function git(args, description) {
  const result = command(args);
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot inspect ${description} (read-only Git call failed).`);
  }
  return result.stdout.trim();
}
function getSectionKey(input, section, key) {
  let current = '';
  for (const line of input.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([\w.-]+)\]\s*$/);
    if (heading) { current = heading[1]; continue; }
    if (current !== section || /^\s*#/.test(line)) continue;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*([^#\\r\\n]+)`));
    if (match) return match[1].trim();
  }
  return undefined;
}

if (process.argv.length !== 2) {
  throw new Error('Usage: node scripts/oauth-gate3b1-offline-preflight.mjs');
}
console.log('Gate 3b.1 — OFFLINE repository preflight. No Production connection or writes.');
verify(basename(root) === 'english_classes_vite', 'Expected repository directory');
verify(git(['branch', '--show-current'], 'branch') === 'feature/oauth-google',
  'Expected feature/oauth-google branch');
verify(git(['diff', '--', 'supabase/config.toml'], 'unstaged config diff') === '' &&
  git(['diff', '--cached', '--', 'supabase/config.toml'], 'staged config diff') === '',
  'No staged or unstaged changes to supabase/config.toml');

const config = read('supabase/config.toml');
const gate2 = 'supabase/migrations/20261012200000_pending_google_invitations_foundation.sql';
const gate3 = 'supabase/migrations/20261012232000_email_invitation_admission_foundation.sql';
const audit = 'supabase/audits/20261018_gate3b1_production_readonly.sql';
verify(getSectionKey(config, 'auth.hook.before_user_created', 'enabled') !== 'true',
  'Local Before User Created Hook is OFF');
verify(getSectionKey(config, 'auth', 'enable_signup') === 'true' &&
  getSectionKey(config, 'auth.email', 'enable_signup') === 'true',
  'Local email invitation signup compatibility maintained');
verify(getSectionKey(config, 'auth', 'enable_anonymous_sign_ins') === 'false' &&
  getSectionKey(config, 'auth.sms', 'enable_signup') === 'false',
  'Local anonymous / phone signup disabled');
verify(getSectionKey(config, 'auth.external.google', 'enabled') !== 'true',
  'Local Google provider disabled');
verify(!/\bcrm_private\b/.test(getSectionKey(config, 'api', 'schemas') || ''),
  'Private admission schema not exposed in local API settings');
verify(existsSync(resolve(root, gate2)) && existsSync(resolve(root, gate3)),
  'Both versioned invitation foundation migrations exist');
const migration = read(gate3);
verify(/create function public\.issue_email_invitation_admission\(/.test(migration) &&
  /create function public\.revoke_email_invitation_admission\(/.test(migration) &&
  /create function public\.crm_before_user_created_hook\(/.test(migration),
  'Versioned issue / revoke / Hook SQL functions present');
verify(/grant execute on function public\.crm_before_user_created_hook\(jsonb\)[\s\S]*?to supabase_auth_admin/i.test(migration) &&
  /revoke all on function public\.crm_before_user_created_hook\(jsonb\)[\s\S]*?from public, anon, authenticated, service_role/i.test(migration),
  'Versioned Hook grants limited to Auth service');
const handler = read('supabase/functions/invite-student/index.ts');
verify(/issue_email_invitation_admission/.test(handler) &&
  /revoke_email_invitation_admission/.test(handler) &&
  /auth\.admin\.inviteUserByEmail/.test(handler) &&
  /crm_email_invite_ticket/.test(handler) &&
  /auth\.admin\.updateUserById/.test(handler),
  'Email Edge Function includes ticket lifecycle and metadata cleanup');
verify(/\.auth\.getUser\(/.test(handler) &&
  /profile\.role !== "teacher"/.test(handler) && /!profile\.is_active/.test(handler),
  'Edge Function checks authenticated active teacher');
verify(existsSync(resolve(root, audit)) &&
  /^\s*BEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/im.test(read(audit)),
  'Separate read-only SQL preflight file exists');
const tracked = git(['ls-files', '--cached'], 'tracked file names').split(/\r?\n/);
verify(!tracked.some((path) => /(^|\/)(\.env(?:\..*)?|[^/]*service[_-]?role[^/]*)$/i.test(path) &&
  path !== '.env.example' && !path.endsWith('/.env.example')), 'No tracked environment files or service-role key files');
console.log(`\nGATE 3b.1 LOCAL REVIEW PASS: ${passes} checks.`);
console.log('PRODUCTION STATUS: NOT VERIFIED. Run migration-list and read-only SQL audit separately.');
console.log('NO changes to Production, local DB, Auth config or Git index.');
