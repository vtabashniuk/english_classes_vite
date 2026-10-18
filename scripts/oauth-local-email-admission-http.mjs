/**
 * Gate 3a.2-A: LOCAL-ONLY real Edge Function/Auth/Mailpit admission handoff.
 * Run only with Before User Created Hook DISABLED. Not part of CI/unit tests.
 * Uses local CLI status from an ephemeral env var, NEVER .env.local or Cloud.
 * No credentials or admission tickets are printed.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = process.cwd();
const project = basename(root);
const toml = readFileSync(resolve(root, 'supabase/config.toml'), 'utf8');

function section(key) {
  const escaped = key.replaceAll('.', '\\.');
  return toml.match(new RegExp(`^\\[${escaped}\\]\\s*$([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm'))?.[1] ?? '';
}
function port(key) {
  return Number(section(key).match(/^\s*port\s*=\s*(\d+)\s*$/m)?.[1]);
}
if (toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1] !== project ||
    port('api') !== 54321 || port('db') !== 54322) {
  throw new Error('REFUSED: current project/local API 54321 and database 54322 expected.');
}
if (/^\s*enabled\s*=\s*true\s*$/m.test(section('auth.hook.before_user_created'))) {
  throw new Error('REFUSED: Gate 3a.2-A requires Auth Hook DISABLED in local config.toml.');
}

const container = `supabase_db_${project}`;
function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', timeout: 20_000, maxBuffer: 2_000_000,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`LOCAL Docker check failed: ${result.error?.message || result.stderr?.trim()}`);
  }
  return result.stdout.trim();
}
if (!docker(['ps', '--format', '{{.Names}}']).split(/\r?\n/).includes(container) ||
    !docker(['port', container, '5432/tcp']).split(/\r?\n/).some((line) => line.endsWith(':54322'))) {
  throw new Error('REFUSED: exact local DB container and port are required.');
}

const status = {};
for (const line of (process.env.CRM_SUPABASE_LOCAL_STATUS || '').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) status[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
}
const url = new URL(status.API_URL || 'https://invalid.invalid');
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '54321' || !['', '/'].includes(url.pathname) ||
    !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error('REFUSED: supply LOCAL npx supabase status -o env through CRM_SUPABASE_LOCAL_STATUS.');
}

const base = 'http://127.0.0.1:54321';
const mailpit = 'http://127.0.0.1:54324';
const auth = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
const admin = createClient(base, status.SERVICE_ROLE_KEY, { auth });
const publicClient = createClient(base, status.ANON_KEY, { auth });
const marker = randomUUID().replaceAll('-', '');
const teacherEmail = `oauth-admission-teacher-${marker}@example.invalid`;
const studentEmail = `oauth-admission-student-${marker}@example.invalid`;
const googleEmail = `oauth-admission-google-${marker}@example.invalid`;
const emails = [teacherEmail, studentEmail, googleEmail];
const created = new Set();
let checks = 0;
let failed = false;

function assert(value, message, details = '') {
  if (!value) throw new Error(`${message}${details ? `: ${details}` : ''}`);
  checks += 1;
  console.log(`  PASS: ${message}`);
}
function safeEmail(email) {
  if (!/^oauth-admission-(teacher|student|google|invited)-[a-f0-9]{32}@example\.invalid$/.test(email)) {
    throw new Error('REFUSED: SQL permits only disposable script-generated emails.');
  }
  return email;
}
function sql(statement) {
  return docker(['exec', container, 'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-c', statement]);
}
function snapshot(email, teacherId) {
  safeEmail(email);
  if (!/^[a-f0-9-]{36}$/.test(teacherId)) throw new Error('Invalid local teacher ID.');
  const result = sql(`SELECT json_build_object(
    'auth_count', (SELECT count(*) FROM auth.users WHERE lower(email)='${email}'),
    'profile_count', (SELECT count(*) FROM public.profiles WHERE lower(email)='${email}'),
    'profile_role', (SELECT role::text FROM public.profiles WHERE lower(email)='${email}' LIMIT 1),
    'link_count', (SELECT count(*) FROM public.teacher_students ts JOIN public.profiles p
       ON ts.student_id=p.id WHERE ts.teacher_id='${teacherId}'::uuid AND lower(p.email)='${email}'),
    'pending_count', (SELECT count(*) FROM crm_private.pending_google_invitations WHERE email='${email}' AND status='pending'),
    'admission_count', (SELECT count(*) FROM crm_private.email_invitation_admissions WHERE email='${email}'),
    'revoked_count', (SELECT count(*) FROM crm_private.email_invitation_admissions WHERE email='${email}' AND revoked_at IS NOT NULL AND consumed_at IS NULL),
    'consumed_count', (SELECT count(*) FROM crm_private.email_invitation_admissions WHERE email='${email}' AND consumed_at IS NOT NULL),
    'ticket_matches_hash', (SELECT count(*) FROM crm_private.email_invitation_admissions a
      JOIN auth.users u ON lower(u.email)=a.email
      WHERE a.email='${email}' AND a.ticket_hash = sha256(convert_to(u.raw_user_meta_data->>'crm_email_invite_ticket','UTF8'))),
    'replay_denied', (SELECT (public.crm_before_user_created_hook(jsonb_build_object('user',jsonb_build_object(
      'email',u.email,'app_metadata',jsonb_build_object('provider','email'),
      'user_metadata',u.raw_user_meta_data))) #>> '{error,http_code}')='403'
      FROM auth.users u WHERE lower(u.email)='${email}' LIMIT 1)
  )::text;`);
  return JSON.parse(result);
}
async function mailSearch(email) {
  safeEmail(email);
  const response = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=50`,
    { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Local Mailpit HTTP ${response.status}`);
  return response.json();
}
async function waitForMail(email, expected = 1) {
  for (let i = 0; i < 30; i++) {
    const result = await mailSearch(email);
    if (result.messages_count === expected) return result;
    await new Promise((done) => setTimeout(done, 350));
  }
  return mailSearch(email);
}
async function callFunction(token, body) {
  const response = await fetch(`${base}/functions/v1/invite-student`, {
    method: 'POST',
    headers: { apikey: status.ANON_KEY, 'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(35_000),
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { text: raw.slice(0, 300) }; }
  return { status: response.status, payload, raw };
}
async function makeUser(email, password) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: 'Gate 3a.2-A fixture' },
  });
  if (error || !data.user?.id) throw new Error(`LOCAL fixture create failed: ${error?.message ?? 'no UUID'}`);
  created.add(data.user.id);
  return data.user.id;
}
async function signIn(email, password) {
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error(`LOCAL sign-in failed: ${error?.message || 'no session'}`);
  return data.session.access_token;
}
async function cleanup() {
  // If the HTTP response failed after Auth created an account, still find and
  // delete ONLY this run's exact random-email records. Never wildcard delete.
  for (const email of emails) {
    safeEmail(email);
    for (const id of sql(`SELECT id::text FROM auth.users WHERE lower(email)='${email}';`).split(/\r?\n/)) {
      if (/^[a-f0-9-]{36}$/.test(id)) created.add(id);
    }
  }
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`LOCAL fixture cleanup failed for ${id}: ${error.message}`);
  }
  console.log(`Local cleanup: ${created.size} disposable Auth accounts deleted.`);
}

console.log('Gate 3a.2-A / LOCAL ONLY — Hook OFF, no migrations, no Production.');
try {
  const health = await fetch(`${base}/functions/v1/invite-student`, {
    method: 'OPTIONS', headers: { apikey: status.ANON_KEY }, signal: AbortSignal.timeout(12_000),
  });
  assert(health.ok, 'Local invite-student Edge Function is running');
  // Verify the migration is present and a non-browser role cannot issue tickets.
  assert(sql("SELECT to_regclass('crm_private.email_invitation_admissions') IS NOT NULL;") === 't',
    'Gate 3a.1 admission table exists locally');
  assert(sql("SELECT NOT has_function_privilege('authenticated','public.issue_email_invitation_admission(uuid,text)','EXECUTE');") === 't',
    'Browser authenticated role cannot mint admission tickets');
  assert((await mailSearch(studentEmail)).messages_count === 0, 'Test mailbox starts empty');

  const teacherPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
  const studentPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
  const teacherId = await makeUser(teacherEmail, teacherPassword);
  await makeUser(studentEmail, studentPassword); // This user is an access-control fixture.
  const { error: promoteError } = await admin.from('profiles').update({ role: 'teacher' }).eq('id', teacherId);
  if (promoteError) throw new Error(`Cannot provision local teacher: ${promoteError.message}`);
  const teacherToken = await signIn(teacherEmail, teacherPassword);
  const studentToken = await signIn(studentEmail, studentPassword);

  const unauth = await callFunction(null, { email: googleEmail, invitationMethod: 'google_no_email' });
  assert(unauth.status === 401, 'Unauthenticated caller rejected');
  const byStudent = await callFunction(studentToken, { email: googleEmail, invitationMethod: 'google_no_email' });
  assert(byStudent.status === 403, 'Student JWT cannot issue invitation');

  const google = await callFunction(teacherToken, { email: googleEmail,
    fullName: 'Local Google-pending Student', invitationMethod: 'google_no_email' });
  assert(google.status === 200 && google.payload.invitationMethod === 'google_no_email' &&
    google.payload.emailSent === false, 'Google-pending mode remains unchanged', `HTTP ${google.status}`);
  const googleState = snapshot(googleEmail, teacherId);
  assert(Number(googleState.pending_count) === 1 && Number(googleState.auth_count) === 0 &&
    Number(googleState.admission_count) === 0, 'Google branch does not create Auth user or email admission');

  // Target must not have a pre-existing Auth/profile (only teacher and control student exist).
  const invitedEmail = `oauth-admission-invited-${marker}@example.invalid`;
  emails.push(invitedEmail);
  const invitation = await callFunction(teacherToken, { email: invitedEmail,
    fullName: 'Gate 3a.2-A Invited Student' }); // legacy omitted invitationMethod
  if (invitation.payload.userId) created.add(invitation.payload.userId);
  assert(invitation.status === 200 && invitation.payload.success === true &&
    /^[a-f0-9-]{36}$/.test(invitation.payload.userId || ''),
    'Legacy email invitation still creates a new student', `HTTP ${invitation.status}`);
  const { data: invited, error: readInviteError } = await admin.auth.admin.getUserById(invitation.payload.userId);
  if (readInviteError) throw new Error(`LOCAL Auth read failed: ${readInviteError.name}`);
  const rawTicket = invited.user?.user_metadata?.crm_email_invite_ticket;
  assert(typeof rawTicket === 'string' && /^[a-f0-9-]{36}\.[a-f0-9-]{36}$/.test(rawTicket),
    'Real Supabase Auth user_metadata received the opaque server-issued ticket');
  assert(!invitation.raw.includes(rawTicket) && !/crm_email_invite_ticket|admissionTicket|p_ticket/.test(invitation.raw),
    'Public HTTP response does not contain admission ticket or its field name');
  const state = snapshot(invitedEmail, teacherId);
  assert(Number(state.auth_count) === 1 && Number(state.profile_count) === 1 &&
    state.profile_role === 'student' && Number(state.link_count) === 1,
    'Exactly one Auth user, student profile and teacher relationship');
  assert(Number(state.admission_count) === 1 && Number(state.ticket_matches_hash) === 1,
    'One real invitation carries exactly the hashed server-issued ticket in Auth user_metadata');
  assert(Number(state.revoked_count) === 1 && Number(state.consumed_count) === 0,
    'Hook OFF: server revoked unused ticket after Auth call');
  assert(state.replay_denied === true, 'Stored ticket cannot be replayed through admission hook');
  assert(Number(state.pending_count) === 0, 'Email flow does not create Google-pending invitations');

  const mail = await waitForMail(invitedEmail);
  assert(mail.messages_count === 1, 'One invitation email delivered to local Mailpit');
  const mailId = mail.messages?.[0]?.ID;
  if (!mailId) throw new Error('Mailpit response missing invitation message ID');
  const messageResponse = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(mailId)}`,
    { signal: AbortSignal.timeout(8_000) });
  if (!messageResponse.ok) throw new Error(`Mailpit message fetch HTTP ${messageResponse.status}`);
  const message = await messageResponse.text();
  assert(!/english-classes-sigma\.vercel\.app/i.test(message),
    'Local test invitation email does not redirect to Production');
  assert(/localhost/i.test(message) && /5173/.test(message) && /set-password/i.test(message),
    'Invitation email preserves the LOCAL /set-password redirect (Vite 5173)');
  assert(!message.includes(rawTicket) && !/crm_email_invite_ticket/.test(message),
    'Invitation email does not expose admission ticket or metadata');

  const repeated = await callFunction(teacherToken, { email: invitedEmail, fullName: 'Idempotent Test' });
  assert(repeated.status === 200 && repeated.payload.existingUser === true &&
    repeated.payload.alreadyLinked === true && repeated.payload.userId === invitation.payload.userId,
    'Repeated email invitation uses existing student UUID');
  assert(Number(snapshot(invitedEmail, teacherId).admission_count) === 1 &&
    (await mailSearch(invitedEmail)).messages_count === 1,
    'Repeated invitation creates no new admission or email');

  console.log(`\nGATE 3a.2-A PASS: ${checks} local HTTP/Auth/DB/Mailpit checks.`);
} catch (error) {
  failed = true;
  process.exitCode = 1;
  console.error(`\nGATE 3a.2-A FAILED: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try { await cleanup(); } catch (error) {
    failed = true;
    process.exitCode = 1;
    console.error(`LOCAL CLEANUP FAILED: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (failed) console.error('Do not enable Hook or commit until the failure is understood. Never run db reset.');
}
