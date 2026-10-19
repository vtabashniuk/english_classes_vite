/**
 * CRM OAuth 1.6.1a / Gate 3a.2-B — explicit LOCAL-ONLY Hook ON test.
 * Three modes: prepare (Hook OFF), verify (Hook ON), cleanup (either).
 * No database reset, Production calls, migrations or config edits.
 * Never print local API keys, fixture passwords or raw admission tickets.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const mode = process.argv[2];
if (!['prepare', 'verify', 'cleanup'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/oauth-local-email-admission-hook-http.mjs prepare|verify|cleanup');
}
const project = basename(process.cwd());
const branch = spawnSync('git', ['branch', '--show-current'], {
  encoding: 'utf8', timeout: 10_000,
});
if (branch.error || branch.status !== 0 || branch.stdout.trim() !== 'feature/oauth-google') {
  throw new Error('REFUSED: Gate 3a.2-B requires branch feature/oauth-google, not main.');
}
const toml = readFileSync(resolve('supabase/config.toml'), 'utf8');
const statePath = join(tmpdir(), `crm-gate3a2b-${project}-fixture.json`);
const section = (key) => {
  const lines = toml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${key}]`);
  if (start === -1) return '';
  const output = [];
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i]); i++) {
    output.push(lines[i]);
  }
  return output.join('\n');
};
const port = (key) => Number(section(key).match(/^\s*port\s*=\s*(\d+)\s*$/m)?.[1]);
const currentProject = toml.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];
if (project !== 'english_classes_vite' || currentProject !== project ||
    port('api') !== 54321 || port('db') !== 54322) {
  throw new Error('REFUSED: exact local english_classes_vite project and API/DB ports 54321/54322 required.');
}
const hookConfig = section('auth.hook.before_user_created');
const hookEnabled = /^\s*enabled\s*=\s*true\s*$/m.test(hookConfig);
const correctHook = /^\s*uri\s*=\s*"pg-functions:\/\/postgres\/public\/crm_before_user_created_hook"\s*$/m.test(hookConfig);
if (mode === 'prepare' && hookEnabled) throw new Error('REFUSED: prepare MUST run before enabling the Hook.');
if (mode === 'verify' && (!hookEnabled || !correctHook)) {
  throw new Error('REFUSED: verify requires LOCAL Before User Created Hook enabled with exact public.crm_before_user_created_hook URI.');
}

const container = `supabase_db_${project}`;
function docker(args, input) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout: 25_000, maxBuffer: 2_000_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`LOCAL Docker request failed (${args[0]}): ${result.error?.message || result.stderr?.trim() || 'unknown'}`);
  }
  return result.stdout.trim();
}
if (!docker(['ps', '--format', '{{.Names}}']).split(/\r?\n/).includes(container) ||
    !docker(['port', container, '5432/tcp']).split(/\r?\n/).some((line) => line.endsWith(':54322'))) {
  throw new Error('REFUSED: expected LOCAL Supabase DB container exposed on port 54322.');
}
function sql(statement) {
  // SQL through stdin: never place a secret ticket in process command-line arguments.
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-f', '-'], `${statement}\n`);
}
const status = {};
for (const line of (process.env.CRM_SUPABASE_LOCAL_STATUS || '').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) status[match[1]] = match[2].trim().replace(/^"(.*)"$/, '$1');
}
const url = new URL(status.API_URL || 'https://invalid.invalid');
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== '54321' || !['', '/'].includes(url.pathname) ||
    !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  throw new Error('REFUSED: exact LOCAL status -o env via CRM_SUPABASE_LOCAL_STATUS is required.');
}
const base = 'http://127.0.0.1:54321';
const authOpts = { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };
const admin = createClient(base, status.SERVICE_ROLE_KEY, { auth: authOpts });
const publicClient = createClient(base, status.ANON_KEY, { auth: authOpts });
let checks = 0;
function assert(condition, name, details = '') {
  if (!condition) throw new Error(`${name}${details ? ` (${details})` : ''}`);
  checks += 1;
  console.log(`  PASS: ${name}`);
}
const roles = ['teacher', 'student', 'self', 'role', 'forged', 'legit', 'mismatch',
  'wrong-email', 'expired', 'revoked', 'replay', 'google', 'inactive', 'invalid'];
function validateState(s) {
  if (!s || !/^[a-f0-9]{32}$/.test(s.marker || '') ||
      !/^[a-f0-9-]{36}$/.test(s.teacherId || '') ||
      typeof s.teacherPassword !== 'string' || typeof s.studentPassword !== 'string' ||
      s.teacherPassword.length < 30 || s.studentPassword.length < 30 ||
      s.teacherEmail !== `oauth-hook-teacher-${s.marker}@example.invalid` ||
      s.studentEmail !== `oauth-hook-student-${s.marker}@example.invalid`) {
    throw new Error('REFUSED: invalid local fixture state.');
  }
  return s;
}
const emailFor = (role, s) => {
  if (!roles.includes(role)) throw new Error('Invalid synthetic role.');
  return `oauth-hook-${role}-${s.marker}@example.invalid`;
};
function loadState() {
  if (!existsSync(statePath)) throw new Error('No prepared fixture. Run prepare while Hook is OFF first.');
  return validateState(JSON.parse(readFileSync(statePath, 'utf8')));
}
function snapshot(role, s) {
  const email = emailFor(role, s);
  const raw = sql(`select json_build_object(
    'auth_count',(select count(*) from auth.users where lower(email)='${email}'),
    'profile_count',(select count(*) from public.profiles where lower(email)='${email}'),
    'relationship_count',(select count(*) from public.teacher_students ts join public.profiles p
      on p.id=ts.student_id where ts.teacher_id='${s.teacherId}'::uuid and lower(p.email)='${email}'),
    'pending_count',(select count(*) from crm_private.pending_google_invitations where email='${email}' and status='pending'),
    'admission_count',(select count(*) from crm_private.email_invitation_admissions where email='${email}'),
    'consumed_count',(select count(*) from crm_private.email_invitation_admissions where email='${email}' and consumed_at is not null),
    'revoked_count',(select count(*) from crm_private.email_invitation_admissions where email='${email}' and revoked_at is not null),
    'unspent_count',(select count(*) from crm_private.email_invitation_admissions where email='${email}' and consumed_at is null and revoked_at is null),
    'raw_ticket_count',(select count(*) from auth.users where lower(email)='${email}'
      and length(coalesce(raw_user_meta_data->>'crm_email_invite_ticket',''))>0),
    'full_name',(select raw_user_meta_data->>'full_name' from auth.users where lower(email)='${email}' limit 1),
    'role_meta',(select raw_user_meta_data->>'role' from auth.users where lower(email)='${email}' limit 1)
  )::text;`);
  return JSON.parse(raw);
}
async function callFunction(token, body) {
  const response = await fetch(`${base}/functions/v1/invite-student`, {
    method: 'POST', headers: { apikey: status.ANON_KEY, 'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(35_000),
  });
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { error: 'Non-JSON local response' }; }
  return { status: response.status, payload, raw };
}
async function mailSearch(email) {
  const response = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=50`,
    { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Local Mailpit HTTP ${response.status}`);
  return response.json();
}
async function waitMail(email) {
  for (let i = 0; i < 30; i++) {
    const data = await mailSearch(email);
    if (data.messages_count === 1) return data;
    await new Promise((done) => setTimeout(done, 350));
  }
  return mailSearch(email);
}
async function provision(email, password, userMetadata = {}) {
  return admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: 'Gate 3a.2-B local fixture', ...userMetadata },
  });
}
async function ticket(teacherId, email) {
  const { data, error } = await admin.rpc('issue_email_invitation_admission', {
    p_teacher_id: teacherId, p_email: email,
  });
  if (error || !/^[a-f0-9-]{36}\.[a-f0-9-]{36}$/.test(data || '')) {
    throw new Error(`LOCAL admission issuance failed: ${error?.code || 'unexpected response'}`);
  }
  return data;
}
async function revoke(value) {
  const { data, error } = await admin.rpc('revoke_email_invitation_admission', { p_ticket: value });
  if (error) throw new Error(`LOCAL admission revoke failed: ${error.code}`);
  return data;
}
async function deniedSignup(email, value, label) {
  // IMPORTANT: admin.createUser() is privileged provisioning and bypasses the
  // Before User Created Hook. Exercise the real public Auth signup endpoint,
  // as an untrusted caller would, instead of expecting admin createUser to fail.
  const { data, error } = await publicClient.auth.signUp({
    email,
    password: `${randomBytes(24).toString('base64url')}Aa1!`,
    options: { data: value ? { crm_email_invite_ticket: value, role: 'teacher' } : { role: 'teacher' } },
  });
  assert(Boolean(error) && error.status === 403 && !data?.user,
    `${label}: public signUp denied by Hook (403)`,
    error ? `HTTP ${error.status}` : 'unexpected success');
  const count = sql(`select count(*) from auth.users where lower(email)='${email}';`);
  assert(count === '0', `${label}: no Auth user inserted`);
}

async function prepare() {
  if (existsSync(statePath)) throw new Error('REFUSED: prior fixture exists; run cleanup first (or investigate it).');
  const marker = randomUUID().replaceAll('-', '');
  const s = {
    marker, teacherEmail: `oauth-hook-teacher-${marker}@example.invalid`,
    studentEmail: `oauth-hook-student-${marker}@example.invalid`,
    teacherPassword: `${randomBytes(24).toString('base64url')}Aa1!`,
    studentPassword: `${randomBytes(24).toString('base64url')}Aa1!`,
  };
  const teacher = await provision(s.teacherEmail, s.teacherPassword);
  if (teacher.error || !teacher.data?.user?.id) throw new Error(`Local teacher fixture failed: ${teacher.error?.code || 'missing ID'}`);
  s.teacherId = teacher.data.user.id;
  // Save the fixture ID immediately so cleanup is possible if later provisioning fails.
  writeFileSync(statePath, JSON.stringify(s), { flag: 'wx', mode: 0o600 });
  const student = await provision(s.studentEmail, s.studentPassword);
  if (student.error || !student.data?.user?.id) throw new Error(`Local control student fixture failed: ${student.error?.code || 'missing ID'}`);
  const { error } = await admin.from('profiles').update({ role: 'teacher' }).eq('id', s.teacherId);
  if (error) throw new Error(`Local teacher promotion failed: ${error.code}`);
  assert(sql(`select exists(select 1 from public.profiles where id='${s.teacherId}'::uuid
    and role='teacher' and is_active=true);`) === 't', 'Prepared active LOCAL teacher before Hook activation');
  assert(Number(snapshot('student', s).auth_count) === 1, 'Prepared LOCAL student access-control fixture');
  console.log('PREPARE PASS. Stop Edge Function serving, enable only LOCAL Hook in config.toml, restart local Supabase, re-serve Function, run verify.');
  console.log('Fixture credentials are in the OS temporary directory, NOT in the repository.');
}

async function verify() {
  const s = loadState();
  assert(sql("select to_regclass('crm_private.email_invitation_admissions') is not null;") === 't',
    'Gate 3a.1 admission table exists');
  assert(sql("select has_function_privilege('supabase_auth_admin','public.crm_before_user_created_hook(jsonb)','EXECUTE');") === 't',
    'Auth service has EXECUTE privilege on Hook');
  assert(sql("select not has_function_privilege('authenticated','public.issue_email_invitation_admission(uuid,text)','EXECUTE');") === 't',
    'Client cannot issue admission tickets');
  const response = await fetch(`${base}/functions/v1/invite-student`, {
    method: 'OPTIONS', headers: { apikey: status.ANON_KEY }, signal: AbortSignal.timeout(12_000),
  });
  assert(response.ok, 'Local invite-student is serving');
  const { data: teacherSession, error: teacherError } =
    await publicClient.auth.signInWithPassword({ email: s.teacherEmail, password: s.teacherPassword });
  if (teacherError || !teacherSession.session?.access_token) throw new Error(`Teacher login failed: ${teacherError?.code}`);
  const { data: studentSession, error: studentError } =
    await publicClient.auth.signInWithPassword({ email: s.studentEmail, password: s.studentPassword });
  if (studentError || !studentSession.session?.access_token) throw new Error(`Student login failed: ${studentError?.code}`);
  const teacherToken = teacherSession.session.access_token;
  const studentToken = studentSession.session.access_token;
  assert(Boolean(teacherToken && studentToken), 'Pre-existing users can still sign in with Hook ON');

  const password = `${randomBytes(24).toString('base64url')}Aa1!`;
  const self = await publicClient.auth.signUp({ email: emailFor('self', s), password });
  assert(Boolean(self.error) && self.error.status === 403 && Number(snapshot('self', s).auth_count) === 0,
    'Real self signUp WITHOUT ticket blocked by Hook (403)', `HTTP ${self.error?.status || 'success'}`);
  const role = await publicClient.auth.signUp({ email: emailFor('role', s), password,
    options: { data: { role: 'teacher', full_name: 'Forged Teacher' } } });
  assert(Boolean(role.error) && role.error.status === 403 && Number(snapshot('role', s).auth_count) === 0,
    'Forged user_metadata.role=teacher does not bypass Hook', `HTTP ${role.error?.status || 'success'}`);
  const forged = await publicClient.auth.signUp({ email: emailFor('forged', s), password,
    options: { data: { role: 'student', crm_email_invite_ticket: `${randomUUID()}.${randomUUID()}` } } });
  assert(Boolean(forged.error) && forged.error.status === 403 && Number(snapshot('forged', s).auth_count) === 0,
    'Forged opaque ticket does not permit self signUp', `HTTP ${forged.error?.status || 'success'}`);

  const unauth = await callFunction(null, { email: emailFor('legit', s) });
  assert(unauth.status === 401, 'Unauthenticated Edge caller still rejected');
  const badStudent = await callFunction(studentToken, { email: emailFor('legit', s) });
  assert(badStudent.status === 403, 'Student cannot invite another student');

  const invitedEmail = emailFor('legit', s);
  const invited = await callFunction(teacherToken, { email: invitedEmail,
    fullName: 'Gate 3a.2-B Invited Student' });
  assert(invited.status === 200 && invited.payload.success === true &&
    /^[a-f0-9-]{36}$/.test(invited.payload.userId || ''),
    'REAL inviteUserByEmail creates invited student with Hook ON', `HTTP ${invited.status}`);
  const legit = snapshot('legit', s);
  assert(Number(legit.auth_count) === 1 && Number(legit.profile_count) === 1 &&
    Number(legit.relationship_count) === 1, 'One Auth user, profile and teacher/student link');
  assert(Number(legit.admission_count) === 1 && Number(legit.consumed_count) === 1 &&
    Number(legit.revoked_count) === 0 && Number(legit.unspent_count) === 0,
    'REAL Auth Hook consumed single-use ticket (not server revocation)');
  assert(Number(legit.raw_ticket_count) === 0 && legit.full_name === 'Gate 3a.2-B Invited Student' &&
    legit.role_meta === 'student', 'Invite ticket scrubbed from Auth metadata; name and role preserved');
  assert(!/crm_email_invite_ticket|admissionTicket|p_ticket/.test(invited.raw),
    'Public HTTP response does not expose admission metadata');
  const mail = await waitMail(invitedEmail);
  assert(mail.messages_count === 1, 'One real invitation reached LOCAL Mailpit');
  const id = mail.messages?.[0]?.ID;
  if (!id) throw new Error('Mailpit invitation message ID missing');
  const messageResponse = await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(id)}`,
    { signal: AbortSignal.timeout(8_000) });
  if (!messageResponse.ok) throw new Error(`Mailpit message HTTP ${messageResponse.status}`);
  const message = await messageResponse.text();
  assert(/localhost/i.test(message) && /5173/.test(message) && /set-password/i.test(message) &&
    !/english-classes-sigma\.vercel\.app/i.test(message), 'Email redirects to LOCAL /set-password only');
  assert(!/crm_email_invite_ticket/.test(message) &&
    !/\b[0-9a-f-]{36}\.[0-9a-f-]{36}\b/.test(message), 'Mail contains no admission ticket');
  const repeated = await callFunction(teacherToken, { email: invitedEmail, fullName: 'Second invite' });
  assert(repeated.status === 200 && repeated.payload.existingUser === true &&
    repeated.payload.alreadyLinked === true && repeated.payload.userId === invited.payload.userId &&
    Number(snapshot('legit', s).admission_count) === 1 &&
    (await mailSearch(invitedEmail)).messages_count === 1,
    'Repeated invitation is idempotent with Hook ON');

  await deniedSignup(emailFor('wrong-email', s), await ticket(s.teacherId, emailFor('mismatch', s)),
    'Ticket for a DIFFERENT email');
  assert(Number(snapshot('mismatch', s).unspent_count) === 1,
    'Email mismatch did not consume the ticket');
  // In the mismatch test, revoke the remaining unused capability via the
  // service-only function without exposing its value in logs.
  const mismatchAdmission = sql(`update crm_private.email_invitation_admissions
    set revoked_at=now() where email='${emailFor('mismatch', s)}' and revoked_at is null and consumed_at is null returning id;`);
  assert(/^[a-f0-9-]{36}$/.test(mismatchAdmission), 'Remaining mismatch ticket revoked by LOCAL cleanup');

  const expiredTicket = await ticket(s.teacherId, emailFor('expired', s));
  sql(`update crm_private.email_invitation_admissions
    set issued_at=now()-interval '20 minutes', expires_at=now()-interval '10 minutes'
    where email='${emailFor('expired', s)}' and consumed_at is null and revoked_at is null;`);
  await deniedSignup(emailFor('expired', s), expiredTicket, 'Expired ticket');
  assert(Number(snapshot('expired', s).consumed_count) === 0 &&
    Number(snapshot('expired', s).auth_count) === 0, 'Expired ticket never created Auth user');

  const revokedTicket = await ticket(s.teacherId, emailFor('revoked', s));
  assert(await revoke(revokedTicket) === true, 'Local server explicitly revoked ticket');
  await deniedSignup(emailFor('revoked', s), revokedTicket, 'Revoked ticket');
  assert(Number(snapshot('revoked', s).auth_count) === 0, 'Revoked ticket never created Auth user');

  const replayEmail = emailFor('replay', s);
  const replayTicket = await ticket(s.teacherId, replayEmail);
  // inviteUserByEmail() invokes Before User Created Hook, unlike privileged
  // admin.createUser(). This establishes one REAL consumed capability before
  // its Auth account is removed and the same capability is replayed via signup.
  const first = await admin.auth.admin.inviteUserByEmail(replayEmail, {
    data: {
      full_name: 'Gate 3a.2-B replay fixture',
      role: 'student',
      crm_email_invite_ticket: replayTicket,
    },
    redirectTo: 'http://localhost:5173/set-password',
  });
  assert(!first.error && Boolean(first.data?.user?.id) &&
    Number(snapshot('replay', s).consumed_count) === 1,
    'One real admin email invitation consumes ticket via Hook');
  const { error: replayCleanupError } = await admin.auth.admin.deleteUser(first.data.user.id);
  if (replayCleanupError) throw new Error(`Cannot remove replay fixture: ${replayCleanupError.code}`);
  await deniedSignup(replayEmail, replayTicket, 'Replay of already consumed ticket');
  assert(Number(snapshot('replay', s).auth_count) === 0 &&
    Number(snapshot('replay', s).consumed_count) === 1,
    'Reused ticket rejected even after first Auth account deleted');

  const google = await callFunction(teacherToken, { email: emailFor('google', s),
    invitationMethod: 'google_no_email', fullName: 'Google pending fixture' });
  const googleState = snapshot('google', s);
  assert(google.status === 200 && google.payload.emailSent === false &&
    Number(googleState.pending_count) === 1 && Number(googleState.auth_count) === 0 &&
    Number(googleState.admission_count) === 0, 'Google-pending mode unchanged with Hook ON');

  // A deliberately inactive teacher must not mint an admission. Restore
  // only our disposable fixture, never a real teacher profile.
  const deactivate = await admin.from('profiles').update({ is_active: false }).eq('id', s.teacherId);
  if (deactivate.error) throw new Error(`Fixture deactivation failed: ${deactivate.error.code}`);
  let reactivationError = null;
  try {
    const inactive = await callFunction(teacherToken, { email: emailFor('inactive', s), fullName: 'No invite' });
    assert(inactive.status === 403 && Number(snapshot('inactive', s).admission_count) === 0,
      'Inactive teacher cannot mint ticket or invite');
  } finally {
    const reactivate = await admin.from('profiles').update({ is_active: true }).eq('id', s.teacherId);
    reactivationError = reactivate.error;
  }
  if (reactivationError) throw new Error(`Fixture reactivation failed: ${reactivationError.code}`);
  console.log(`\nGATE 3a.2-B PASS: ${checks} LOCAL HTTP/Auth/DB/Mailpit checks. Run cleanup, then restore Hook OFF and local config.`);
}

async function cleanup() {
  const s = loadState();
  let removed = 0;
  // Delete ONLY this test run's unique, exact disposable email addresses.
  // Do not delete via prefix/LIKE or delete arbitrary UUIDs from a file.
  for (const role of roles) {
    const email = emailFor(role, s);
    const ids = sql(`select id::text from auth.users where lower(email)='${email}';`)
      .split(/\r?\n/).filter((id) => /^[a-f0-9-]{36}$/.test(id));
    for (const id of ids) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`LOCAL cleanup failed for synthetic account: ${error.code}`);
      removed++;
    }
  }
  // Make sure no synthetic Auth account survived, including the wrong-email
  // account an earlier (invalid) admin.createUser-based test could have made.
  const fixtureEmails = roles.map((role) => `'${emailFor(role, s)}'`).join(',');
  assert(sql(`select count(*) from auth.users where lower(email) in (${fixtureEmails});`) === '0',
    'All synthetic Auth accounts removed, including any prior admin bypass fixture');
  // Foreign keys to the fixture teacher profile cascade admission records;
  // manually verify that this happened (no broad DELETE statements).
  assert(sql(`select count(*) from crm_private.email_invitation_admissions where teacher_id='${s.teacherId}'::uuid;`) === '0',
    'Synthetic teacher admission rows removed by FK cascade');
  unlinkSync(statePath);
  console.log(`Local cleanup: ${removed} disposable Auth users deleted. Test Mailpit messages may remain.`);
}

console.log(`Gate 3a.2-B / ${mode.toUpperCase()} — LOCAL ONLY; Production and migrations untouched.`);
try {
  if (mode === 'prepare') await prepare();
  if (mode === 'verify') await verify();
  if (mode === 'cleanup') await cleanup();
} catch (error) {
  process.exitCode = 1;
  console.error(`GATE 3a.2-B ${mode.toUpperCase()} FAILED: ${error instanceof Error ? error.message : String(error)}`);
  if (mode === 'verify') console.error('Do NOT commit or deploy; preserve fixtures for diagnosis, then run cleanup when safe.');
  if (mode === 'prepare') console.error('If preparation was partial, run cleanup before retrying.');
}
