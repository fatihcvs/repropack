import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { relativePath, regularFile, excluded } from './package.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Bounded reads also protect against growth after the initial stat.
async function readBounded(filename, limit) {
  const handle = await fs.open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Package size limit exceeded');
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    if (length !== stat.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error('Package changed during verification');
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

export function validateManifest(manifest) {
  if (!object(manifest) || manifest.schemaVersion !== 1 || manifest.status !== 'packaged') throw new Error('Unsupported package manifest');
  const recipe = manifest.recipe;
  if (!object(recipe) || !object(recipe.expected)) throw new Error('Missing execution recipe');
  if (!Array.isArray(recipe.command) || !recipe.command.length || !recipe.command[0] || recipe.command.some(x => typeof x !== 'string' || x.includes('\0'))) throw new Error('Invalid command argument array');
  if (recipe.setup !== undefined && (!Array.isArray(recipe.setup) || !recipe.setup.length || !recipe.setup[0] || recipe.setup.some(x => typeof x !== 'string' || x.includes('\0')))) throw new Error('Invalid setup argument array');
  if (recipe.cwd !== '.') relativePath(recipe.cwd);
  if (!Number.isInteger(recipe.timeoutMs) || recipe.timeoutMs < 1 || recipe.timeoutMs > 300000) throw new Error('Invalid timeout');
  const { exitCode, signature } = recipe.expected;
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255 || typeof signature !== 'string' || !signature.trim() || signature.length > 1000) throw new Error('Invalid expected failure');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 1000) throw new Error('Invalid file inventory');
  const seen = new Set();
  let total = 0;
  for (const file of manifest.files) {
    if (!object(file)) throw new Error('Invalid file entry');
    const parts = relativePath(file.path);
    const key = file.path.normalize('NFC').toLowerCase();
    if (seen.has(key) || excluded(parts)) throw new Error('Duplicate or excluded package path');
    seen.add(key);
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 5 * 1024 * 1024 || !digest(file.sha256)) throw new Error('Invalid file metadata');
    total += file.size;
  }
  if (total > 20 * 1024 * 1024) throw new Error('Package size limit exceeded');
  if (recipe.cwd !== '.' && !manifest.files.some(f => f.path.startsWith(recipe.cwd + '/'))) throw new Error('Working directory has no selected files');
  const locks = manifest.files.filter(f => /(^|\/)package-lock\.json$/.test(f.path)).map(f => ({ path: f.path, sha256: f.sha256 }));
  if (!Array.isArray(manifest.lockfiles) || JSON.stringify(manifest.lockfiles) !== JSON.stringify(locks)) throw new Error('Lockfile inventory mismatch');
  return manifest;
}

export async function verifyPackage(directory) {
  const root = await fs.realpath(directory);
  const manifestPath = await regularFile(root, ['repropack.json']);
  const manifest = validateManifest(JSON.parse((await readBounded(manifestPath, 1024 * 1024)).toString('utf8')));
  const project = path.join(root, 'project');
  const projectStat = await fs.lstat(project);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) throw new Error('Project must be a regular directory');
  const expectedFiles = new Set(manifest.files.map(f => f.path));
  const expectedDirectories = new Set();
  for (const name of expectedFiles) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) expectedDirectories.add(parts.slice(0, i).join('/'));
  }
  async function inspect(relative = '') {
    const handle = await fs.opendir(path.join(project, relative));
    for await (const entry of handle) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('Links are not supported');
      if (entry.isDirectory() && expectedDirectories.has(name)) await inspect(name);
      else if (!entry.isFile() || !expectedFiles.has(name)) throw new Error('Unlisted package content');
    }
  }
  await inspect();
  const files = [];
  for (const entry of manifest.files) {
    const filename = await regularFile(project, relativePath(entry.path));
    const bytes = await readBounded(filename, entry.size);
    if (bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('File content does not match manifest');
    files.push({ path: entry.path, bytes });
  }
  // The future runner consumes these verified bytes, never rereads mutable paths.
  return { manifest, files };
}
