/**
 * OAuth 1.6.1a / Gate 0 — local-only Supabase Auth behavior probe.
 * Never sends requests to a hosted Supabase instance.
 * Uses current `npx supabase status -o env`, never VITE_ vars or .env.local.
 * Creates only uniquely named disposable LOCAL accounts and deletes them.
 * No Auth hook and no production policy changes are performed here.
 */
import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function readLocalStatus() {
  const raw = execSync('npx supabase status -o env', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 45_000,
  });
  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  const apiUrl = new URL(values.API_URL ?? 'https://invalid.invalid');
  if (
    !['127.0.0.1', 'localhost'].includes(apiUrl.hostname) ||
    apiUrl.port !== '54321' ||
    apiUrl.protocol !== 'http:'
  ) {
    throw new Error('REFUSED: only http://127.0.0.1:54321 (local Supabase) is allowed.');
  }
  if (!values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
    throw new Error('Missing local ANON_KEY or SERVICE_ROLE_KEY in Supabase CLI status.');
  }
  return { url: apiUrl.toString(), anonKey: values.ANON_KEY, serviceKey: values.SERVICE_ROLE_KEY };
}

const local = readLocalStatus();
const commonAuth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
const admin = createClient(local.url, local.serviceKey, { auth: commonAuth });
const publicClient = createClient(local.url, local.anonKey, { auth: commonAuth });
const suffix = randomUUID().replaceAll('-', '');
const invitedEmail = `oauth-probe-invite-${suffix}@example.invalid`;
const signupEmail = `oauth-probe-signup-${suffix}@example.invalid`;
const createdIds = new Set();
let cleanupFailures = 0;

async function profileFor(email) {
  const { data, error } = await admin.from('profiles').select('id,role,is_active').eq('email', email).maybeSingle();
  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  return data;
}

try {
  console.log('LOCAL BASELINE PROBE: no changes to migrations, hooks or config.');
  console.log('1) Server-side inviteUserByEmail with existing student metadata ...');
  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(invitedEmail, {
    data: { full_name: 'OAuth test student', role: 'student' },
  });
  if (inviteError) throw new Error(`Local admin invite failed: ${inviteError.message}`);
  if (!invite.user?.id) throw new Error('Local admin invite returned no auth UUID');
  createdIds.add(invite.user.id);
  const invitedProfile = await profileFor(invitedEmail);
  console.log(`   invite auth UUID matches profile: ${invitedProfile?.id === invite.user.id}`);
  console.log(`   invited profile role: ${invitedProfile?.role ?? '(missing)'}`);

  console.log('2) Ordinary email signUp with user-controlled role metadata ...');
  const { data: signup, error: signupError } = await publicClient.auth.signUp({
    email: signupEmail,
    password: `${randomBytes(24).toString('base64url')}Aa1!`,
    options: { data: { full_name: 'OAuth test signup', role: 'teacher' } },
  });
  if (signupError) throw new Error(`Local signUp failed: ${signupError.message}`);
  if (!signup.user?.id) throw new Error('Local signUp returned no auth UUID');
  createdIds.add(signup.user.id);
  const signupProfile = await profileFor(signupEmail);
  console.log(`   signUp auth UUID matches profile: ${signupProfile?.id === signup.user.id}`);
  console.log(`   signUp profile role: ${signupProfile?.role ?? '(missing)'}`);
  if (signupProfile?.role === 'teacher') {
    console.log('   WARNING: current local trigger accepts an untrusted teacher role. This is why the server fix is required.');
  }
  console.log('LOCAL BASELINE PROBE COMPLETE. No Google provider test was performed.');
} catch (error) {
  console.error(`PROBE INCOMPLETE: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  for (const id of createdIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      cleanupFailures += 1;
      console.error(`CLEANUP FAILED for disposable local auth UUID ${id}: ${error.message}`);
    }
  }
  if (cleanupFailures) process.exitCode = 1;
  else console.log(`Local disposable accounts cleaned up: ${createdIds.size}.`);
}
