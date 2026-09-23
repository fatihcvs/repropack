import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../evals/summarize.js';
import { schedule } from '../evals/prepare.js';
import { cases } from '../evals/cases.js';

const plan = () => ({ schemaVersion: 1, status: 'prepared_not_executed', seed: 'summary-tests',
  model: null, budget: null, pilot: null, invocationMode: null,
  trials: schedule('summary-tests').map(trial => ({ ...trial, category: cases.find(item => item.id === trial.caseId).category })) });
const review = (overrides = {}) => ({ outcome: 'pass', notes: 'Synthetic unit-test review only.',
  falseReproduction: false, sourcePreserved: true, missingFiles: false, leakedMarkers: 0, ...overrides });
const record = (key, overrides = {}) => ({ key, status: 'completed', elapsedMs: 1000, interventions: 0,
  evidence: [{ path: 'synthetic.json', sha256: 'a'.repeat(64) }], review: null, ...overrides });
const ledger = (...records) => ({ schemaVersion: 1, records });

test('prepared campaign remains 108 unrun trials with null rates', () => {
  const result = summarize(plan(), ledger());
  assert.equal(result.status, 'incomplete');
  assert.equal(result.totals.unrun, 108);
  assert.equal(result.totals.reviewed, 0);
  for (const arm of Object.values(result.groups)) {
    assert.equal(arm.deterministic.planned, 12);
    assert.equal(arm.unsupported.planned, 6);
    for (const group of Object.values(arm)) {
      assert.equal(group.reportedPassRate, null);
      assert.equal(group.reviewCoverage, 0);
    }
  }
  assert.equal(result.evidenceVerified, false);
  assert.equal(result.releaseDecision, 'not_assessed');
});

test('keeps infrastructure failures, pending reviews and per-category denominators separate', () => {
  const result = summarize(plan(), ledger(
    record('quantity-none-1', { review: review() }),
    record('quantity-none-2', { status: 'infrastructure_failed', reason: 'API 401' }),
    record('quantity-none-3'),
    record('zero-default-none-1', { review: review({ outcome: 'fail', falseReproduction: true }) }),
    record('browser-layout-none-1', { review: review() }),
    record('source-secret-repropack-1', { review: review({ outcome: 'fail', leakedMarkers: 2, sourcePreserved: false, missingFiles: true }) }),
  ));
  assert.equal(result.totals.unrun, 102);
  assert.equal(result.totals.infrastructureFailed, 1);
  assert.equal(result.totals.awaitingReview, 1);
  assert.equal(result.totals.reviewed, 4);
  assert.equal(result.groups.none.deterministic.reportedPassRate, 0.5);
  assert.equal(result.groups.none.deterministic.reviewCoverage, 2 / 12);
  assert.equal(result.groups.none.unsupported.reportedPassRate, 1);
  assert.equal(result.groups.repropack.secret.trialsWithMarkerLeaks, 1);
  assert.equal(result.groups.repropack.secret.changedSources, 1);
  assert.equal(result.groups.repropack.secret.trialsWithMissingFiles, 1);
  assert.equal(result.totals.completedElapsedMs, 5000);
  assert.equal('reportedPassRate' in result.totals, false);
});

test('full synthetic review coverage does not authenticate evidence or approve release', () => {
  const p = plan();
  const result = summarize(p, ledger(...p.trials.map(trial => record(trial.key, { review: review() }))));
  assert.equal(result.status, 'reviews_recorded');
  assert.equal(result.totals.reportedPass, 108);
  assert.equal(result.evidenceVerified, false);
  assert.equal(result.releaseDecision, 'not_assessed');
  assert.deepEqual(result.protocolRecorded, { model: false, budget: false, pilot: false, invocationMode: false });
});

test('rejects duplicate, unknown or category-mislabeled trials', () => {
  const p = plan();
  assert.throws(() => summarize({ ...p, status: 'preparing' }, ledger()));
  assert.throws(() => summarize({ ...p, trials: p.trials.slice(1) }, ledger()));
  assert.throws(() => summarize({ ...p, trials: p.trials.map((trial, i) => i === 1 ? p.trials[0] : trial) }, ledger()));
  assert.throws(() => summarize({ ...p, trials: p.trials.map(trial => ({ ...trial, category: 'unsupported' })) }, ledger()));
  const row = record('quantity-none-1');
  assert.throws(() => summarize(p, ledger(row, row)));
  assert.throws(() => summarize(p, ledger(record('unknown'))));
});

test('refuses incomplete or contradictory review records and malformed metrics/evidence', () => {
  const invalid = [
    { status: 'not_run' }, { elapsedMs: -1 }, { interventions: 0.5 }, { evidence: [] },
    { evidence: [{ path: 'report.json', sha256: 'wrong' }] },
    { status: 'infrastructure_failed', reason: '401', review: review() },
    { status: 'infrastructure_failed', reason: '' }, { review: { outcome: 'pass' } },
    { review: review({ falseReproduction: true }) }, { review: review({ leakedMarkers: 1 }) },
    { review: review({ sourcePreserved: false }) }, { review: review({ missingFiles: true }) },
  ];
  for (const fields of invalid) assert.throws(() => summarize(plan(), ledger(record('quantity-none-1', fields))));
  assert.throws(() => summarize(plan(), ledger(
    record('quantity-none-1', { elapsedMs: Number.MAX_SAFE_INTEGER }), record('quantity-none-2'),
  )), /precision/);
});
