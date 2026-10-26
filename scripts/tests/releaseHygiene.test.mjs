import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkGoogleConfig, findForbiddenTrackedFiles } from '../check-release-hygiene.mjs';

test('release guard rejects tracked local env files', () => {
  const issues = findForbiddenTrackedFiles(['.env', '.env.local', 'supabase/functions/.env', 'supabase/functions/.env.local']);
  assert.equal(issues.length, 4);
});
test('release guard rejects archived source and private keys', () => {
  const issues = findForbiddenTrackedFiles(['english_classes_vite.zip', 'out/release.7z', 'certs/client.pem']);
  assert.equal(issues.length, 3);
});
test('release guard rejects tracked Supabase internal state', () => {
  assert.equal(findForbiddenTrackedFiles(['supabase/.temp/project-ref', 'supabase/.branches/main']).length, 2);
});
test('release guard permits examples and normal project source', () => {
  assert.deepEqual(findForbiddenTrackedFiles(['.env.example', 'src/pages/LoginPage/LoginPage.jsx', 'docs/security.md']), []);
});
test('Google provider config rejects a hardcoded OAuth client ID', () => {
  const config = `[auth.external.google]\nenabled = true\nclient_id = "something.apps.googleusercontent.com"\nsecret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"\n`;
  assert.match(checkGoogleConfig(config).join(' '), /Client ID/);
});
test('Google provider config rejects hardcoded client secret', () => {
  const config = `[auth.external.google]\nclient_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"\nsecret = "literal-secret"\n`;
  assert.match(checkGoogleConfig(config).join(' '), /Client Secret/);
});
test('current local Google provider config references environment variables', () => {
  const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  assert.deepEqual(checkGoogleConfig(config), []);
});

test('local Auth redirects retain Google callback and email setup/recovery', () => {
  const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  const match = config.match(/additional_redirect_urls\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(match, 'auth.additional_redirect_urls must be configured');
  for (const path of ['/auth/google/callback', '/set-password', '/reset-password']) {
    assert.ok(match[1].includes(`http://127.0.0.1:3000${path}`), `missing local redirect ${path}`);
  }
});
