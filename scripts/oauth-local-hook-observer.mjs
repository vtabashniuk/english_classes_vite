/**
 * CRM OAuth 1.6.1a Gate 1: LOCAL ONLY diagnostic of Before User Created Hook.
 * Commands: install | probe | cleanup
 * Guard: matching local project, local ports 54321/54322, exact Docker DB container.
 * The hook ALLOWS all user creations; it only records non-sensitive shape metadata.
 * DO NOT COMMIT modified config.toml; this experiment requires local installation.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const command = process.argv[2];
if (!['install', 'probe', 'cleanup'].includes(command)) {
  throw new Error('Use: node scripts/oauth-local-hook-observer.mjs install|probe|cleanup');
}
const root = process.cwd();
// For install/cleanup no Supabase CLI or Auth key is needed. The previous
// `npx supabase status -o env` could time out on Windows before SQL ran.
const configText = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
function sectionPort(name) {
  const lines = configText.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      inSection = header[1] === name;
      continue;
    }
    if (inSection) {
      const port = line.match(/^\s*port\s*=\s*(\d+)\s*$/);
      if (port) return Number(port[1]);
    }
  }
  return null;
}
const configuredProjectId = configText.match(/^\s*project_id\s*=\s*"([^"]+)"\s*$/m)?.[1];
if (configuredProjectId !== basename(root) || sectionPort('api') !== 54321 || sectionPort('db') !== 54322) {
  throw new Error('REFUSED: expected local project ID and API/DB ports 54321/54322.');
}
const expectedDbContainer = `supabase_db_${basename(root)}`;
function docker(args, timeout = 15_000) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout });
  if (result.error || result.status !== 0) {
    throw new Error(`LOCAL Docker command failed (${args[0]}): ${result.error?.message ?? result.stderr?.trim() ?? 'unknown error'}`);
  }
  return result.stdout.trim();
}
const running = docker(['ps', '--format', '{{.Names}}']).split(/\r?\n/);
if (!running.includes(expectedDbContainer)) {
  throw new Error(`REFUSED: exact local Docker container '${expectedDbContainer}' is not running.`);
}
const publishedPorts = docker(['port', expectedDbContainer, '5432/tcp']);
if (!publishedPorts.split(/\r?\n/).some((line) => line.trim().endsWith(':54322'))) {
  throw new Error('REFUSED: local PostgreSQL container is not published on host port 54322.');
}
const observerEnabled = /\[auth\.hook\.before_user_created\]\s*\nenabled\s*=\s*true\s*\nuri\s*=\s*"pg-functions:\/\/postgres\/oauth_probe\/before_user_created_observe"/.test(configText);

function readLocalAuthKeys() {
  // Caller captures CLI status in a temporary PowerShell process environment;
  // no child `npx`, no secrets written to disk or printed by this script.
  const statusRaw = process.env.CRM_SUPABASE_LOCAL_STATUS;
  if (!statusRaw) {
    throw new Error('For probe: capture `npx supabase status -o env` into the temporary CRM_SUPABASE_LOCAL_STATUS environment variable (see instructions).');
  }
  const vars = {};
  for (const line of statusRaw.split(/\r?\n/)) {
    const found = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (found) vars[found[1]] = found[2].trim().replace(/^"(.*)"$/, '$1');
  }
  const url = new URL(vars.API_URL ?? 'https://invalid.invalid');
  if (url.protocol !== 'http:' || url.port !== '54321' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('REFUSED: Auth probe runs only on http://127.0.0.1:54321.');
  }
  if (!vars.ANON_KEY || !vars.SERVICE_ROLE_KEY) {
    throw new Error('Missing local ANON_KEY or SERVICE_ROLE_KEY in captured Supabase CLI status.');
  }
  return { url: url.toString(), anonKey: vars.ANON_KEY, serviceKey: vars.SERVICE_ROLE_KEY };
}

function sql(query) {
  const result = spawnSync('docker', [
    'exec', '-i', expectedDbContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-t', '-A',
  ], { input: query, encoding: 'utf8', timeout: 30_000, maxBuffer: 4_000_000 });
  if (result.status !== 0) throw new Error(`LOCAL psql failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

if (command === 'install') {
  if (!observerEnabled) throw new Error('Observer hook config is not present. Extract Gate 1 ZIP first.');
  const path = resolve(root, 'scripts/oauth-local-hook-observer.sql');
  sql(readFileSync(path, 'utf8'));
  console.log('LOCAL observer installed. Restart LOCAL Supabase (stop, start), then run probe.');
} else if (command === 'cleanup') {
  if (observerEnabled) throw new Error('Restore original supabase/config.toml and restart Supabase BEFORE cleanup.');
  sql('DROP SCHEMA IF EXISTS oauth_probe CASCADE;');
  console.log('Removed LOCAL diagnostic observer schema.');
} else {
  if (!observerEnabled) throw new Error('Gate 1 hook config must be enabled for probe.');
  const local = readLocalAuthKeys();
  const auth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
  const admin = createClient(local.url, local.serviceKey, { auth });
  const client = createClient(local.url, local.anonKey, { auth });
  const marker = randomUUID().replaceAll('-', '');
  const ids = new Set();
  const checks = [];
  let failed = false;
  try {
    const emailInvite = `oauth-hook-invite-${marker}@example.invalid`;
    const emailSignup = `oauth-hook-signup-${marker}@example.invalid`;
    const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(emailInvite, {
      data: { full_name: 'Local hook invited student', role: 'student' },
    });
    if (invitation?.user?.id) ids.add(invitation.user.id);
    if (inviteError || !invitation?.user?.id) throw new Error(`Admin invitation: ${inviteError?.message ?? 'Missing ID'}`);
    checks.push({ label: 'admin invitation', id: invitation.user.id });

    const { data: signed, error: signupError } = await client.auth.signUp({
      email: emailSignup,
      password: `${randomBytes(24).toString('base64url')}Aa1!`,
      options: { data: { full_name: 'Local hook signup', role: 'teacher' } },
    });
    if (signed?.user?.id) ids.add(signed.user.id);
    if (signupError || !signed?.user?.id) throw new Error(`Public signup: ${signupError?.message ?? 'Missing ID'}`);
    checks.push({ label: 'public signup (untrusted teacher role)', id: signed.user.id });

    const idList = checks.map(({id}) => `'${id}'::uuid`).join(',');
    const observations = sql(`SELECT row_to_json(x)::text FROM (
      SELECT user_id, app_provider, untrusted_role, has_invited_at,
        has_email_confirmed_at, user_field_names, metadata_field_names
      FROM oauth_probe.created_user_hook_events WHERE user_id IN (${idList})
      ORDER BY observed_at
    ) x;`).split(/\r?\n/).filter(Boolean).map(JSON.parse);
    for (const check of checks) {
      const observation = observations.find((row) => row.user_id === check.id);
      console.log(`\n${check.label}:`);
      console.log(JSON.stringify(observation ?? { error: 'NO_HOOK_EVENT_RECORDED' }, null, 2));
      if (!observation) failed = true;
    }
    if (observations.length !== 2) throw new Error(`Expected two hook observations; received ${observations.length}`);
    console.log('\nOBSERVATION ONLY — do not treat user_metadata.role as trusted.');
  } catch (error) {
    failed = true;
    console.error(`GATE 1 PROBE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    for (const id of ids) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        console.error(`Local test account cleanup error (${id}): ${error.message}`);
        failed = true;
      }
    }
    console.log(`Disposed ${ids.size} local test user(s).`);
  }
  if (failed) process.exitCode = 1;
}
