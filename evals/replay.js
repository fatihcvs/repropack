import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.js';
import { inspect } from './inspect.js';
import { createPackage } from '../src/package.js';
import { reproduce } from '../src/runner.js';

// This is an evaluator-authored recipe, never instructions extracted from an
// agent report. It works with plain files from any arm, not just ReproPack output.
function validateReview(review) {
  const keys = new Set(['files', 'command', 'setup', 'cwd', 'timeoutMs']);
  if (!review || typeof review !== 'object' || Array.isArray(review) ||
    Object.keys(review).some(key => !keys.has(key))) throw new Error('Invalid review fields');
  if (!Array.isArray(review.files) || !review.files.length || !Array.isArray(review.command)) throw new Error('Review needs files and command');
}

export async function replay(id, workspace, review, { allowExecution = false, temporaryRoot = os.tmpdir(), signal } = {}) {
  if (!allowExecution) throw new Error('Review files and commands, then pass --allow-execution');
  validateReview(review);
  const item = cases.find(value => value.id === id);
  if (!item) throw new Error(`Unknown evaluation case: ${id}`);
  if (item.category === 'unsupported') throw new Error('Unsupported cases require boundary review, not a substitute executable');
  const before = await inspect(id, workspace);
  if (before.status !== 'inspected' || before.sourcePreserved !== true || before.artifacts.empty ||
    before.artifacts.markerHits.length || before.artifacts.opaqueFiles.length) {
    throw new Error('Inspection requires complete, preserved source and nonempty artifacts without known markers or opaque files');
  }
  const root = await fs.realpath(workspace);
  const temporary = await fs.realpath(temporaryRoot);
  const relative = path.relative(root, temporary);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Temporary root must be outside the trial workspace');
  }
  const work = await fs.mkdtemp(path.join(temporary, 'repropack-eval-replay-'));
  try {
    const output = path.join(work, 'package');
    const manifest = await createPackage({
      ...review, root: path.join(root, 'artifacts'), output,
      signature: item.signature, exitCode: item.exitCode,
      timeoutMs: review.timeoutMs ?? item.timeoutMs ?? 10000,
    });
    const inventory = new Map(before.artifacts.files.map(file => [file.path, file]));
    for (const file of manifest.files) {
      const original = inventory.get(file.path);
      if (!original || original.sha256 !== file.sha256 || original.size !== file.size) throw new Error('Selected artifact changed after inspection');
    }
    const result = await reproduce(output, { allowExecution: true, temporaryRoot: work, signal });
    const after = await inspect(id, workspace);
    const unchanged = after.status === 'inspected' && after.sourcePreserved === true &&
      JSON.stringify(after.artifacts.files) === JSON.stringify(before.artifacts.files);
    const evidence = {
      schemaVersion: 1, caseId: id, category: item.category,
      status: unchanged ? 'replayed' : 'workspace_changed',
      inspectionBefore: before, inspectionAfter: after,
      replay: result, outcome: 'not_scored',
      runtimeMarkerHits: (item.forbiddenMarkers || []).flatMap((marker, index) => JSON.stringify(result).includes(marker) ? [index + 1] : []),
      limits: 'Reviewed local code only, not a filesystem/network sandbox. Matching the corpus signature does not prove semantic equivalence or rule out a manufactured failure. Review transformations, reports and boundary claims separately. Model execution is not established by replay.',
    };
    // Program output can contain a known marker even when the file scan passed.
    // Keep the evidence local; this redaction is not a general secret detector.
    const markers = item.forbiddenMarkers || [];
    return JSON.parse(markers.reduce((text, marker, index) => text.split(marker).join(`<MARKER_${index + 1}>`), JSON.stringify(evidence)));
  } finally {
    await fs.rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 6 || process.argv[5] !== '--allow-execution') {
    console.error('Usage: node evals/replay.js <case-id> <workspace> <review.json> --allow-execution');
    process.exitCode = 2;
  } else {
    try {
      const filename = process.argv[4];
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Review must be a regular JSON file of at most 64 KiB');
      const result = await replay(process.argv[2], process.argv[3], JSON.parse(await fs.readFile(filename, 'utf8')), { allowExecution: true });
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'replayed' ? 0 : 1;
    } catch (error) { console.error(error.code || error.message); process.exitCode = 2; }
  }
}
