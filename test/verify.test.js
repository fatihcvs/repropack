import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackage } from '../src/package.js';
import { verifyPackage } from '../src/verify.js';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-verify-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source');
  const output = path.join(base, 'package');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'bug.js'), 'original');
  await createPackage({ root, output, files: ['bug.js'], command: ['node', 'bug.js'], signature: 'failure' });
  return output;
}

test('retains verified bytes independently of subsequent package changes', async t => {
  const directory = await fixture(t);
  const result = await verifyPackage(directory);
  await fs.writeFile(path.join(directory, 'project', 'bug.js'), 'modified');
  assert.equal(result.files[0].bytes.toString(), 'original');
  await assert.rejects(verifyPackage(directory), /does not match/);
});

for (const [name, mutate] of [
  ['schema', m => m.schemaVersion = 2],
  ['traversal', m => m.files[0].path = '../escape'],
  ['command', m => m.recipe.command = 'node bug.js'],
  ['timeout', m => m.recipe.timeoutMs = 0],
  ['signature', m => m.recipe.expected.signature = ''],
  ['success exit', m => m.recipe.expected.exitCode = 0],
  ['size', m => m.files[0].size = -1],
  ['hash', m => m.files[0].sha256 = 'invalid'],
  ['duplicate', m => m.files.push(m.files[0])],
  ['lockfile', m => m.lockfiles.push({ path: 'package-lock.json', sha256: 'a'.repeat(64) })],
  ['working directory', m => m.recipe.cwd = 'missing'],
]) {
  test(`rejects invalid manifest ${name}`, async t => {
    const directory = await fixture(t);
    const filename = path.join(directory, 'repropack.json');
    const manifest = JSON.parse(await fs.readFile(filename));
    mutate(manifest);
    await fs.writeFile(filename, JSON.stringify(manifest));
    await assert.rejects(verifyPackage(directory));
  });
}

test('rejects files absent from manifest', async t => {
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, 'project', 'extra.js'), 'extra');
  await assert.rejects(verifyPackage(directory), /Unlisted/);
});
test('rejects project junction replacement', async t => {
  const directory = await fixture(t);
  const project = path.join(directory, 'project');
  const relocated = path.join(directory, 'relocated');
  await fs.rename(project, relocated);
  await fs.symlink(relocated, project, 'junction');
  await assert.rejects(verifyPackage(directory), /regular directory/);
});
test('rejects truncated and oversized files', async t => {
  const directory = await fixture(t);
  const filename = path.join(directory, 'project', 'bug.js');
  await fs.writeFile(filename, 'short');
  await assert.rejects(verifyPackage(directory), /does not match/);
  await fs.writeFile(filename, 'longer than the original');
  await assert.rejects(verifyPackage(directory), /size limit/);
});
