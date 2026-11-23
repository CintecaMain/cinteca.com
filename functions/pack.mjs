#!/usr/bin/env node
// Packs a platform function into the zip the MainServer panel uploads (Functions › <function> › Code): the files the
// function needs, no node_modules (the platform's build runs `npm ci` from package-lock.json and prunes development
// dependencies), no tests. The zip is deterministic (fixed file times, sorted entries, deflate), so the same sources
// give the same SHA-256, which is what the platform compares to decide a rebuild.
//
//   node functions/pack.mjs contact-form   -> functions/dist/contact-form.zip
//
// Node.js 22 or newer (zlib.crc32). Prints the zip's path, entry count, size and SHA-256.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));

// What each function's zip holds (paths relative to its folder; a folder takes everything under it).
export const CONTENTS = {
  'contact-form': ['index.mjs', 'package.json', 'package-lock.json'],
};

function listFiles(root, entry) {
  const path = join(root, entry);
  if (!statSync(path).isDirectory()) return [entry];
  return readdirSync(path)
    .sort()
    .flatMap((name) => listFiles(root, join(entry, name)));
}

// 1980-01-01 00:00 in DOS time/date (the earliest a zip can hold): the same bytes on every machine.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function pack(name, outDir = join(here, 'dist')) {
  const entries = CONTENTS[name];
  if (!entries) throw new Error(`unknown function "${name}" (known: ${Object.keys(CONTENTS).join(', ')})`);
  const root = join(here, name);
  const files = entries
    .flatMap((entry) => listFiles(root, entry))
    .map((path) => ({ name: relative(root, join(root, path)).split(sep).join('/'), data: readFileSync(join(root, path)) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const bytes = zip(files);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${name}.zip`);
  writeFileSync(out, bytes);
  return { out, entries: files.map((f) => f.name), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = process.argv.slice(2);
  if (!names.length) {
    console.error(`usage: node functions/pack.mjs <${Object.keys(CONTENTS).join('|')}> ...`);
    process.exit(2);
  }
  for (const name of names) {
    const result = pack(name);
    console.log(`${relative(process.cwd(), result.out)}  ${result.entries.length} files  ${result.size} bytes  sha256 ${result.sha256}`);
  }
}
