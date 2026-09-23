import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.includes('\0') || value.startsWith('/')) {
    throw new Error('Use a relative path with forward slashes');
  }
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /[<>"|?*\x00-\x1f]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) {
    throw new Error('Unsafe or non-portable path');
  }
  return parts;
}

export function excluded(parts) {
  return parts.some(p => /^(\.git|node_modules|\.ssh|\.aws|\.config|\.npmrc|\.netrc|credentials|\.env(?:\..*)?|id_rsa|id_ed25519)$/i.test(p) || /\.(pem|key|p12|pfx|log)$/i.test(p));
}

export async function regularFile(root, parts) {
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !inside(root, await fs.realpath(current))) throw new Error('Links and escaping paths are not supported');
    if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) throw new Error('Select regular files only');
  }
  return current;
}

export async function createPackage({ root, output, files, command, signature, exitCode = 1, cwd = '.', timeoutMs = 10000, maxFileBytes = 5 * 1024 * 1024, maxTotalBytes = 20 * 1024 * 1024 }) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 1000) throw new Error('Select between 1 and 1000 files');
  if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string' || x.includes('\0')) || !command[0]) throw new Error('command must be an argument array');
  if (typeof signature !== 'string' || !signature.trim() || signature.length > 1000) throw new Error('A nonempty failure signature of at most 1000 characters is required');
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) throw new Error('Expected exit code must be 1..255');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Timeout must be 1..300000 ms');
  for (const limit of [maxFileBytes, maxTotalBytes]) if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid size limit');
  if (maxFileBytes > 5 * 1024 * 1024 || maxTotalBytes > 20 * 1024 * 1024) throw new Error('Size limits may only be lowered');
  if (cwd !== '.') relativePath(cwd);
  root = await fs.realpath(root);
  const destination = path.resolve(output);
  const parent = await fs.realpath(path.dirname(destination));
  const resolvedDestination = path.join(parent, path.basename(destination));
  if (inside(root, resolvedDestination) || inside(resolvedDestination, root)) throw new Error('Output must be separate from the source tree');
  try { await fs.lstat(resolvedDestination); throw new Error('Output already exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const selected = [];
  const seen = new Set();
  let total = 0;
  for (const name of files) {
    const parts = relativePath(name);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate or case-colliding file');
    seen.add(key);
    if (excluded(parts)) throw new Error('Excluded sensitive or generated path');
    const source = await regularFile(root, parts);
    const handle = await fs.open(source, 'r');
    let data;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxFileBytes || total + before.size > maxTotalBytes) throw new Error('File or package size limit exceeded');
      // Read one extra byte to catch growth without unbounded allocation.
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      if (length !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Source changed during capture');
      data = buffer.subarray(0, length);
    } finally { await handle.close(); }
    total += data.length;
    selected.push({ path: name, size: data.length, sha256: hash(data), data });
  }
  if (cwd !== '.' && !selected.some(f => f.path.startsWith(cwd + '/'))) throw new Error('Working directory has no selected files');
  let commit = null;
  try { commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { /* A repository is optional. */ }
  const manifest = {
    schemaVersion: 1, status: 'packaged',
    source: { commit, note: 'Selected working-tree bytes; commit does not imply a clean tree.' },
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    recipe: { command, cwd, timeoutMs, expected: { exitCode, signature } },
    files: selected.map(({ data, ...entry }) => entry),
    lockfiles: selected.filter(f => /(^|\/)package-lock\.json$/.test(f.path)).map(f => ({ path: f.path, sha256: f.sha256 })),
  };
  // Reserve the destination exclusively. Never replace an existing directory.
  await fs.mkdir(resolvedDestination);
  try {
    for (const entry of selected) {
      const target = path.join(resolvedDestination, 'project', entry.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.data, { flag: 'wx' });
    }
    await fs.writeFile(path.join(resolvedDestination, 'repropack.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    // Only this call's freshly reserved output is removed on failure.
    await fs.rm(resolvedDestination, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}
