import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cases } from '../evals/cases.js';
import { materialize } from '../evals/materialize.js';
import { inspect } from '../evals/inspect.js';

async function fixture(t, id = 'source-secret') {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-inspect-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return materialize(id, path.join(parent, 'trial'));
}

test('untouched trial is source-preserved but empty and never scored', async t => {
  const root = await fixture(t);
  const report = await inspect('source-secret', root);
  assert.equal(report.sourcePreserved, true);
  assert.equal(report.artifacts.empty, true);
  assert.deepEqual(report.artifacts.markerHits, []);
  assert.equal(report.replay, 'not_run');
  assert.equal(report.outcome, 'not_scored');
});

test('reports changed, missing and added originals without changing them', async t => {
  const root = await fixture(t, 'imported-helper');
  await fs.writeFile(path.join(root, 'source', 'bug.cjs'), 'changed');
  await fs.unlink(path.join(root, 'source', 'unused.txt'));
  await fs.writeFile(path.join(root, 'source', 'extra.txt'), 'added');
  const report = await inspect('imported-helper', root);
  assert.equal(report.sourcePreserved, false);
  assert.deepEqual(report.sourceChanges, { changed: ['bug.cjs'], missing: ['unused.txt'], added: ['extra.txt'] });
  assert.equal(await fs.readFile(path.join(root, 'source', 'bug.cjs'), 'utf8'), 'changed');
});

test('finds raw, UTF16, JSON-escaped and filename markers without echoing markers', async t => {
  const root = await fixture(t);
  const marker = cases.find(item => item.id === 'source-secret').forbiddenMarkers[0];
  const artifacts = path.join(root, 'artifacts');
  await fs.writeFile(path.join(artifacts, 'plain.txt'), marker);
  await fs.writeFile(path.join(artifacts, 'utf16.txt'), Buffer.from(marker, 'utf16le'));
  const escaped = [...marker].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  await fs.writeFile(path.join(artifacts, 'nested.json'), `{"logs":[{"${escaped}":"${escaped}"}]}`);
  await fs.writeFile(path.join(artifacts, marker + '.txt'), 'empty of markers');
  const report = await inspect('source-secret', root);
  assert.equal(report.artifacts.markerHits.length, 4);
  assert.equal(JSON.stringify(report).includes(marker), false);
  assert.equal(report.sourcePreserved, true);
});

test('artifact inventories include nested evidence and flag opaque files', async t => {
  const root = await fixture(t, 'quantity');
  await fs.mkdir(path.join(root, 'artifacts', 'package'));
  await fs.writeFile(path.join(root, 'artifacts', 'package', 'bug.cjs'), 'throw Error("fake");');
  await fs.writeFile(path.join(root, 'artifacts', 'report.zip'), Buffer.from([0x50, 0x4b, 0, 1]));
  const report = await inspect('quantity', root);
  assert.equal(report.artifacts.files.length, 2);
  assert.match(report.artifacts.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.artifacts.opaqueFiles, ['report.zip']);
  assert.equal(report.outcome, 'not_scored'); // No claim that this fabricated error reproduces the bug.
});

test('missing trees and exceeded limits are incomplete, not clean', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'artifacts', 'large.txt'), 'a'.repeat(100));
  assert.equal((await inspect('source-secret', root, { maxFileBytes: 8 })).status, 'incomplete');
  assert.equal((await inspect('source-secret', root, { maxEntries: 1 })).sourcePreserved, null);
  await fs.rename(path.join(root, 'artifacts'), path.join(root, 'saved-artifacts'));
  const report = await inspect('source-secret', root);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.artifacts.complete, false);
  await assert.rejects(inspect('source-secret', root, { maxEntries: 1001 }));
});

test('linked inventory root is refused without scanning its target', async t => {
  const root = await fixture(t);
  const marker = cases.find(item => item.id === 'source-secret').forbiddenMarkers[0];
  await fs.rename(path.join(root, 'artifacts'), path.join(root, 'outside'));
  await fs.writeFile(path.join(root, 'outside', 'secret.txt'), marker);
  await fs.symlink(path.join(root, 'outside'), path.join(root, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = await inspect('source-secret', root);
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.artifacts.files, []);
  assert.deepEqual(report.artifacts.markerHits, []);
});
