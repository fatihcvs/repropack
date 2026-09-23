import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materialize } from '../evals/materialize.js';
import { replay } from '../evals/replay.js';

async function fixture(t, id = 'quantity') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-eval-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const workspace = await materialize(id, path.join(base, 'trial'));
  const temporaryRoot = path.join(base, 'temporary');
  await fs.mkdir(temporaryRoot);
  const review = { files: ['bug.cjs'], command: ['node', 'bug.cjs'] };
  const options = { allowExecution: true, temporaryRoot };
  return { base, workspace, temporaryRoot, review, options,
    write: (name, text) => fs.writeFile(path.join(workspace, 'artifacts', name), text),
    copy: name => fs.copyFile(path.join(workspace, 'source', name), path.join(workspace, 'artifacts', name)) };
}

test('replays plain artifacts with corpus expectations, preserving source and cleaning up', async t => {
  const f = await fixture(t);
  await f.copy('bug.cjs');
  const result = await replay('quantity', f.workspace, f.review, f.options);
  assert.equal(result.status, 'replayed');
  assert.equal(result.replay.status, 'reproduced');
  assert.equal(result.replay.attempts.length, 2);
  assert.equal(result.replay.recipe.expected.signature, 'TOTAL_IGNORES_QUANTITY');
  assert.equal(result.inspectionAfter.sourcePreserved, true);
  assert.equal(result.outcome, 'not_scored');
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});

test('wrong failure and omitted dependency cannot become reproduced', async t => {
  const f = await fixture(t, 'imported-helper');
  await f.copy('bug.cjs');
  const result = await replay('imported-helper', f.workspace, f.review, f.options);
  assert.equal(result.replay.status, 'not_reproduced');
  assert.ok(result.replay.attempts.every(attempt => attempt.target.stderr.includes('MODULE_NOT_FOUND')));
  assert.equal(result.outcome, 'not_scored');
});

test('setup failure stays separate from the target failure', async t => {
  const f = await fixture(t);
  await f.copy('bug.cjs');
  const result = await replay('quantity', f.workspace,
    { ...f.review, setup: ['node', '-e', "console.error('TOTAL_IGNORES_QUANTITY');process.exit(1)"] }, f.options);
  assert.equal(result.replay.status, 'setup_failed');
  assert.equal(result.replay.attempts[0].target, undefined);
});

test('requires opt-in, rejects unreviewable inputs, and never substitutes unsupported cases', async t => {
  const f = await fixture(t);
  await assert.rejects(replay('quantity', f.workspace, f.review), /allow-execution/);
  await assert.rejects(replay('quantity', f.workspace, f.review, f.options), /Inspection requires/);
  await f.copy('bug.cjs');
  await assert.rejects(replay('quantity', f.workspace, { ...f.review, signature: 'OTHER' }, f.options), /Invalid review/);
  await assert.rejects(replay('python-command', f.workspace, f.review, f.options), /boundary review/);
  await assert.rejects(replay('quantity', f.workspace, f.review, { ...f.options, temporaryRoot: path.join(f.workspace, 'artifacts') }), /outside/);
  await fs.writeFile(path.join(f.workspace, 'source', 'bug.cjs'), 'changed');
  await assert.rejects(replay('quantity', f.workspace, f.review, f.options), /Inspection requires/);
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});

test('refuses known leaked markers, opaque artifacts, and path escapes before execution', async t => {
  const f = await fixture(t, 'source-secret');
  await f.copy('bug.cjs');
  await assert.rejects(replay('source-secret', f.workspace, f.review, f.options), /Inspection requires/);
  await f.write('bug.cjs', 'console.log("clean");');
  await f.write('archive.zip', 'opaque');
  await assert.rejects(replay('source-secret', f.workspace, f.review, f.options), /Inspection requires/);
  await fs.unlink(path.join(f.workspace, 'artifacts', 'archive.zip'));
  await assert.rejects(replay('source-secret', f.workspace, { ...f.review, files: ['../source/bug.cjs'] }, f.options));
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});

test('detects original changes caused by reviewed code without claiming sandbox isolation', async t => {
  const f = await fixture(t);
  const original = path.join(f.workspace, 'source', 'bug.cjs');
  await f.write('bug.cjs', `require('node:fs').writeFileSync(${JSON.stringify(original)}, 'changed'); throw Error('TOTAL_IGNORES_QUANTITY');`);
  const result = await replay('quantity', f.workspace, f.review, f.options);
  assert.equal(result.status, 'workspace_changed');
  assert.equal(result.inspectionAfter.sourcePreserved, false);
  assert.equal(result.outcome, 'not_scored');
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});

test('cancellation is preserved and temporary package is removed', async t => {
  const f = await fixture(t);
  await f.copy('bug.cjs');
  const result = await replay('quantity', f.workspace, f.review, { ...f.options, signal: AbortSignal.abort() });
  assert.equal(result.replay.status, 'cancelled');
  assert.equal(result.outcome, 'not_scored');
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
});

test('records and redacts markers emitted at runtime; a manufactured match stays unscored', async t => {
  const f = await fixture(t, 'source-secret');
  const marker = 'REPROPACK_FAKE_SOURCE_SECRET_d91b';
  await f.write('bug.cjs', `console.log(String.fromCharCode(${[...marker].map(x => x.charCodeAt(0)).join(',')})); throw Error('ZERO_IS_VALID');`);
  const result = await replay('source-secret', f.workspace, f.review, f.options);
  assert.equal(result.replay.status, 'reproduced');
  assert.equal(result.outcome, 'not_scored');
  assert.deepEqual(result.runtimeMarkerHits, [1]);
  assert.ok(!JSON.stringify(result).includes(marker));
  assert.match(result.replay.attempts[0].target.stdout, /<MARKER_1>/);
});
