import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runCommand } from '../src/runner.js';

const linux = process.platform === 'linux';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function matchingProcesses(marker) {
  const matches = [];
  for (const entry of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const command = await fs.readFile(`/proc/${entry}/cmdline`, 'utf8');
      if (command.includes(marker)) matches.push(Number(entry));
    } catch { /* A process can disappear while scanning. */ }
  }
  return matches;
}
async function waitFor(check, message) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(30);
  }
  throw new Error(message);
}
async function fixture(t, early = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-linux-'));
  const marker = path.basename(directory);
  t.after(async () => {
    for (const pid of await matchingProcesses(marker)) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const ready = path.join(directory, 'ready');
  const childCode = "process.send('ready');process.disconnect();setInterval(()=>{},100);";
  const code = `const fs=require('fs');const p=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)},${JSON.stringify(marker)}],{detached:true,stdio:['ignore','ignore','ignore','ipc']});p.on('message',()=>{fs.writeFileSync(${JSON.stringify(ready)},'ready');${early ? 'process.exit(7)' : 'setInterval(()=>{},100)'}});`;
  return { directory, marker, ready, code, options: { cwd: directory, env: { ...process.env, TMPDIR: directory }, timeoutMs: 5000 } };
}
const exists = file => fs.stat(file).then(() => true, () => false);

test('Linux namespace cleans detached children on target exit', { skip: !linux }, async t => {
  const f = await fixture(t, true);
  const result = await runCommand(['node', '-e', f.code], f.options);
  assert.equal(result.status, 'exited', result.stderr);
  assert.equal(result.exitCode, 7);
  assert.ok(await exists(f.ready));
  await waitFor(async () => (await matchingProcesses(f.marker)).length === 0, 'Detached child survived');
});

test('Linux namespace cleans detached children on timeout and cancellation', { skip: !linux }, async t => {
  for (const mode of ['timed_out', 'cancelled']) {
    const f = await fixture(t);
    const controller = new AbortController();
    const pending = runCommand(['node', '-e', f.code], { ...f.options, signal: controller.signal });
    await waitFor(() => exists(f.ready), 'Target did not start');
    assert.ok((await matchingProcesses(f.marker)).length >= 2);
    if (mode === 'cancelled') controller.abort();
    const result = await pending;
    assert.equal(result.status, mode, result.stderr);
    await waitFor(async () => (await matchingProcesses(f.marker)).length === 0, 'Child survived interruption');
  }
});

test('Linux namespace dies when the owning runner is forcibly killed', { skip: !linux }, async t => {
  const f = await fixture(t);
  const driver = `import {runCommand} from ${JSON.stringify(new URL('../src/runner.js', import.meta.url).href)};await runCommand(${JSON.stringify(['node', '-e', f.code])},${JSON.stringify({ ...f.options, timeoutMs: 60000 })});`;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: 'ignore' });
  const closed = new Promise((resolve, reject) => { owner.once('close', resolve); owner.once('error', reject); });
  t.after(() => { if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL'); });
  await waitFor(() => exists(f.ready), 'Target did not start');
  assert.ok((await matchingProcesses(f.marker)).length >= 3);
  owner.kill('SIGKILL');
  await closed;
  await waitFor(async () => (await matchingProcesses(f.marker)).length === 0, 'Processes survived owner death');
});

test('Linux namespace startup failure does not execute the target', { skip: !linux }, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, 'unshare'), '#!/bin/sh\necho namespace-denied >&2\nexit 1\n', { mode: 0o755 });
  const result = await runCommand(['node', '-e', f.code], { ...f.options, env: { ...f.options.env, PATH: f.directory } });
  assert.equal(result.status, 'spawn_failed');
  assert.match(result.stderr, /namespace-denied/);
  assert.equal(await exists(f.ready), false);
});

test('Linux namespace cleans the tree when its unshare supervisor is killed', { skip: !linux }, async t => {
  const f = await fixture(t);
  const pending = runCommand(['node', '-e', f.code], f.options);
  await waitFor(() => exists(f.ready), 'Target did not start');
  let supervisor;
  for (const pid of await matchingProcesses(f.marker)) {
    const command = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
    if (path.basename(command[0]) === 'unshare') supervisor = pid;
  }
  assert.ok(supervisor, 'Expected owned unshare process');
  process.kill(supervisor, 'SIGKILL');
  const result = await pending;
  assert.equal(result.status, 'spawn_failed');
  await waitFor(async () => (await matchingProcesses(f.marker)).length === 0, 'Tree survived supervisor death');
});

test('Linux namespace preserves arguments, uid and a target exit of 125', { skip: !linux }, async t => {
  const f = await fixture(t);
  const args = ['space here', 'quote"here', 'trailing\\', '', '$(unused); & literal'];
  const result = await runCommand(['node', '-e', 'console.log(JSON.stringify({args:process.argv.slice(1),uid:process.getuid()}));process.exit(125)', ...args], f.options);
  assert.equal(result.status, 'exited', result.stderr);
  assert.equal(result.exitCode, 125);
  assert.deepEqual(JSON.parse(result.stdout), { args, uid: process.getuid() });
});
