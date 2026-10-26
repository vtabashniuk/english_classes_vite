import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsGoogleInvitationConsent } from '../../src/features/auth/lib/googleOAuthPolicy.js';

const baseProfile = { id: 'a', role: 'student', is_active: true };
const googleUser = { id: 'a', identities: [{ provider: 'google' }] };

test('Unlinked verified Google student needs an invitation', () => {
  assert.equal(needsGoogleInvitationConsent({ user: googleUser, profile: baseProfile, hasTeacherLink: false }), true);
});
test('Already linked Google student may enter student routes', () => {
  assert.equal(needsGoogleInvitationConsent({ user: googleUser, profile: baseProfile, hasTeacherLink: true }), false);
});
test('Email-only student is not blocked by Google consent route', () => {
  assert.equal(needsGoogleInvitationConsent({ user: { id:'a', identities: [{provider:'email'}] }, profile: baseProfile, hasTeacherLink:false }), false);
});
test('Mismatched or inactive profile never satisfies Google consent helper', () => {
  assert.equal(needsGoogleInvitationConsent({ user: googleUser, profile: {...baseProfile,id:'b'}, hasTeacherLink:false }), false);
  assert.equal(needsGoogleInvitationConsent({ user: googleUser, profile: {...baseProfile,is_active:false}, hasTeacherLink:false }), false);
});
test('Email callback cannot exchange an unrelated OAuth code or grant a password flow', () => {
  const code = readFileSync(new URL('../../src/pages/AuthCallback/AuthCallback.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(code,/grantPasswordFlow\(/);
  assert.doesNotMatch(code,/exchangeCodeForSession\(/);
  assert.match(code,/canUsePasswordFlow\("invite"/);
});
test('Password recovery requires verified PASSWORD_RECOVERY grant, not code exchange alone', () => {
  const code = readFileSync(new URL('../../src/pages/ResetPasswordPage/ResetPasswordPage.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(code,/grantPasswordFlow\(/);
  assert.match(code,/!canUsePasswordFlow\("recovery", data.user.id\)/);
});
test('Route guard refuses an older Auth profile and gates unlinked Google students', () => {
  const code = readFileSync(new URL('../../src/components/auth/ProtectedRoute.jsx',import.meta.url),'utf8');
  assert.match(code,/profile.id !== sessionUserId/);
  assert.match(code,/needsGoogleInvitationConsent/);
  assert.match(code,/\/google\/accept-invitation/);
});
