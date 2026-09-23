import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { cases } from '../evals/cases.js';
import { materialize } from '../evals/materialize.js';
import { createPackage } from '../src/package.js';
import { reproduce } from '../src/runner.js';

test('all evaluation workspaces are distinct, preserve source and omit evaluator metadata', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-corpus-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  assert.equal(new Set(cases.map(c => c.id)).size, 12);
  assert.deepEqual(cases.reduce((n, c) => ({ ...n, [c.category]: (n[c.category] || 0) + 1 }), {}),
    { deterministic: 4, setup: 2, intermittent: 2, secret: 2, unsupported: 2 });
  for (const item of cases) {
    const root = await materialize(item.id, path.join(base, item.id));
    for (const [file, bytes] of Object.entries(item.files)) {
      assert.equal(await fs.readFile(path.join(root, 'source', file), 'utf8'), bytes);
    }
    assert.deepEqual(await fs.readdir(path.join(root, 'artifacts')), []);
    assert.deepEqual((await fs.readdir(root)).sort(), ['artifacts', 'source', 'task.md']);
    await assert.rejects(materialize(item.id, root), { code: 'EEXIST' });
  }
  await assert.rejects(materialize('unknown', path.join(base, 'unknown')), /Unknown/);
  await assert.rejects(fs.stat(path.join(base, 'unknown')), { code: 'ENOENT' });
});

test('deterministic and secret fixtures exhibit the original failure without network or dependencies', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-corpus-run-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  for (const item of cases.filter(c => ['deterministic', 'secret'].includes(c.category))) {
    const root = await materialize(item.id, path.join(base, item.id));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = spawnSync(process.execPath, item.command.slice(1), {
        cwd: path.join(root, 'source'), encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, item.exitCode, item.id);
      assert.ok(result.stderr.includes(item.signature), item.id);
    }
  }
});

test('absent service environment does not accidentally emit the claimed target signature', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-corpus-env-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const item = cases.find(c => c.id === 'external-service');
  const root = await materialize(item.id, path.join(base, 'case'));
  const env = { ...process.env };
  delete env.SYNTHETIC_SERVICE_TOKEN;
  const result = spawnSync(process.execPath, item.command.slice(1), {
    cwd: path.join(root, 'source'), encoding: 'utf8', timeout: 10000, env,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('SERVICE_ACCESS_MISSING'));
  assert.ok(!result.stderr.includes(item.signature));
});

test('setup and unsupported boundaries survive the real package runner', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-corpus-boundary-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  for (const id of ['missing-lock', 'python-command']) {
    const item = cases.find(c => c.id === id);
    const root = await materialize(id, path.join(base, id));
    const output = path.join(root, 'artifacts', 'package');
    await createPackage({ root: path.join(root, 'source'), output, files: Object.keys(item.files),
      command: item.command, setup: item.setup, signature: item.signature, exitCode: item.exitCode });
    const result = await reproduce(output, { allowExecution: true });
    assert.equal(result.status, item.expectedBoundary, JSON.stringify(result));
    assert.ok(result.attempts.every(attempt => !attempt.target));
    if (id === 'missing-lock') {
      assert.equal(result.attempts[0].setup.status, 'exited');
      assert.ok(result.attempts[0].setup.stderr.includes('package-lock.json'));
    }
  }
});

test('intermittent fixture trials have only the stated possible outcomes', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-corpus-flaky-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  for (const item of cases.filter(c => c.category === 'intermittent')) {
    const root = await materialize(item.id, path.join(base, item.id));
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = spawnSync(process.execPath, item.command.slice(1), {
        cwd: path.join(root, 'source'), encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(result.error);
      assert.ok([0, 1].includes(result.status), item.id);
      assert.equal(result.stderr.includes(item.signature), result.status === 1);
    }
  }
  // No distribution assertion: a short random sample may legitimately be uniform.
});
