/**
 * CRM Google OAuth 1.6.1a — Gate 2d: LOCAL-ONLY Edge Function HTTP integration.
 * Execute explicitly; this is NOT a node --test unit test.
 * It creates disposable Auth users and pending invitations in LOCAL Supabase.
 * All credentials are sourced from the temporary CRM_SUPABASE_LOCAL_STATUS env var.
 * Never use .env.local, production credentials, or remote URLs.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const projectName = basename(root);
const config = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');
const configProjectId = config.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];

function configPort(section) {
  const block = config.split(/\r?\n/).slice(config.split(/\r?\n/).findIndex((s) => s.trim() === `[${section}]`) + 1);
  if (!config.includes(`[${section}]`)) return null;
  for (const line of block) {
    if (/^\s*\[/.test(line)) break;
    const port = line.match(/^\s*port\s*=\s*(\d+)\s*$/);
    if (port) return Number(port[1]);
  }
  return null;
}

if (configProjectId !== projectName || configPort('api') !== 54321 || configPort('db') !== 54322) {
  throw new Error('REFUSED: expected this project and LOCAL API 54321 / DB 54322.');
}

const dbContainer = `supabase_db_${projectName}`;
function docker(args, opts = {}) {
  const p = spawnSync('docker', args, { encoding: 'utf8', timeout: 20_000, maxBuffer: 2_000_000, ...opts });
  if (p.error || p.status !== 0) {
    throw new Error(`LOCAL Docker check failed (${args[0]}): ${p.error?.message || p.stderr?.trim() || 'unknown error'}`);
  }
  return p.stdout.trim();
}
const containers = docker(['ps', '--format', '{{.Names}}']).split(/\r?\n/);
if (!containers.includes(dbContainer)) throw new Error(`REFUSED: local DB container ${dbContainer} is not running.`);
const published = docker(['port', dbContainer, '5432/tcp']);
if (!published.split(/\r?\n/).some((line) => line.trim().endsWith(':54322'))) {
  throw new Error('REFUSED: local DB container is not published on port 54322.');
}

const values = {};
for (const line of (process.env.CRM_SUPABASE_LOCAL_STATUS || '').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) values[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
}
const apiUrl = new URL(values.API_URL || 'https://invalid.invalid');
if (apiUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(apiUrl.hostname)
    || apiUrl.port !== '54321' || (apiUrl.pathname !== '/' && apiUrl.pathname !== '')) {
  throw new Error('REFUSED: local CLI API_URL must be http://127.0.0.1:54321.');
}
if (!values.ANON_KEY || !values.SERVICE_ROLE_KEY) {
  throw new Error('Missing LOCAL ANON_KEY / SERVICE_ROLE_KEY: see Gate 2d instructions.');
}
const baseUrl = 'http://127.0.0.1:54321';
const functionUrl = `${baseUrl}/functions/v1/invite-student`;
const mailpitUrl = 'http://127.0.0.1:54324';
const clientAuth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
const admin = createClient(baseUrl, values.SERVICE_ROLE_KEY, { auth: clientAuth });
const makePublic = () => createClient(baseUrl, values.ANON_KEY, { auth: clientAuth });
const marker = randomUUID().replaceAll('-', '');
const teacherEmail = `oauth-http-teacher-${marker}@example.invalid`;
const studentEmail = `oauth-http-student-${marker}@example.invalid`;
const googleEmail = `oauth-http-google-${marker}@example.invalid`;
const passwordEmail = `oauth-http-invite-${marker}@example.invalid`;
const syntheticEmails = [teacherEmail, studentEmail, googleEmail, passwordEmail];
const authIds = new Set();
let result = 'PASS';
let checks = 0;

function assert(ok, description, details = '') {
  if (!ok) throw new Error(`${description}${details ? ` (${details})` : ''}`);
  checks++;
  console.log(`  PASS: ${description}`);
}
function sql(query) {
  return docker([
    'exec', dbContainer, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-c', query,
  ]);
}
function dbSnapshot(email, teacherId) {
  if (!/^oauth-http-[a-z]+-[a-f0-9]{32}@example\.invalid$/.test(email)) {
    throw new Error('REFUSED: DB snapshot requires a script-generated email.');
  }
  if (!/^[a-f0-9-]{36}$/.test(teacherId)) throw new Error('Invalid synthetic teacher UUID.');
  const raw = sql(`SELECT json_build_object(
    'auth_count', (SELECT count(*) FROM auth.users WHERE lower(email)='${email}'),
    'profile_count', (SELECT count(*) FROM public.profiles WHERE lower(email)='${email}'),
    'profile_role', (SELECT role::text FROM public.profiles WHERE lower(email)='${email}' LIMIT 1),
    'relationship_count', (SELECT count(*) FROM public.teacher_students ts
      JOIN public.profiles p ON p.id=ts.student_id
      WHERE ts.teacher_id='${teacherId}'::uuid AND lower(p.email)='${email}'),
    'pending_count', (SELECT count(*) FROM crm_private.pending_google_invitations WHERE email='${email}' AND status='pending'),
    'pending_id', (SELECT id::text FROM crm_private.pending_google_invitations WHERE email='${email}' AND status='pending' LIMIT 1),
    'pending_teacher', (SELECT teacher_id::text FROM crm_private.pending_google_invitations WHERE email='${email}' AND status='pending' LIMIT 1)
  )::text;`);
  return JSON.parse(raw);
}
async function mailCount(email) {
  const url = `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=50`;
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Local Mailpit search failed (${response.status}). Is 54324 running?`);
  const data = await response.json();
  if (!Number.isInteger(data.messages_count)) throw new Error('Mailpit response is missing messages_count.');
  return data.messages_count;
}
async function waitForEmail(email, expected) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const count = await mailCount(email);
    if (count === expected) return count;
    await new Promise((r) => setTimeout(r, 350));
  }
  return mailCount(email);
}
async function callFunction(token, body, opts = {}) {
  const headers = { apikey: values.ANON_KEY, 'content-type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(functionUrl, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000), ...opts,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { text: text.slice(0, 500) }; }
  return { status: response.status, data };
}
async function createAuthUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: 'Local Gate 2d test' },
  });
  if (error || !data.user?.id) throw new Error(`LOCAL createUser failed: ${error?.message || 'no UUID'}`);
  authIds.add(data.user.id);
  return data.user.id;
}
async function login(email, password) {
  const client = makePublic();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error(`LOCAL signIn failed: ${error?.message || 'no token'}`);
  return data.session.access_token;
}

console.log('Gate 2d: LOCAL invite-student HTTP test. No cloud, migrations, or hook changes.');
try {
  // Preflight: fails before creating any test users if the local function or Mailpit is not reachable.
  const health = await fetch(functionUrl, {
    method: 'OPTIONS', headers: { apikey: values.ANON_KEY }, signal: AbortSignal.timeout(12_000),
  });
  if (!health.ok) throw new Error(`Local invite-student function returned HTTP ${health.status} to OPTIONS. Run: npx supabase functions serve invite-student --no-verify-jwt`);
  assert((await mailCount(googleEmail)) === 0, 'Google test mailbox starts empty');
  assert((await mailCount(passwordEmail)) === 0, 'Email test mailbox starts empty');

  const teacherPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
  const studentPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
  const teacherId = await createAuthUser(teacherEmail, teacherPassword);
  await createAuthUser(studentEmail, studentPassword);
  const { error: promoteError } = await admin.from('profiles').update({ role: 'teacher' }).eq('id', teacherId);
  if (promoteError) throw new Error(`Cannot locally provision synthetic teacher: ${promoteError.message}`);
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('role,is_active').eq('id', teacherId).single();
  assert(!profileError && profile?.role === 'teacher' && profile?.is_active === true,
    'Disposable teacher has a valid active teacher profile');

  const teacherToken = await login(teacherEmail, teacherPassword);
  const studentToken = await login(studentEmail, studentPassword);
  const googleBody = {
    email: googleEmail, fullName: 'Gate 2d Google Student', invitationMethod: 'google_no_email',
    teacherId: '00000000-0000-4000-8000-000000000000', // intentionally untrusted; server must ignore
  };

  console.log('\nGoogle branch:');
  const google = await callFunction(teacherToken, googleBody);
  assert(google.status === 200 && google.data.success === true && google.data.pendingActivation === true
    && google.data.emailSent === false && google.data.invitationMethod === 'google_no_email'
    && /^[a-f0-9-]{36}$/.test(google.data.invitationId || ''),
    'Authenticated teacher creates a Google-pending invitation', `HTTP ${google.status}: ${JSON.stringify(google.data)}`);
  const snapshotGoogle = dbSnapshot(googleEmail, teacherId);
  assert(Number(snapshotGoogle.auth_count) === 0 && Number(snapshotGoogle.profile_count) === 0
    && Number(snapshotGoogle.relationship_count) === 0, 'Google invitation creates NO Auth user, profile or relationship');
  assert(Number(snapshotGoogle.pending_count) === 1 && snapshotGoogle.pending_id === google.data.invitationId
    && snapshotGoogle.pending_teacher === teacherId,
    'Exactly one pending invitation belongs to verified teacher, not supplied teacherId');
  assert((await mailCount(googleEmail)) === 0, 'Google invitation sends no Mailpit message');

  const again = await callFunction(teacherToken, { ...googleBody, fullName: 'Gate 2d Renamed Student' });
  const secondSnapshot = dbSnapshot(googleEmail, teacherId);
  assert(again.status === 200 && again.data.invitationId === google.data.invitationId
    && Number(secondSnapshot.pending_count) === 1,
    'Repeated Google invite is idempotent (same invitation UUID)');
  assert((await mailCount(googleEmail)) === 0, 'Repeated Google invite still sends no email');

  console.log('\nAccess and request validation:');
  const noAuth = await callFunction(null, googleBody);
  assert(noAuth.status === 401, 'Unauthenticated HTTP request is rejected (401)', `HTTP ${noAuth.status}`);
  const student = await callFunction(studentToken, googleBody);
  assert(student.status === 403, 'Student cannot create invitations (403)', `HTTP ${student.status}`);
  const invalid = await callFunction(teacherToken, { ...googleBody, invitationMethod: 'unsupported' });
  assert(invalid.status === 400, 'Unknown explicit invitation method is rejected (400)', `HTTP ${invalid.status}`);
  assert(Number(dbSnapshot(googleEmail, teacherId).pending_count) === 1,
    'Rejected requests do not create new pending invitations');

  console.log('\nLegacy email/password branch:');
  const emailInvite = await callFunction(teacherToken, {
    email: passwordEmail, fullName: 'Gate 2d Email Student', // omitted invitationMethod = legacy behavior
  });
  if (emailInvite.data?.userId) authIds.add(emailInvite.data.userId);
  assert(emailInvite.status === 200 && emailInvite.data.success === true
    && /^[a-f0-9-]{36}$/.test(emailInvite.data.userId || ''),
    'Omitted method preserves existing email invitation', `HTTP ${emailInvite.status}: ${JSON.stringify(emailInvite.data)}`);
  const snapshotPassword = dbSnapshot(passwordEmail, teacherId);
  assert(Number(snapshotPassword.auth_count) === 1 && Number(snapshotPassword.profile_count) === 1
    && snapshotPassword.profile_role === 'student' && Number(snapshotPassword.relationship_count) === 1,
    'Email invitation creates one student Auth user, student profile and teacher relationship');
  assert(Number(snapshotPassword.pending_count) === 0, 'Email path creates NO Google-pending invitation');
  assert((await waitForEmail(passwordEmail, 1)) === 1, 'Email invitation delivers one Mailpit message');
  assert((await mailCount(googleEmail)) === 0, 'Email path does not send mail to Google-only invitee');

  console.log(`\nGATE 2d PASS: ${checks} HTTP/database/Mailpit assertions.`);
} catch (error) {
  result = 'FAIL';
  console.error(`\nGATE 2d FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // Look up ONLY this run's UUID-marked disposable Auth users, in case an HTTP
  // response failed after the Edge Function had already created the user.
  try {
    for (const email of syntheticEmails) {
      // The strings are generated from a UUID, never taken from untrusted input.
      const rows = sql(`SELECT id::text FROM auth.users WHERE lower(email)='${email}';`)
        .split(/\r?\n/).filter((x) => /^[a-f0-9-]{36}$/.test(x));
      for (const id of rows) authIds.add(id);
    }
    let deleted = 0;
    for (const id of authIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`Failed to remove disposable Auth user ${id}: ${error.message}`);
      deleted++;
    }
    console.log(`Local cleanup: deleted ${deleted} disposable Auth users; pending invitation cascades with teacher profile.`);
  } catch (error) {
    result = 'FAIL';
    process.exitCode = 1;
    console.error(`LOCAL CLEANUP FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result !== 'PASS') console.error('Do NOT commit yet. Inspect the failure; do not run db reset.');
}
