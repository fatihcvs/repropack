import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm || !path.isAbsolute(npm)) throw new Error('Run through npm run verify:package');
const temporary = await fs.realpath(os.tmpdir());
const work = await fs.mkdtemp(path.join(temporary, 'repropack-install-check-'));
assert.equal(path.dirname(work), temporary);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (entry, args, cwd) => execFileSync(process.execPath, [entry, ...args], {
  cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  windowsHide: true, env: { ...process.env, npm_config_cache: path.join(work, 'npm-cache') },
});

try {
  const packed = JSON.parse(run(npm, ['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', work], root));
  assert.equal(packed.length, 1);
  assert.equal(path.basename(packed[0].filename), packed[0].filename);
  const archive = path.join(work, packed[0].filename);
  const prefix = path.join(work, 'consumer');
  await fs.mkdir(prefix);
  await fs.writeFile(path.join(prefix, 'package.json'), JSON.stringify({ private: true }));
  run(npm, ['install', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', archive], prefix);
  const installed = path.join(prefix, 'node_modules', '@fatihcvs', 'repropack');
  const required = [
    'src/cli.js', 'src/package.js', 'src/verify.js', 'src/runner.js', 'src/report.js',
    'src/windows-job.ps1', 'src/linux-supervisor.js', 'fixtures/assertion/bug.cjs',
    'skills/reproduce-bug/SKILL.md', 'skills/reproduce-bug/references/node-npm.md',
    'skills/reproduce-bug/references/results.md', 'docs/quickstart.md', 'docs/quickstart-tr.md',
    'schemas/common.schema.json', 'schemas/recipe.schema.json', 'schemas/manifest.schema.json', 'schemas/result.schema.json',
  ];
  for (const filename of required) {
    const original = await fs.readFile(path.join(root, filename));
    assert.equal(hash(await fs.readFile(path.join(installed, filename))), hash(original), `Installed bytes differ: ${filename}`);
  }
  const metadata = JSON.parse(await fs.readFile(path.join(installed, 'package.json'), 'utf8'));
  assert.deepEqual(metadata.dependencies || {}, {});
  assert.deepEqual(metadata.optionalDependencies || {}, {});
  assert.equal(metadata.bin.repropack, 'src/cli.js');
  await fs.access(path.join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'repropack.cmd' : 'repropack'));
  const dependencies = await fs.readdir(path.join(prefix, 'node_modules'));
  assert.ok(!dependencies.includes('ajv'), 'Development validator must not be installed');
  const cli = path.join(installed, 'src', 'cli.js');
  assert.match(run(cli, ['--help'], prefix), /repropack create/);
  const source = path.join(installed, 'fixtures', 'assertion');
  const sourceBytes = await fs.readFile(path.join(source, 'bug.cjs'));
  const output = path.join(work, 'reproduction');
  const recipe = path.join(work, 'recipe.json');
  await fs.writeFile(recipe, JSON.stringify({ root: source, output, files: ['bug.cjs'], command: ['node', 'bug.cjs'], signature: 'TOTAL_IGNORES_QUANTITY' }));
  assert.equal(JSON.parse(run(cli, ['create', recipe], prefix)).status, 'packaged');
  const verified = JSON.parse(run(cli, ['verify', output], prefix));
  assert.equal(verified.status, 'verified');
  assert.equal(verified.execution, 'not_run');
  const result = JSON.parse(run(cli, ['run', output, '--allow-execution'], prefix));
  assert.equal(result.status, 'reproduced');
  assert.equal(result.attempts.length, 2);
  assert.ok(result.attempts.every(attempt => attempt.matched && attempt.target.exitCode === 1));
  const resultFile = path.join(work, 'result.json');
  await fs.writeFile(resultFile, JSON.stringify(result));
  const report = run(cli, ['report', resultFile, '--mask-path', work], prefix);
  assert.match(report, /TOTAL_IGNORES_QUANTITY/);
  assert.match(report, /reproduced/);
  assert.deepEqual(await fs.readFile(path.join(source, 'bug.cjs')), sourceBytes);
  console.log(JSON.stringify({ status: 'passed', package: metadata.name, version: metadata.version,
    archiveSha256: hash(await fs.readFile(archive)), installedFilesChecked: required.length,
    platform: process.platform, node: process.version, attempts: result.attempts.length,
    scope: 'Local tarball installed offline in an empty consumer; not public-download or Claude behavior verification.' }, null, 2));
} finally {
  // Only the exclusively created directory under the resolved temp root is removed.
  await fs.rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
