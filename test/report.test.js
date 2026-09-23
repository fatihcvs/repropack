import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../src/report.js';

const result = () => ({ schemaVersion: 1, status: 'setup_failed', recipe: { command: ['node', 'bug.js'], expected: { exitCode: 1, signature: 'FAIL' } }, attempts: [{ setup: { status: 'exited', exitCode: 2, stdout: '', stderr: 'setup error' } }] });

test('preserves phase evidence and does not imply the target ran', () => {
  const text = renderReport(result());
  assert.match(text, /setup_failed/);
  assert.match(text, /target: not run/);
  assert.match(text, /setup error/);
  assert.match(text, /not cross-machine/);
});
test('masks nested Windows paths and slash variants without modifying original evidence', () => {
  const value = result();
  value.recipe.command.push('C:\\Users\\Example\\project\\bug.js');
  value.attempts[0].setup.stderr = 'C:/Users/Example/project/bug.js';
  const before = JSON.stringify(value);
  const text = renderReport(value, { maskPaths: ['C:\\Users\\Example'] });
  assert.equal(text.includes('Example'), false);
  assert.match(text, /<LOCAL_PATH>/);
  assert.equal(JSON.stringify(value), before);
});
test('fences hostile Markdown output as literal evidence', () => {
  const value = result();
  value.attempts[0].setup.stderr = '```\n# not a report heading\n<script>test</script>';
  const text = renderReport(value);
  assert.match(text, /````\n```\n# not a report heading/);
});
test('rejects unsupported results and inconsistent reproduced claims', () => {
  assert.throws(() => renderReport({}));
  assert.throws(() => renderReport({ ...result(), status: 'reproduced' }), /does not match/);
  assert.throws(() => renderReport(result(), { maskPaths: [''] }));
});
test('actual CLI create, verify, run and report preserve evidence and mask output', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-report-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'bug.cjs'), "console.error('FAIL C:/Users/Example/project');process.exitCode=1;");
  const recipeFile = path.join(base, 'recipe.json');
  const output = path.join(base, 'package');
  await fs.writeFile(recipeFile, JSON.stringify({ root: source, output, files: ['bug.cjs'], command: ['node', 'bug.cjs'], signature: 'FAIL' }));
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
  for (const args of [['create', recipeFile], ['verify', output]]) {
    const call = invoke(args);
    assert.equal(call.status, 0, call.stderr);
  }
  assert.equal(invoke(['run', output]).status, 2);
  const run = invoke(['run', output, '--allow-execution']);
  assert.equal(run.status, 0, run.stderr);
  const evidence = JSON.parse(run.stdout);
  assert.equal(evidence.status, 'reproduced');
  assert.equal(evidence.environment.node, process.version);
  assert.equal(evidence.files[0].path, 'bug.cjs');
  const resultFile = path.join(base, 'result.json');
  await fs.writeFile(resultFile, run.stdout);
  const report = invoke(['report', resultFile, '--mask-path', 'C:\\Users\\Example']);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /Outcome: \*\*reproduced\*\*/);
  assert.equal(report.stdout.includes('Example'), false);
  assert.equal(await fs.readFile(resultFile, 'utf8'), run.stdout);
});
