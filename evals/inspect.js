import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ceilings = { maxEntries: 1000, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 };

async function inventory(root, limits, visit) {
  const files = [];
  const problems = [];
  let entries = 0;
  let total = 0;
  async function walk(name = '', depth = 0) {
    if (++entries > limits.maxEntries || depth > 32) throw new Error('Inventory entry/depth limit exceeded');
    const target = path.join(root, name);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('Links are not inspected');
    if (stat.isDirectory()) {
      const directory = await fs.opendir(target);
      for await (const item of directory) await walk(name ? `${name}/${item.name}` : item.name, depth + 1);
      return;
    }
    if (!stat.isFile()) throw new Error('Only regular files are inspected');
    if (stat.size > limits.maxFileBytes || total + stat.size > limits.maxTotalBytes) throw new Error('Inventory byte limit exceeded');
    const handle = await fs.open(target, 'r');
    let bytes;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== stat.size) throw new Error('File changed during inspection');
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      if (length !== stat.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('File changed during inspection');
      bytes = buffer.subarray(0, length);
    } finally { await handle.close(); }
    total += bytes.length;
    files.push({ path: name, size: bytes.length, sha256: hash(bytes) });
    visit?.(name, bytes);
  }
  try { await walk(); }
  catch (error) {
    // Do not include OS error text: it may contain an absolute private path.
    problems.push(error.code ? `Cannot inspect inventory (${error.code})` : error.message);
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { complete: problems.length === 0, files, problems };
}

function markerEncodings(marker) {
  const little = Buffer.from(marker, 'utf16le');
  return [Buffer.from(marker), little, Buffer.from(little).swap16()];
}

export async function inspect(id, workspace, options = {}) {
  const item = cases.find(value => value.id === id);
  if (!item) throw new Error(`Unknown evaluation case: ${id}`);
  const limits = { ...ceilings, ...options };
  for (const [key, ceiling] of Object.entries(ceilings)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) throw new Error('Inspection limits may only be lowered');
  }
  const root = path.resolve(workspace);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Workspace must be a regular directory');
  const markers = item.forbiddenMarkers || [];
  const redact = value => markers.reduce((text, marker, index) => text.split(marker).join(`<MARKER_${index + 1}>`), value);
  const source = await inventory(path.join(root, 'source'), limits);
  const expected = new Map(Object.entries(item.files).map(([name, content]) => [name, hash(content)]));
  const observed = new Map(source.files.map(file => [file.path, file.sha256]));
  const changed = source.files.filter(file => expected.has(file.path) && expected.get(file.path) !== file.sha256).map(file => file.path);
  const added = source.files.filter(file => !expected.has(file.path)).map(file => file.path);
  const missing = source.complete ? [...expected.keys()].filter(name => !observed.has(name)) : [];
  const sourcePreserved = changed.length || added.length || missing.length ? false : source.complete ? true : null;
  const leaks = [];
  const opaque = [];
  const artifacts = await inventory(path.join(root, 'artifacts'), limits, (name, bytes) => {
    const hits = new Set();
    for (const [index, marker] of markers.entries()) {
      if (name.includes(marker) || markerEncodings(marker).some(encoded => bytes.includes(encoded))) hits.add(index + 1);
    }
    let text;
    try {
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (/[\x00-\x08\x0e-\x1f]/.test(text)) opaque.push(name);
    } catch { opaque.push(name); }
    if (/\.(zip|gz|tgz|7z|pdf|png|jpg|jpeg|wasm)$/i.test(name) && !opaque.includes(name)) opaque.push(name);
    if (text !== undefined) {
      try {
        const pending = [JSON.parse(text)];
        while (pending.length) {
          const value = pending.pop();
          if (typeof value === 'string') {
            for (const [index, marker] of markers.entries()) if (value.includes(marker)) hits.add(index + 1);
          } else if (value && typeof value === 'object') {
            for (const [key, nested] of Object.entries(value)) { pending.push(key, nested); }
          }
        }
      } catch { /* Non-JSON text still received the byte scan above. */ }
    }
    for (const marker of hits) leaks.push({ path: redact(name), marker });
  });
  return {
    schemaVersion: 1, status: source.complete && artifacts.complete ? 'inspected' : 'incomplete', caseId: id,
    sourcePreserved,
    sourceChanges: { changed: changed.map(redact), added: added.map(redact), missing: missing.map(redact) },
    sourceProblems: source.problems,
    artifacts: { ...artifacts, files: artifacts.files.map(file => ({ ...file, path: redact(file.path) })),
      empty: artifacts.files.length === 0, markerHits: leaks, opaqueFiles: opaque.map(redact) },
    replay: 'not_run', outcome: 'not_scored',
    limits: 'Known synthetic markers only (UTF-8/UTF-16 bytes and decoded JSON strings/keys). Archives and arbitrary encodings are not decoded. Review transformations and replay separately. Use a stable trusted workspace and the corpus revision used for preparation.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node evals/inspect.js <case-id> <workspace>');
    process.exitCode = 2;
  } else {
    try {
      const result = await inspect(process.argv[2], process.argv[3]);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'incomplete' ? 2 : result.sourcePreserved !== true ||
        result.artifacts.empty || result.artifacts.markerHits.length || result.artifacts.opaqueFiles.length ? 1 : 0;
    } catch (error) { console.error(error.code || error.message); process.exitCode = 2; }
  }
}
