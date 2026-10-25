// Release guard for committed paths and local-only OAuth configuration.
// Requires only Node and Git. Does not inspect private or ignored .env files.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findForbiddenTrackedFiles(paths) {
  const errors = [];
  for (const input of paths) {
    const file = input.replaceAll('\\', '/');
    const base = file.slice(file.lastIndexOf('/') + 1);
    if ((base === '.env' || base.startsWith('.env.')) && base !== '.env.example') {
      errors.push(`${file}: private environment file must not be tracked`);
    }
    if (/\.(zip|7z|rar|p12|pfx|pem|key)$/i.test(file)) {
      errors.push(`${file}: archive or private key must not be tracked`);
    }
    if (file.split('/').includes('.temp') || file.split('/').includes('.branches')) {
      errors.push(`${file}: local Supabase state must not be tracked`);
    }
  }
  return errors;
}

export function checkGoogleConfig(config) {
  const section = config.match(/^\[auth\.external\.google\]\s*$([\s\S]*?)(?=^\[[^\]]+\]\s*$|(?![\s\S]))/m);
  if (!section) return ['supabase/config.toml: missing [auth.external.google]'];
  const body = section[1];
  const errors = [];
  if (!/^client_id\s*=\s*"env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID\)"\s*$/m.test(body)) {
    errors.push('supabase/config.toml: Google Client ID must use the approved env() variable');
  }
  if (!/^secret\s*=\s*"env\(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET\)"\s*$/m.test(body)) {
    errors.push('supabase/config.toml: Google Client Secret must use the approved env() variable');
  }
  return errors;
}

export function releaseHygieneErrors(trackedFiles, config) {
  return [...findForbiddenTrackedFiles(trackedFiles), ...checkGoogleConfig(config)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
  } catch {
    console.error('Release hygiene: Git working tree is required');
    process.exitCode = 2;
  }
  if (tracked) {
    const config = readFileSync('supabase/config.toml', 'utf8');
    const errors = releaseHygieneErrors(tracked, config);
    if (errors.length) {
      console.error('Release hygiene FAILED:\n' + errors.map((s) => `- ${s}`).join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`Release hygiene PASS (${tracked.length} tracked files checked)`);
    }
  }
}
