import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPackage } from '../src/package.js';
import { reproduce } from '../src/runner.js';

async function fixture(t, code, overrides = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-run-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source');
  const output = path.join(base, 'package');
  const temporaryRoot = path.join(base, 'runs');
  await fs.mkdir(root);
  await fs.mkdir(temporaryRoot);
  await fs.writeFile(path.join(root, 'bug.cjs'), code);
  await createPackage({ root, output, files: ['bug.cjs'], command: ['node', 'bug.cjs'], signature: 'KNOWN_FAILURE', ...overrides });
  return { output, root, temporaryRoot, options: { allowExecution: true, temporaryRoot } };
}

test('reproduces in two independent clean directories and preserves source', async t => {
  const code = "const fs = require('fs'); if (fs.existsSync('marker')) process.exit(2); fs.writeFileSync('marker', 'x'); console.error('KNOWN_FAILURE'); process.exitCode=1;";
  const f = await fixture(t, code);
  const result = await reproduce(f.output, f.options);
  assert.equal(result.status, 'reproduced');
  assert.equal(result.attempts.length, 2);
  assert.equal(await fs.readFile(path.join(f.root, 'bug.cjs'), 'utf8'), code);
  assert.deepEqual(await fs.readdir(f.root), ['bug.cjs']);
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});
for (const [name, code] of [
  ['wrong signature', "console.error('OTHER_FAILURE'); process.exitCode=1"],
  ['wrong code', "console.error('KNOWN_FAILURE'); process.exitCode=2"],
  ['success', "console.log('KNOWN_FAILURE')"],
]) test(`does not reproduce ${name}`, async t => {
  const f = await fixture(t, code);
  assert.equal((await reproduce(f.output, f.options)).status, 'not_reproduced');
});

test('setup failure cannot be mistaken for target reproduction', async t => {
  const f = await fixture(t, "throw new Error('target must not run')", { setup: ['node', '-e', "console.error('KNOWN_FAILURE'); process.exitCode=1"] });
  const result = await reproduce(f.output, f.options);
  assert.equal(result.status, 'setup_failed');
  assert.equal(result.attempts[0].target, undefined);
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});
test('timeout is distinct from a signature match', async t => {
  const f = await fixture(t, "console.error('KNOWN_FAILURE'); setInterval(()=>{},100)", { timeoutMs: 1000 });
  assert.equal((await reproduce(f.output, f.options)).status, 'timed_out');
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});
test('output is bounded and overflowing processes are stopped', async t => {
  const f = await fixture(t, "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},100)");
  const result = await reproduce(f.output, f.options);
  assert.equal(result.status, 'output_limit');
  assert.ok(Buffer.byteLength(result.attempts[0].target.stdout) <= 1024 * 1024);
});
test('requires execution opt-in and rejects unsupported commands', async t => {
  const f = await fixture(t, '', { command: ['unknown-shell', '-c', 'anything'] });
  await assert.rejects(reproduce(f.output), /allow-execution/);
  assert.equal((await reproduce(f.output, f.options)).status, 'unsupported');
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});
test('cancellation cleans up the running attempt', async t => {
  const f = await fixture(t, 'setInterval(()=>{},100)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  t.after(() => clearTimeout(timer));
  const result = await reproduce(f.output, { ...f.options, signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});
test('does not pass arbitrary parent environment variables to the target', async t => {
  process.env.REPROPACK_TEST_PRIVATE = 'synthetic-secret';
  t.after(() => delete process.env.REPROPACK_TEST_PRIVATE);
  const f = await fixture(t, "if(!process.env.REPROPACK_TEST_PRIVATE){console.error('KNOWN_FAILURE');process.exitCode=1}");
  assert.equal((await reproduce(f.output, f.options)).status, 'reproduced');
});
test('executes npm argument arrays without a shell wrapper', async t => {
  const f = await fixture(t, '', { command: ['npm', '--version'] });
  const result = await reproduce(f.output, f.options);
  assert.equal(result.status, 'not_reproduced');
  assert.equal(result.attempts[0].target.exitCode, 0);
  assert.match(result.attempts[0].target.stdout, /^\d+\.\d+\.\d+/);
});

test('installs a dependency-free locked npm package and reproduces npm test', async t => {
  const f = await fixture(t, "console.error('KNOWN_FAILURE');process.exitCode=1");
  await fs.writeFile(path.join(f.root, 'package.json'), JSON.stringify({ name: 'synthetic-repro', version: '1.0.0', scripts: { test: 'node bug.cjs' } }));
  await fs.writeFile(path.join(f.root, 'package-lock.json'), JSON.stringify({ name: 'synthetic-repro', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'synthetic-repro', version: '1.0.0' } } }));
  const output = path.join(path.dirname(f.output), 'npm-package');
  await createPackage({ root: f.root, output, files: ['bug.cjs', 'package.json', 'package-lock.json'],
    setup: ['npm', 'ci', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], command: ['npm', 'test'], signature: 'KNOWN_FAILURE' });
  const result = await reproduce(output, f.options);
  assert.equal(result.status, 'reproduced');
  assert.ok(result.attempts.every(a => a.setup.exitCode === 0 && a.target.exitCode === 1));
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});

test('timeout terminates an attached child process', async t => {
  const f = await fixture(t, "const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'inherit'});console.log(child.pid);setInterval(()=>{},100)", { timeoutMs: 1500 });
  const result = await reproduce(f.output, f.options);
  assert.equal(result.status, 'timed_out');
  const pid = Number(result.attempts[0].target.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('mixed outcomes are intermittent rather than reproduced', async t => {
  const f = await fixture(t, '');
  const counter = path.join(path.dirname(f.output), 'synthetic-counter');
  const code = `const fs=require('fs');const p=${JSON.stringify(counter)};if(!fs.existsSync(p)){fs.writeFileSync(p,'1');console.error('KNOWN_FAILURE');process.exitCode=1}`;
  await fs.writeFile(path.join(f.root, 'bug.cjs'), code);
  const output = path.join(path.dirname(f.output), 'intermittent-package');
  await createPackage({ root: f.root, output, files: ['bug.cjs'], command: ['node', 'bug.cjs'], signature: 'KNOWN_FAILURE' });
  assert.equal((await reproduce(output, f.options)).status, 'intermittent');
});

test('Windows runner cleans detached children after each successful target exit', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t, "const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'});console.log(p.pid);p.unref();console.error('KNOWN_FAILURE');process.exitCode=1;");
  const result = await reproduce(f.output, f.options);
  assert.equal(result.status, 'reproduced');
  for (const attempt of result.attempts) {
    const pid = Number(attempt.target.stdout.trim());
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});

test('target exit 125 is not confused with a supervisor launch failure', async t => {
  const f = await fixture(t, "console.error('KNOWN_FAILURE');process.exitCode=125", { exitCode: 125 });
  assert.equal((await reproduce(f.output, f.options)).status, 'reproduced');
});
