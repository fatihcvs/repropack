import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cases } from './cases.js';
import { materialize } from './materialize.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const vendor = new URL('./vendor/bug-reproduction-brief/', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');

export function schedule(seed) {
  if (typeof seed !== 'string' || !seed.trim()) throw new Error('A nonempty recorded seed is required');
  const trials = cases.flatMap(item => ['none', 'comparator', 'repropack'].flatMap(arm =>
    [1, 2, 3].map(repetition => ({ caseId: item.id, arm, repetition, key: `${item.id}-${arm}-${repetition}` }))));
  // A digest sort gives a reproducible permutation without depending on a
  // runtime-specific random generator. This is ordering, not a security boundary.
  return trials.sort((a, b) => {
    const left = hash(`${seed}\0${a.key}`);
    const right = hash(`${seed}\0${b.key}`);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export async function prepare(destination, { seed, cliPath }) {
  const trials = schedule(seed);
  if (!path.isAbsolute(cliPath || '')) throw new Error('CLI path must be absolute');
  const cliBytes = await fs.readFile(cliPath);
  const provenance = JSON.parse(await fs.readFile(new URL('provenance.json', vendor), 'utf8'));
  const comparatorFiles = [];
  for (const entry of provenance.files) {
    if (!['SKILL.md', 'LICENSE'].includes(entry.path)) throw new Error('Unexpected comparator file');
    const bytes = await fs.readFile(new URL(entry.path, vendor));
    if (hash(bytes) !== entry.sha256) throw new Error('Comparator checksum mismatch');
    comparatorFiles.push({ name: entry.path, bytes });
  }
  const git = args => execFileSync('git', ['-C', repo, ...args]);
  const commit = git(['rev-parse', 'HEAD']).toString('utf8').trim();
  const prefix = 'skills/reproduce-bug/';
  const names = git(['ls-tree', '-r', '--name-only', commit, prefix]).toString('utf8').trim().split('\n');
  if (!names.includes(prefix + 'SKILL.md')) throw new Error('Candidate skill is not committed');
  const candidateFiles = names.map(name => ({ name: name.slice(prefix.length), bytes: git(['show', `${commit}:${name}`]) }));
  const root = path.resolve(destination);
  await fs.mkdir(root); // Exclusive: never overwrite a campaign, including a partial one.
  await fs.mkdir(path.join(root, 'trials'));
  const plan = {
    schemaVersion: 1, status: 'prepared_not_executed', seed,
    candidate: { commit, files: candidateFiles.map(file => ({ path: file.name, sha256: hash(file.bytes) })) },
    comparator: provenance,
    cli: { path: cliPath, entrySha256: hash(cliBytes), note: 'Entry hash only; pin the complete CLI installation before running.' },
    model: null, budget: null, pilot: null, invocationMode: null,
    trials: [],
  };
  // Persist an incomplete plan first so interrupted preparation cannot look ready.
  await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify({ ...plan, status: 'preparing' }, null, 2));
  for (const [index, trial] of trials.entries()) {
    const directory = `trials/${String(index + 1).padStart(3, '0')}-${trial.key}`;
    const workspace = await materialize(trial.caseId, path.join(root, directory));
    const skillName = trial.arm === 'comparator' ? 'bug-reproduction-brief' : 'reproduce-bug';
    const files = trial.arm === 'none' ? [] : trial.arm === 'comparator' ? comparatorFiles : candidateFiles;
    for (const file of files) {
      const target = path.join(workspace, '.claude', 'skills', skillName, file.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.bytes, { flag: 'wx' });
    }
    await fs.appendFile(path.join(workspace, 'task.md'), `\nThe common ReproPack CLI is at ${JSON.stringify(cliPath)}. All trial arms have access to this same CLI.\n`);
    const item = cases.find(value => value.id === trial.caseId);
    plan.trials.push({ ...trial, directory, category: item.category, status: 'not_run',
      source: Object.entries(item.files).map(([name, content]) => ({ path: name, sha256: hash(content) })) });
  }
  await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) {
    console.error('Usage: node evals/prepare.js <new-directory> <seed> <absolute-cli-path>');
    process.exitCode = 2;
  } else {
    try {
      const plan = await prepare(process.argv[2], { seed: process.argv[3], cliPath: process.argv[4] });
      console.log(JSON.stringify({ status: plan.status, trials: plan.trials.length, candidate: plan.candidate.commit }));
    } catch (error) { console.error(error.message); process.exitCode = 2; }
  }
}
