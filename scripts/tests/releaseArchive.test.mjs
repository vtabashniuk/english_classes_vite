import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipEntries, releaseArchiveErrors } from '../check-release-archive.mjs';

// Minimal valid store-only ZIP for testing central/local filename validation.
function makeZip(names) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const name of names) {
    const bytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(bytes.length, 26);
    locals.push(local, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(bytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, bytes);
    offset += local.length + bytes.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

test('archive guard reads a ZIP and permits normal code and a public env example', () => {
  const entries = zipEntries(makeZip(['.env.example', 'src/router.jsx', 'supabase/config.toml']));
  assert.equal(entries.length, 3);
  assert.deepEqual(releaseArchiveErrors(entries), []);
});

test('archive guard blocks ignored credentials and internal state even if untracked', () => {
  const entries = zipEntries(makeZip([
    'src/App.jsx', 'supabase/functions/.env.local',
    'supabase/.temp/start-secrets/edge/env/docker.env',
    'node_modules/demo/index.js', '.git/config',
  ]));
  assert.ok(releaseArchiveErrors(entries).length >= 4);
});

test('archive guard blocks unsafe paths, symlinks and nested archives', () => {
  const errors = releaseArchiveErrors(['../secret.txt', '/root/secret', 'docs/backup.zip',
    { name: 'src/link', isSymlink: true }]);
  assert.ok(errors.length >= 4);
});

test('archive guard rejects corrupt or forged ZIP directories', () => {
  assert.throws(() => zipEntries(Buffer.from('not a zip')), /Missing ZIP/);
  const forged = makeZip(['src/ok.js']);
  const nameOffset = forged.indexOf(Buffer.from('src/ok.js'));
  forged.write('x', nameOffset);
  assert.throws(() => zipEntries(forged), /filename mismatch/);
});
