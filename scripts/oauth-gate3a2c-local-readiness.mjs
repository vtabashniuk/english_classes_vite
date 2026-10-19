/**
 * Gate 3a.2-C — repository readiness review and LOCAL-only supplementary
 * signup-path probe. No migrations, admin provisioning, Production access,
 * account deletion or secrets in stdout.
 *
 * review: offline code/config guardrails, requires Hook OFF.
 * probe:  LOCAL Hook ON; tests email/password signup and email OTP auto-create.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const mode = process.argv[2];
if (!['review', 'probe'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/oauth-gate3a2c-local-readiness.mjs review|probe');
}

const root = process.cwd();
const project = basename(root);
const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
const migration = readFileSync(resolve(root,
  'supabase/migrations/20261012232000_email_invitation_admission_foundation.sql'), 'utf8');
const handler = readFileSync(resolve(root, 'supabase/functions/invite-student/index.ts'), 'utf8');
const branch = spawnSync('git', ['branch', '--show-current'], {
  encoding: 'utf8', timeout: 10_000,
});
if (project !== 'english_classes_vite' || branch.error || branch.status !== 0 ||
    branch.stdout.trim() !== 'feature/oauth-google') {
  throw new Error('REFUSED: english_classes_vite on feature/oauth-google required.');
}

const sections = new Map();
let activeSection = '';
for (const line of config.split(/\r?\n/)) {
  const head = line.match(/^\s*\[([\w.-]+)\]\s*$/);
  if (head) { activeSection = head[1]; sections.set(activeSection, []); }
  else if (activeSection) sections.get(activeSection).push(line);
}
function getValue(name, key) {
  const lines = sections.get(name) ?? [];
  const match = lines.join('\n').match(new RegExp(`^\\s*${key}\\s*=\\s*([^#\\r\\n]+)`, 'm'));
  return match?.[1]?.trim();
}
function check(condition, description) {
  if (!condition) throw new Error(`FAIL: ${description}`);
  checks++;
  console.log(`  PASS: ${description}`);
}
let checks = 0;
const hookEnabled = getValue('auth.hook.before_user_created', 'enabled') === 'true';
const hookUri = getValue('auth.hook.before_user_created', 'uri');
check(getValue('api', 'port') === '54321' && getValue('db', 'port') === '54322',
  'Exact local API/DB ports in repo configuration');
check(config.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1] === project,
  'Project identity matches the working directory');
check((config.match(/^\s*additional_redirect_urls\s*=/gm) || []).length === 1,
  'Auth redirects have exactly one config definition');
check(getValue('auth', 'enable_signup') === 'true' && getValue('auth.email', 'enable_signup') === 'true',
  'Email signup remains enabled for the invitation Hook to enforce');
check(getValue('auth', 'enable_anonymous_sign_ins') === 'false' &&
  getValue('auth', 'enable_manual_linking') === 'false',
  'Anonymous sign-in and manual identity linking remain disabled');
check(getValue('auth.sms', 'enable_signup') === 'false', 'Phone account signup remains disabled');
check(getValue('auth.oauth_server', 'enabled') === 'false', 'OAuth server disabled');
const enabledProviders = [...sections.keys()].filter((key) =>
  (key.startsWith('auth.external.') || key.startsWith('auth.third_party.')) &&
  getValue(key, 'enabled') !== 'false');
check(enabledProviders.length === 0,
  'All configured external OAuth/third-party providers disabled');
check(getValue('auth.external.google', 'enabled') !== 'true',
  'Google OAuth provider not enabled in local config');
check(!/\bcrm_private\b/.test(getValue('api', 'schemas') || ''),
  'Private admission schema not exposed through Data API');
const browserFiles = [];
function collect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) browserFiles.push(path);
  }
}
collect(resolve(root, 'src'));
check(browserFiles.every((file) => !/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_/.test(readFileSync(file, 'utf8'))),
  'Browser source contains no server-role or secret-key references');
check(/create function public\.crm_before_user_created_hook\(/i.test(migration) &&
  /revoke all on function public\.crm_before_user_created_hook\(jsonb\)/i.test(migration) &&
  /grant execute on function public\.crm_before_user_created_hook\(jsonb\)[\s\S]*?to supabase_auth_admin/i.test(migration),
  'Versioned Hook function and restricted execute grants present');
check(/issue_email_invitation_admission/.test(handler) &&
  /revoke_email_invitation_admission/.test(handler) &&
  /auth\.admin\.inviteUserByEmail/.test(handler) &&
  /auth\.admin\.updateUserById/.test(handler),
  'Email invitation retains ticket issuance, revocation, Auth invite and metadata scrubbing');
check(/\.auth\.getUser\(/.test(handler) && /profile\.role !== "teacher"/.test(handler) &&
  /!profile\.is_active/.test(handler), 'Edge checks verified JWT and active teacher role');

if (mode === 'review') {
  check(!hookEnabled, 'Repository/local Auth Hook is OFF after Gate B');
  console.log(`\nGATE 3a.2-C REVIEW PASS: ${checks} offline code/config checks. No network/DB calls.`);
} else {
  check(hookEnabled && hookUri === '"pg-functions://postgres/public/crm_before_user_created_hook"',
    'LOCAL Hook ON with exact required URI');
  const container = `supabase_db_${project}`;
  function docker(args, input) {
    const result = spawnSync('docker', args, {
      input, encoding: 'utf8', timeout: 25_000, maxBuffer: 1_000_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`LOCAL Docker unavailable (${args[0]}): ${result.error?.message || result.stderr?.trim() || 'unknown'}`);
    }
    return result.stdout.trim();
  }
  check(docker(['ps', '--format', '{{.Names}}']).split(/\r?\n/).includes(container) &&
    docker(['port', container, '5432/tcp']).split(/\r?\n/).some((line) => line.endsWith(':54322')),
  'Expected LOCAL DB container on port 54322');
  function sql(statement) {
    return docker(['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t',
      '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-f', '-'], `${statement}\n`);
  }
  const privileges = sql(`select (to_regclass('crm_private.email_invitation_admissions') is not null)::text || ',' ||
    (select relrowsecurity from pg_class where oid='crm_private.email_invitation_admissions'::regclass)::text || ',' ||
    has_function_privilege('supabase_auth_admin','public.crm_before_user_created_hook(jsonb)','EXECUTE')::text || ',' ||
    (not has_function_privilege('authenticated','public.crm_before_user_created_hook(jsonb)','EXECUTE'))::text || ',' ||
    (not has_function_privilege('anon','public.crm_before_user_created_hook(jsonb)','EXECUTE'))::text || ',' ||
    (not has_function_privilege('authenticated','public.issue_email_invitation_admission(uuid,text)','EXECUTE'))::text || ',' ||
    (not has_function_privilege('anon','public.issue_email_invitation_admission(uuid,text)','EXECUTE'))::text || ',' ||
    (not has_table_privilege('authenticated','crm_private.email_invitation_admissions','SELECT'))::text || ',' ||
    (not has_schema_privilege('anon','crm_private','USAGE'))::text;`);
  check(privileges === 'true,true,true,true,true,true,true,true,true',
    'Live DB: private admission table RLS, Hook and ticket RPC privileges restricted');
  const status = {};
  for (const line of (process.env.CRM_SUPABASE_LOCAL_STATUS || '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) status[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
  }
  const url = new URL(status.API_URL || 'https://invalid.invalid');
  check(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname) &&
    url.port === '54321' && ['', '/'].includes(url.pathname) && Boolean(status.ANON_KEY),
    'Explicit local status and anon key (no remote URL)');
  const base = 'http://127.0.0.1:54321';
  const marker = randomUUID().replaceAll('-', '');
  const signupEmail = `oauth-audit-signup-${marker}@example.invalid`;
  const otpEmail = `oauth-audit-otp-${marker}@example.invalid`;
  const emailsSql = `'${signupEmail}','${otpEmail}'`;
  const usersBefore = sql(`select count(*) from auth.users where lower(email) in (${emailsSql});`);
  check(usersBefore === '0', 'Both unique synthetic email addresses start absent');
  async function authCall(path, body) {
    const response = await fetch(`${base}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: status.ANON_KEY, authorization: `Bearer ${status.ANON_KEY}`,
        'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    // Never print response body; it may contain Auth details.
    await response.text();
    return response.status;
  }
  const signupStatus = await authCall('signup', {
    email: signupEmail, password: `${randomUUID()}Aa1!`,
  });
  check(signupStatus === 403, 'Public email/password signup denied by Hook (HTTP 403)');
  const otpStatus = await authCall('otp', { email: otpEmail, create_user: true });
  check(![429].includes(otpStatus) && otpStatus < 500 && [200, 400, 403].includes(otpStatus),
    'OTP auto-create endpoint answered without rate limiting or server errors');
  const usersAfter = sql(`select count(*) from auth.users where lower(email) in (${emailsSql});`);
  if (usersAfter !== '0') {
    throw new Error(`FAIL: new Auth user unexpectedly created. Preserve LOCAL DB for diagnosis; synthetic emails: ${signupEmail}, ${otpEmail}`);
  }
  check(usersAfter === '0', 'No Auth accounts created through either public signup path');
  check(sql(`select count(*) from public.profiles where lower(email) in (${emailsSql});`) === '0',
    'No student profiles created through either public signup path');
  check(sql(`select count(*) from crm_private.email_invitation_admissions where email in (${emailsSql});`) === '0',
    'No server admission ticket issued through public Auth paths');
  console.log(`\nGATE 3a.2-C PROBE PASS: ${checks} LOCAL checks; OTP HTTP ${otpStatus}, zero new accounts.`);
  console.log('No cleanup needed after PASS (this probe created no users). Restore local Hook OFF/config afterward.');
}
