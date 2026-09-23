import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPackage } from './verify.js';

async function resolveCommand(command) {
  if (command[0] === 'node') return [process.execPath, ...command.slice(1)];
  if (command[0] !== 'npm') throw new Error('Only node and npm commands are currently supported');
  const directories = [path.dirname(process.execPath), ...(process.env.PATH || process.env.Path || '').split(path.delimiter)];
  for (const directory of directories.filter(Boolean)) {
    for (const relative of ['node_modules/npm/bin/npm-cli.js', '../lib/node_modules/npm/bin/npm-cli.js']) {
      const candidate = path.resolve(directory, relative);
      try {
        if ((await fs.stat(candidate)).isFile()) return [process.execPath, candidate, ...command.slice(1)];
      } catch { /* Try the next standard installation location. */ }
    }
  }
  throw new Error('Cannot locate npm-cli.js in the Node installation or PATH');
}

function executionEnvironment(directory) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (['path', 'systemroot', 'windir', 'comspec', 'pathext', 'lang', 'lc_all'].includes(key.toLowerCase())) env[key] = value;
  }
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || '');
  return { ...env, HOME: directory, USERPROFILE: directory, TEMP: directory, TMP: directory, TMPDIR: directory,
    npm_config_cache: path.join(directory, 'npm-cache'), npm_config_userconfig: path.join(directory, 'empty-npmrc') };
}

async function terminateTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', reject);
      killer.once('close', code => code === 0 || child.exitCode !== null ? resolve() : reject(new Error('Process tree termination failed')));
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

export async function runCommand(command, { cwd, env, timeoutMs, signal, maxOutputBytes = 1024 * 1024 }) {
  if (signal?.aborted) return { status: 'cancelled', exitCode: null, stdout: '', stderr: '' };
  const resolved = await resolveCommand(command);
  let supervision;
  let invocation = resolved;
  if (process.platform === 'win32') {
    supervision = await fs.mkdtemp(path.join(env?.TEMP || os.tmpdir(), 'repropack-supervisor-'));
    const specification = path.join(supervision, 'spec.json');
    await fs.writeFile(specification, JSON.stringify({ executable: resolved[0], arguments: resolved.slice(1), cwd, statusPath: path.join(supervision, 'status.json'), parentPid: process.pid }));
    invocation = [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./windows-job.ps1', import.meta.url)), '-Specification', specification];
  }
  try {
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation[0], invocation.slice(1), { cwd, env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: [], stderr: [] };
    let bytes = 0;
    let stopped;
    let termination;
    let cleanupError;
    function stop(reason) {
      if (stopped) return;
      stopped = reason;
      termination = terminateTree(child).catch(error => { cleanupError = error; child.kill(); });
    }
    let timer = setTimeout(() => stop(supervision ? 'startup_failed' : 'timed_out'), supervision ? 20000 : timeoutMs);
    let ready = !supervision;
    let finished = false;
    let readingStatus = false;
    const poll = supervision ? setInterval(async () => {
      if (ready || readingStatus || stopped) return;
      readingStatus = true;
      try {
        const status = JSON.parse(await fs.readFile(path.join(supervision, 'status.json'), 'utf8'));
        if (!finished && !stopped && (status.state === 'ready' || status.state === 'exited')) {
          ready = true;
          clearTimeout(timer);
          timer = setTimeout(() => stop('timed_out'), timeoutMs);
        }
      } catch { /* The helper has not published a complete status yet. */ }
      finally { readingStatus = false; }
    }, 20) : undefined;
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', chunk => {
        const remaining = Math.max(0, maxOutputBytes - bytes);
        if (remaining > 0) output[stream].push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        if (bytes > maxOutputBytes) stop('output_limit');
      });
    }
    let spawnError;
    child.once('error', error => { spawnError = error.code || 'spawn_error'; });
    child.once('close', async (exitCode, exitSignal) => {
      finished = true;
      clearTimeout(timer);
      clearInterval(poll);
      signal?.removeEventListener('abort', abort);
      await termination;
      if (cleanupError) { reject(cleanupError); return; }
      if (supervision && !stopped && !spawnError) {
        try {
          const status = JSON.parse(await fs.readFile(path.join(supervision, 'status.json'), 'utf8'));
          if (status.state !== 'exited' || status.exitCode !== exitCode) spawnError = 'supervisor_failed';
        } catch { spawnError = 'supervisor_failed'; }
      }
      resolve({ status: stopped || (spawnError ? 'spawn_failed' : 'exited'), exitCode, signal: exitSignal,
        ...(spawnError ? { error: spawnError } : {}),
        stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') });
    });
  });
  } finally {
    if (supervision) await fs.rm(supervision, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export async function reproduce(directory, { allowExecution = false, signal, temporaryRoot = os.tmpdir() } = {}) {
  if (!allowExecution) throw new Error('Execution requires --allow-execution after reviewing the package and recipe');
  const { manifest, files } = await verifyPackage(directory);
  const { recipe } = manifest;
  const attempts = [];
  const finish = (status, extra = {}) => ({
    schemaVersion: 1, status, scope: 'local machine; up to two clean-directory attempts',
    environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    source: manifest.source, files: manifest.files, recipe, attempts, ...extra,
  });
  // Resolve both commands before executing either one.
  try {
    await resolveCommand(recipe.command);
    if (recipe.setup) await resolveCommand(recipe.setup);
  } catch (error) { return finish('unsupported', { reason: error.message }); }
  for (let index = 0; index < 2; index++) {
    if (signal?.aborted) return finish('cancelled');
    const work = await fs.mkdtemp(path.join(await fs.realpath(temporaryRoot), 'repropack-run-'));
    try {
      const project = path.join(work, 'project');
      const environment = path.join(work, 'environment');
      await fs.mkdir(environment);
      for (const file of files) {
        const destination = path.join(project, file.path);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, file.bytes, { flag: 'wx' });
      }
      const options = { cwd: path.join(project, recipe.cwd), env: executionEnvironment(environment), timeoutMs: recipe.timeoutMs, signal };
      const attempt = { number: index + 1 };
      attempts.push(attempt);
      if (recipe.setup) {
        attempt.setup = await runCommand(recipe.setup, options);
        if (attempt.setup.status !== 'exited' || attempt.setup.exitCode !== 0) {
          return finish(attempt.setup.status === 'cancelled' ? 'cancelled' : 'setup_failed');
        }
      }
      attempt.target = await runCommand(recipe.command, options);
      const target = attempt.target;
      attempt.matched = target.status === 'exited' && target.exitCode === recipe.expected.exitCode &&
        (target.stdout.includes(recipe.expected.signature) || target.stderr.includes(recipe.expected.signature));
      if (target.status !== 'exited') return finish(target.status);
    } finally {
      // work is exclusively created by mkdtemp under the resolved temporary root.
      await fs.rm(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  const matches = attempts.filter(attempt => attempt.matched).length;
  return finish(matches === 2 ? 'reproduced' : matches === 1 ? 'intermittent' : 'not_reproduced');
}
