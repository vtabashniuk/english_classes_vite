// Verify the actual ZIP being shared: Git checks cannot see ignored or local files.
// No external dependencies; reads ZIP central directory metadata, not file contents.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findForbiddenTrackedFiles } from './check-release-hygiene.mjs';

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function zipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('ZIP contents must be a Buffer');
  // The End-of-Central-Directory record is at least 22 bytes and may have
  // a comment up to 65535 bytes. ZIP64/multi-disk is deliberately unsupported.
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 65535); offset--) {
    if (buffer.readUInt32LE(offset) === END && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      end = offset;
      break;
    }
  }
  if (end === -1) throw new Error('Missing ZIP central-directory footer');
  const count = buffer.readUInt16LE(end + 10);
  const total = buffer.readUInt16LE(end + 8);
  const directorySize = buffer.readUInt32LE(end + 12);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || count !== total ||
      count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('Multi-disk and ZIP64 archives are not supported');
  }
  if (directoryOffset + directorySize > end) throw new Error('Invalid ZIP central-directory bounds');

  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== CENTRAL) {
      throw new Error('Invalid ZIP central-directory entry');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const attrs = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end || localOffset === 0xffffffff) throw new Error('Invalid ZIP entry bounds');
    if ((flags & 0x0001) !== 0) throw new Error('Encrypted ZIP entries are not supported');
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name.includes('\u0000')) throw new Error('ZIP entry contains a NUL byte');
    // A malicious ZIP can claim a clean central filename while naming the
    // corresponding local record differently. Validate the local name too.
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== LOCAL) {
      throw new Error('Missing ZIP local file header');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    if (localOffset + 30 + localNameLength + localExtraLength > directoryOffset ||
        buffer.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) !== name) {
      throw new Error('ZIP local filename mismatch');
    }
    entries.push({ name, isSymlink: ((attrs >>> 16) & 0xf000) === 0xa000 });
    cursor = next;
  }
  if (cursor !== directoryOffset + directorySize) throw new Error('ZIP central-directory size mismatch');
  return entries;
}

export function releaseArchiveErrors(entries) {
  const names = entries.map((entry) => typeof entry === 'string' ? entry : entry.name);
  const errors = findForbiddenTrackedFiles(names);
  for (const entry of entries) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const normalized = name.replaceAll('\\', '/');
    const parts = normalized.split('/');
    if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || parts.includes('..')) {
      errors.push(`${name}: unsafe archive path`);
    }
    if (parts.some((part) => ['.git', 'node_modules', 'dist', 'coverage', '.vercel'].includes(part))) {
      errors.push(`${name}: generated or development-only directory`);
    }
    if (parts.at(-1)?.toLowerCase() === 'docker.env') {
      errors.push(`${name}: generated local environment secrets`);
    }
    if (typeof entry !== 'string' && entry.isSymlink) {
      errors.push(`${name}: symbolic links are not allowed in release archives`);
    }
  }
  return errors;
}

export function checkArchiveFile(filename) {
  const entries = zipEntries(readFileSync(filename));
  return { entries: entries.length, errors: releaseArchiveErrors(entries) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: node scripts/check-release-archive.mjs <file.zip>');
    process.exitCode = 2;
  } else {
    try {
      const { entries, errors } = checkArchiveFile(filename);
      if (errors.length) {
        console.error(`Release archive FAILED (${errors.length} findings among ${entries} entries):\n` +
          errors.map((entry) => `- ${entry}`).join('\n'));
        process.exitCode = 1;
      } else {
        console.log(`Release archive PASS (${entries} entries scanned)`);
      }
    } catch (error) {
      console.error(`Cannot validate ZIP: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
