import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPackage, relativePath } from '../src/package.js';

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'bug.js'), "throw new Error('KNOWN_FAILURE');\n");
  return { root, output: path.join(base, 'package'), files: ['bug.js'], command: ['node', 'bug.js'], signature: 'KNOWN_FAILURE' };
}

test('captures exact bytes and preserves original, with explicit unverified status', async t => {
  const options = await fixture(t);
  const original = await fs.readFile(path.join(options.root, 'bug.js'));
  const manifest = await createPackage(options);
  assert.equal(manifest.status, 'packaged');
  assert.equal(manifest.files[0].sha256, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(await fs.readFile(path.join(options.output, 'project', 'bug.js')), original);
  assert.deepEqual(await fs.readFile(path.join(options.root, 'bug.js')), original);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.output, 'repropack.json'))), manifest);
  assert.equal(JSON.stringify(manifest).includes(options.root), false);
});

for (const name of ['../a', '/a', 'C:/a', 'a\\b', 'a/../b', './a', 'a//b', 'CON.txt', 'name.', 'a:b']) {
  test(`rejects nonportable path ${name}`, () => assert.throws(() => relativePath(name)));
}

test('handles Unicode, spaces, nested cwd and lockfile digest', async t => {
  const options = await fixture(t);
  await fs.mkdir(path.join(options.root, 'örnek dosya'));
  await fs.writeFile(path.join(options.root, 'örnek dosya', 'package-lock.json'), '{}');
  const result = await createPackage({ ...options, files: ['örnek dosya/package-lock.json'], cwd: 'örnek dosya' });
  assert.equal(result.lockfiles[0].sha256, result.files[0].sha256);
});

for (const name of ['.env', '.env.local', '.npmrc', 'private.key', '.aws/credentials', 'system.log']) {
  test(`rejects sensitive path ${name} before copying`, async t => {
    const options = await fixture(t);
    await assert.rejects(createPackage({ ...options, files: [name] }), /Excluded/);
    await assert.rejects(fs.stat(options.output), { code: 'ENOENT' });
  });
}

test('rejects duplicates and case collisions', async t => {
  const options = await fixture(t);
  await assert.rejects(createPackage({ ...options, files: ['bug.js', 'BUG.js'] }), /colliding/);
});
test('rejects source output overlap and existing output without changing it', async t => {
  const options = await fixture(t);
  await assert.rejects(createPackage({ ...options, output: path.join(options.root, 'out') }), /separate/);
  await fs.mkdir(options.output);
  await fs.writeFile(path.join(options.output, 'keep'), 'original');
  await assert.rejects(createPackage(options), /already exists/);
  assert.equal(await fs.readFile(path.join(options.output, 'keep'), 'utf8'), 'original');
});
test('enforces file and total limits without partial output', async t => {
  const options = await fixture(t);
  await assert.rejects(createPackage({ ...options, maxFileBytes: 1 }), /limit/);
  await assert.rejects(createPackage({ ...options, maxTotalBytes: 1 }), /limit/);
  await assert.rejects(fs.stat(options.output), { code: 'ENOENT' });
});
test('rejects directory junctions even inside root', async t => {
  const options = await fixture(t);
  await fs.mkdir(path.join(options.root, 'actual'));
  await fs.writeFile(path.join(options.root, 'actual', 'file.js'), 'test');
  await fs.symlink(path.join(options.root, 'actual'), path.join(options.root, 'link'), 'junction');
  await assert.rejects(createPackage({ ...options, files: ['link/file.js'] }), /Links/);
});
test('rejects missing files and invalid execution recipes', async t => {
  const options = await fixture(t);
  await assert.rejects(createPackage({ ...options, files: ['missing.js'] }));
  for (const override of [{ command: 'node bug.js' }, { signature: '' }, { exitCode: 0 }, { timeoutMs: 0 }, { cwd: '../outside' }]) {
    await assert.rejects(createPackage({ ...options, ...override }));
  }
});

test('CLI packages a recipe without running its target command', async t => {
  const options = await fixture(t);
  const marker = path.join(path.dirname(options.root), 'must-not-exist');
  options.command = ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`];
  const recipe = path.join(path.dirname(options.root), 'recipe.json');
  await fs.writeFile(recipe, JSON.stringify(options));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'create', recipe], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'packaged');
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  const repeat = spawnSync(process.execPath, [cli, 'create', recipe], { encoding: 'utf8' });
  assert.equal(repeat.status, 2);
  assert.equal(repeat.stdout, '');
});
