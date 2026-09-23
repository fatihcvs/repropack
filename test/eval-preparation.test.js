import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { schedule, prepare } from '../evals/prepare.js';

test('seeded order covers every case/arm/repetition exactly once', () => {
  const first = schedule('pilot-a');
  assert.equal(first.length, 108);
  assert.equal(new Set(first.map(item => item.key)).size, 108);
  assert.deepEqual(schedule('pilot-a'), first);
  assert.notDeepEqual(schedule('pilot-b'), first);
  for (const arm of ['none', 'comparator', 'repropack']) {
    assert.equal(first.filter(item => item.arm === arm).length, 36);
  }
  assert.throws(() => schedule(' '));
});

test('pinned comparator retains upstream blob bytes and license', async () => {
  const base = new URL('../evals/vendor/bug-reproduction-brief/', import.meta.url);
  const provenance = JSON.parse(await fs.readFile(new URL('provenance.json', base), 'utf8'));
  assert.match(provenance.commit, /^[a-f0-9]{40}$/);
  assert.equal(provenance.license, 'MIT');
  for (const entry of provenance.files) {
    const bytes = await fs.readFile(new URL(entry.path, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.gitBlob);
  }
});

test('preparation creates separate source trees and exact skills without running trials', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-eval-plan-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'comparison');
  const options = { seed: 'offline-preparation', cliPath: fileURLToPath(new URL('../src/cli.js', import.meta.url)) };
  const plan = await prepare(root, options);
  assert.equal(plan.status, 'prepared_not_executed');
  assert.equal(plan.model, null);
  assert.equal(plan.budget, null);
  const prompts = new Map();
  for (const trial of plan.trials) {
    assert.equal(trial.status, 'not_run');
    const workspace = path.join(root, trial.directory);
    assert.deepEqual(await fs.readdir(path.join(workspace, 'artifacts')), []);
    const prompt = await fs.readFile(path.join(workspace, 'task.md'), 'utf8');
    if (prompts.has(trial.caseId)) assert.equal(prompt, prompts.get(trial.caseId));
    prompts.set(trial.caseId, prompt);
    for (const file of trial.source) {
      const bytes = await fs.readFile(path.join(workspace, 'source', file.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    }
    const skills = path.join(workspace, '.claude', 'skills');
    if (trial.arm === 'none') await assert.rejects(fs.access(skills));
    else {
      const expected = trial.arm === 'comparator' ? 'bug-reproduction-brief' : 'reproduce-bug';
      assert.deepEqual(await fs.readdir(skills), [expected]);
      assert.match(await fs.readFile(path.join(skills, expected, 'SKILL.md'), 'utf8'), /^---/);
      const files = trial.arm === 'comparator' ? plan.comparator.files : plan.candidate.files;
      for (const file of files) {
        const bytes = await fs.readFile(path.join(skills, expected, file.path));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      }
    }
    assert.equal((await fs.readdir(workspace)).includes('cases.js'), false);
  }
  const first = plan.trials[0];
  await fs.writeFile(path.join(root, first.directory, 'artifacts', 'keep.txt'), 'existing evidence');
  await assert.rejects(prepare(root, options), /EEXIST/);
  assert.equal(await fs.readFile(path.join(root, first.directory, 'artifacts', 'keep.txt'), 'utf8'), 'existing evidence');
});
