import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { createPackage } from '../src/package.js';
import { reproduce } from '../src/runner.js';
import { renderReport } from '../src/report.js';

const ajv = new Ajv2020({ allErrors: true, strictTypes: false, strictTuples: false });
const validators = {};
for (const name of ['common', 'recipe', 'manifest', 'result']) {
  const schema = JSON.parse(await fs.readFile(new URL(`../schemas/${name}.schema.json`, import.meta.url)));
  assert.equal(ajv.validateSchema(schema), true);
  ajv.addSchema(schema);
  if (name !== 'common') validators[name] = ajv.getSchema(schema.$id);
}
function valid(kind, value) {
  assert.equal(validators[kind](value), true, JSON.stringify(validators[kind].errors));
}

async function capture(t, changes = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-schema-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'source');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'bug.cjs'), "console.error('SCHEMA_FAILURE');process.exitCode=1;");
  const input = { root, output: path.join(base, 'package'), files: ['bug.cjs'], command: ['node', 'bug.cjs'], signature: 'SCHEMA_FAILURE', ...changes };
  valid('recipe', input);
  const manifest = await createPackage(input);
  valid('manifest', manifest);
  return { input, manifest };
}

test('real capture, reproduction, cancellation and unsupported results match schemas', async t => {
  const { input } = await capture(t);
  const result = await reproduce(input.output, { allowExecution: true });
  assert.equal(result.status, 'reproduced');
  valid('result', result);
  assert.match(renderReport(result), /Outcome: \*\*reproduced\*\*/);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await reproduce(input.output, { allowExecution: true, signal: controller.signal });
  assert.equal(cancelled.status, 'cancelled');
  valid('result', cancelled);

  const { input: unsupportedInput } = await capture(t, { command: ['python', 'bug.py'] });
  const unsupported = await reproduce(unsupportedInput.output, { allowExecution: true });
  assert.equal(unsupported.status, 'unsupported');
  valid('result', unsupported);

  for (const mutate of [
    value => { value.attempts.pop(); },
    value => { value.attempts[0].matched = false; },
    value => { value.attempts[0].target.status = 'timed_out'; },
    value => { delete value.attempts[0].target; },
    value => { value.schemaVersion = 2; },
    value => { value.status = 'verified'; },
  ]) {
    const invalid = structuredClone(result);
    mutate(invalid);
    assert.equal(validators.result(invalid), false);
  }
  // Structural validation cannot compare an output substring to a dynamic
  // expected signature. The report's semantic check must still reject this.
  const falseClaim = structuredClone(result);
  falseClaim.attempts[0].target.stderr = '';
  valid('result', falseClaim);
  assert.throws(() => renderReport(falseClaim), /does not match/);
});

test('real failed setup is represented without a target phase', async t => {
  const { input } = await capture(t, { setup: ['node', '-e', 'process.exitCode=2'] });
  const result = await reproduce(input.output, { allowExecution: true });
  assert.equal(result.status, 'setup_failed');
  assert.equal(result.attempts[0].target, undefined);
  valid('result', result);
});

test('recipe and manifest schemas reject malformed contracts', async t => {
  const { input, manifest } = await capture(t);
  for (const changes of [
    { command: [] }, { command: ['', 'bug.cjs'] }, { command: ['node', '\0'] },
    { timeoutMs: 0 }, { exitCode: 0 }, { signature: '  ' }, { files: [] },
    { maxFileBytes: 5242881 }, { maxTotalBytes: 20971521 },
  ]) assert.equal(validators.recipe({ ...input, ...changes }), false);
  for (const mutate of [
    value => { delete value.recipe.expected; },
    value => { value.files[0].sha256 = 'invalid'; },
    value => { value.files[0].size = -1; },
    value => { value.status = 'reproduced'; },
    value => { delete value.environment; },
  ]) {
    const invalid = structuredClone(manifest);
    mutate(invalid);
    assert.equal(validators.manifest(invalid), false);
  }
});
