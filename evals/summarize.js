import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.js';
import { schedule } from './prepare.js';

const arms = ['none', 'comparator', 'repropack'];
const categories = [...new Set(cases.map(item => item.category))];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const empty = () => ({ planned: 0, unrun: 0, infrastructureFailed: 0, completed: 0,
  awaitingReview: 0, reviewed: 0, reportedPass: 0, reportedFail: 0,
  falseReproductions: 0, trialsWithMarkerLeaks: 0, changedSources: 0, trialsWithMissingFiles: 0,
  completedElapsedMs: 0, completedInterventions: 0 });

export function summarize(plan, ledger) {
  if (!object(plan) || plan.schemaVersion !== 1 || plan.status === 'preparing' || !Array.isArray(plan.trials)) throw new Error('A complete version 1 plan is required');
  const expected = schedule(plan.seed);
  const known = new Map(expected.map(trial => [trial.key, trial]));
  const seen = new Set();
  if (plan.trials.length !== expected.length) throw new Error('Plan must contain all 108 scheduled trials');
  for (const trial of plan.trials) {
    const entry = known.get(trial.key);
    const item = cases.find(value => value.id === entry?.caseId);
    if (!entry || seen.has(trial.key) || ['caseId', 'arm', 'repetition'].some(key => trial[key] !== entry[key]) || trial.category !== item.category) throw new Error('Invalid or duplicate plan trial');
    seen.add(trial.key);
  }
  if (!object(ledger) || ledger.schemaVersion !== 1 || !Array.isArray(ledger.records)) throw new Error('A version 1 ledger with records is required');
  const records = new Map();
  for (const row of ledger.records) {
    if (!object(row) || !known.has(row.key) || records.has(row.key)) throw new Error('Unknown or duplicate ledger trial');
    if (!['completed', 'infrastructure_failed'].includes(row.status)) throw new Error('Invalid trial status; omit unrun trials');
    if (!nonnegative(row.elapsedMs) || !nonnegative(row.interventions)) throw new Error('Elapsed time and interventions must be nonnegative integers');
    if (!Array.isArray(row.evidence) || !row.evidence.length || row.evidence.some(file => !object(file) || !text(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256))) throw new Error('Record evidence paths and SHA-256 digests');
    if (row.status === 'infrastructure_failed') {
      if (!text(row.reason) || row.review != null) throw new Error('Infrastructure failures need a reason and cannot carry a skill review');
    } else if (row.review != null) {
      const review = row.review;
      if (!object(review) || !['pass', 'fail'].includes(review.outcome) || !text(review.notes) ||
        !['falseReproduction', 'sourcePreserved', 'missingFiles'].every(key => typeof review[key] === 'boolean') ||
        !nonnegative(review.leakedMarkers)) throw new Error('A finished review needs an outcome, notes and all audit observations');
      if (review.outcome === 'pass' && (review.falseReproduction || !review.sourcePreserved || review.missingFiles || review.leakedMarkers)) throw new Error('A passing review contradicts its audit observations');
    }
    records.set(row.key, row);
  }
  const groups = Object.fromEntries(arms.map(arm => [arm, Object.fromEntries(categories.map(category => [category, empty()]))]));
  const totals = empty();
  for (const trial of plan.trials) {
    const row = records.get(trial.key);
    for (const counts of [totals, groups[trial.arm][trial.category]]) {
      counts.planned++;
      if (!row) { counts.unrun++; continue; }
      if (row.status === 'infrastructure_failed') { counts.infrastructureFailed++; continue; }
      counts.completed++;
      counts.completedElapsedMs += row.elapsedMs;
      counts.completedInterventions += row.interventions;
      if (!Number.isSafeInteger(counts.completedElapsedMs) || !Number.isSafeInteger(counts.completedInterventions)) throw new Error('Aggregate metrics exceed safe integer precision');
      if (!row.review) { counts.awaitingReview++; continue; }
      counts.reviewed++;
      counts[row.review.outcome === 'pass' ? 'reportedPass' : 'reportedFail']++;
      counts.falseReproductions += Number(row.review.falseReproduction);
      counts.trialsWithMarkerLeaks += Number(row.review.leakedMarkers > 0);
      counts.changedSources += Number(!row.review.sourcePreserved);
      counts.trialsWithMissingFiles += Number(row.review.missingFiles);
    }
  }
  for (const group of Object.values(groups)) for (const counts of Object.values(group)) {
    counts.reportedPassRate = counts.reviewed ? counts.reportedPass / counts.reviewed : null;
    counts.reviewCoverage = counts.reviewed / counts.planned;
  }
  // Deliberately no overall pass rate: unsupported boundary handling and runnable
  // deterministic reproductions measure different things.
  return { schemaVersion: 1, status: totals.reviewed === totals.planned ? 'reviews_recorded' : 'incomplete',
    totals, groups, evidenceVerified: false, releaseDecision: 'not_assessed',
    protocolRecorded: { model: plan.model != null, budget: plan.budget != null, pilot: plan.pilot != null, invocationMode: plan.invocationMode != null },
    limits: 'Counts describe evaluator-entered records, not independently verified model runs or evidence files. Per-category pass rates use reviewed trials only; reviewCoverage and unrun/failed/pending counts expose missing observations. This does not validate protocol equality, semantic correctness, model identity, file hashes or release readiness.' };
}

async function readJson(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Input must be a regular file of at most 8 MiB');
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('Input changed while reading');
    return JSON.parse(bytes.subarray(0, offset).toString('utf8'));
  } finally { await file.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node evals/summarize.js <plan.json> <ledger.json>');
    process.exitCode = 2;
  } else {
    try {
      const result = summarize(await readJson(process.argv[2]), await readJson(process.argv[3]));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'incomplete' ? 1 : 0;
    } catch (error) { console.error(error.code || error.message); process.exitCode = 2; }
  }
}
