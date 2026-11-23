#!/usr/bin/env node
// Prepares the contact endpoint switch of a static site that is already live in S3 (cinteca.es, adrianocaldas.com),
// without a rebuild: from a copy of the bucket it writes the few files to upload so that the live pages call the new
// endpoint, with nothing else changed.
//
// Why not a rebuild: a new `next build` differs from the live one in far more than the endpoint (a new random build id
// in every page, next/font downloads newer font files, so new CSS and chunk names; a Windows build also writes some RSC
// files at other paths; and the build needs NEXT_PUBLIC_TURNSTILE_SITE_KEY), so it cannot be checked against what is
// live. Why not an in-place edit of the chunk: hashed chunks are served with "immutable" and a one-year max-age, so a
// browser that has the old chunk would keep calling the old endpoint. So the chunk that holds the endpoint gets a NEW
// name, and only the pages that name it (HTML, RSC .txt; served without Cache-Control) are rewritten to the new name.
//
//   aws s3 sync s3://<bucket> <copy> --profile <p>      (read-only download)
//   node scripts/switch-contact-endpoint.mjs --live <copy> --old <old endpoint> --new <new endpoint> --out <dir>
//
// It writes <dir>/upload/ (the new chunk(s) and the rewritten pages, at their bucket paths), <dir>/original/ (the
// bucket's current version of every rewritten page, for a rollback) and <dir>/manifest.json, and exits 0 only when
// every check holds:
//   - the old endpoint is in at least one chunk that the current pages use, the new one is in none;
//   - each new chunk equals its old chunk with only the endpoint replaced, and its name is new to the bucket;
//   - each rewritten page equals its old version with only the chunk names replaced;
//   - only .js chunks hold the endpoint (never a page) and no chunk names a renamed chunk (no cascade to handle).
// The old chunks stay in the bucket (a page cached before the switch still finds them).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const CHUNK_DIR = "_next/static/chunks/";

export function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

const isPage = (file) => file.endsWith(".html") || file.endsWith(".txt");
const isChunk = (file) => file.startsWith(CHUNK_DIR) && file.endsWith(".js");
const count = (text, needle) => (needle ? text.split(needle).length - 1 : 0);
const md5 = (data) => crypto.createHash("md5").update(data).digest("hex");

/** The new name of a chunk: its old name plus 10 hex characters of the new content's SHA-256. */
export function renamedChunk(file, content) {
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
  return file.replace(/\.js$/, `-${hash}.js`);
}

/**
 * The plan, from a reader of the bucket copy (relative path -> Buffer). Returns { ok, errors, chunks, pages, stale }:
 * chunks [{ from, to, occurrences, content }], pages [{ path, original, content, renamed }], stale = chunks outside
 * the current pages that still hold the old endpoint (older builds; left as they are).
 */
export function planSwitch({ files, read, oldEndpoint, newEndpoint }) {
  const errors = [];
  if (!oldEndpoint || !newEndpoint || oldEndpoint === newEndpoint) errors.push("--old and --new must differ");
  if (newEndpoint.includes(oldEndpoint) || oldEndpoint.includes(newEndpoint)) {
    errors.push("one endpoint must not contain the other");
  }
  const fileSet = new Set(files);
  const text = new Map();
  const textOf = (file) => {
    if (!text.has(file)) text.set(file, read(file).toString("utf8"));
    return text.get(file);
  };

  // The current pages are every HTML and RSC .txt file (old builds leave only their _next/static files behind); the
  // chunks they use are those whose name they contain, and the chunks those chunks name, and so on.
  const pages = files.filter(isPage);
  const chunks = files.filter(isChunk);
  const used = new Set();
  let frontier = pages;
  while (frontier.length) {
    const next = [];
    for (const file of frontier) {
      const body = textOf(file);
      for (const chunk of chunks) {
        if (!used.has(chunk) && body.includes(path.posix.basename(chunk))) {
          used.add(chunk);
          next.push(chunk);
        }
      }
    }
    frontier = next;
  }

  for (const file of pages) {
    if (count(textOf(file), oldEndpoint)) errors.push(`a page holds the old endpoint: ${file} (not handled: stop)`);
  }
  for (const file of [...pages, ...chunks]) {
    if (count(textOf(file), newEndpoint)) errors.push(`the new endpoint is already in ${file}`);
  }
  const holding = [...used].filter((chunk) => count(textOf(chunk), oldEndpoint) > 0).sort();
  const stale = chunks.filter((chunk) => !used.has(chunk) && count(textOf(chunk), oldEndpoint) > 0);
  if (!holding.length) errors.push("no chunk of the current pages holds the old endpoint");

  const renamed = holding.map((from) => {
    const original = textOf(from);
    const content = original.split(oldEndpoint).join(newEndpoint);
    const to = renamedChunk(from, content);
    if (fileSet.has(to)) errors.push(`the new chunk name is already in the bucket: ${to}`);
    if (content.split(newEndpoint).join(oldEndpoint) !== original) errors.push(`${from}: the replacement is not reversible`);
    return { from, to, occurrences: count(original, oldEndpoint), content };
  });

  // A chunk that names a renamed chunk would have to be renamed too (and so on): not handled.
  for (const { from } of renamed) {
    for (const chunk of used) {
      if (chunk !== from && textOf(chunk).includes(path.posix.basename(from))) {
        errors.push(`${chunk} names ${from}: renames would cascade (stop)`);
      }
    }
  }

  const rewritten = [];
  for (const file of pages) {
    const original = textOf(file);
    let content = original;
    const names = [];
    for (const { from, to } of renamed) {
      const before = path.posix.basename(from);
      if (content.includes(before)) {
        content = content.split(before).join(path.posix.basename(to));
        names.push(before);
      }
    }
    if (!names.length) continue;
    let back = content;
    for (const { from, to } of renamed) back = back.split(path.posix.basename(to)).join(path.posix.basename(from));
    if (back !== original) errors.push(`${file}: the rename is not reversible`);
    rewritten.push({ path: file, original, content, renamed: names });
  }
  if (renamed.length && !rewritten.some((page) => page.path.endsWith(".html"))) {
    errors.push("no HTML page names the chunk that holds the endpoint");
  }

  return { ok: errors.length === 0, errors, chunks: renamed, pages: rewritten, stale };
}

function argument(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] ?? "" : undefined;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function main(argv) {
  const live = argument(argv, "--live");
  const oldEndpoint = argument(argv, "--old") ?? "";
  const newEndpoint = argument(argv, "--new") ?? "";
  const out = argument(argv, "--out");
  if (!live || !out || !oldEndpoint || !newEndpoint) {
    console.error("usage: node scripts/switch-contact-endpoint.mjs --live <bucket copy> --old <url> --new <url> --out <dir>");
    return 2;
  }
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    console.error(`${out} is not empty`);
    return 2;
  }
  const plan = planSwitch({
    files: listFiles(live),
    read: (file) => fs.readFileSync(path.join(live, file)),
    oldEndpoint,
    newEndpoint,
  });
  for (const error of plan.errors) console.log(`STOP: ${error}`);
  if (!plan.ok) return 1;

  const manifest = { oldEndpoint, newEndpoint, chunks: [], pages: [], stale: plan.stale };
  for (const chunk of plan.chunks) {
    write(path.join(out, "upload", chunk.to), chunk.content);
    manifest.chunks.push({ from: chunk.from, to: chunk.to, occurrences: chunk.occurrences, md5: md5(chunk.content) });
    console.log(`new chunk: ${chunk.to} (= ${path.posix.basename(chunk.from)} with the endpoint replaced ${chunk.occurrences}x)`);
  }
  for (const page of plan.pages) {
    write(path.join(out, "upload", page.path), page.content);
    write(path.join(out, "original", page.path), page.original);
    manifest.pages.push({ path: page.path, md5Before: md5(page.original), md5After: md5(page.content), renamed: page.renamed });
    console.log(`page: ${page.path} (chunk name only)`);
  }
  write(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (plan.stale.length) console.log(`left as they are: ${plan.stale.length} chunk(s) of older builds that hold the old endpoint`);
  console.log(`OK: ${plan.chunks.length} new chunk(s) and ${plan.pages.length} page(s) in ${path.join(out, "upload")}`);
  return 0;
}

// Run as a command (not when a test imports it).
if (path.basename(process.argv[1] ?? "") === "switch-contact-endpoint.mjs") {
  process.exitCode = main(process.argv.slice(2));
}
