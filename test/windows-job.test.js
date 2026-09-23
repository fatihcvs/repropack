import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
async function launch(t, code, args = [], parentPid = 0, environment) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-job-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const specification = path.join(directory, 'specification.json');
  await fs.writeFile(specification, JSON.stringify({ executable: process.execPath, arguments: ['-e', code, ...args], cwd: directory, parentPid, environment }));
  const helper = fileURLToPath(new URL('../src/windows-job.ps1', import.meta.url));
  const child = spawn(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Specification', specification],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = [], stderr = [];
  child.stdout.on('data', data => stdout.push(data));
  child.stderr.on('data', data => stderr.push(data));
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  });
  const timer = setTimeout(() => child.kill(), 20000);
  t.after(() => clearTimeout(timer));
  t.after(() => { if (child.exitCode === null) child.kill(); });
  return { child, closed };
}

test('Windows job preserves exit code and exact arguments without shell evaluation', { skip: !windows }, async t => {
  const args = ['space here', 'quote"here', 'trailing\\', '', '$(unused); & literal'];
  const { closed } = await launch(t, 'console.log(JSON.stringify(process.argv.slice(1)));process.exitCode=7', args);
  const result = await closed;
  assert.equal(result.code, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test('Windows job replaces the helper environment and preserves Unicode values', { skip: !windows }, async t => {
  process.env.REPROPACK_HELPER_PRIVATE = 'do-not-inherit';
  t.after(() => delete process.env.REPROPACK_HELPER_PRIVATE);
  const environment = { SystemRoot: process.env.SystemRoot, REPROPACK_VALUE: 'Türkçe = 日本語', REPROPACK_EMPTY: '' };
  const { closed } = await launch(t, 'console.log(JSON.stringify({secret:process.env.REPROPACK_HELPER_PRIVATE ?? null,value:process.env.REPROPACK_VALUE,empty:process.env.REPROPACK_EMPTY}))', [], 0, environment);
  const result = await closed;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { secret: null, value: environment.REPROPACK_VALUE, empty: '' });
});

test('Windows job cleans detached descendants when target exits early', { skip: !windows }, async t => {
  const { closed } = await launch(t, "const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'});console.log(p.pid);p.unref();");
  const result = await closed;
  assert.equal(result.code, 0, result.stderr);
  const pid = Number(result.stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('Windows job cleans target and detached child when supervisor is killed', { skip: !windows }, async t => {
  const { child, closed } = await launch(t, "const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'});console.log(process.pid+','+p.pid);setInterval(()=>{},100)");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Target did not start')), 15000);
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  child.kill();
  const result = await closed;
  const pids = result.stdout.trim().split(',').map(Number);
  assert.equal(pids.length, 2);
  for (const pid of pids) {
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});

test('Windows job watchdog stops descendants when its owning parent dies', { skip: !windows }, async t => {
  const parent = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { windowsHide: true, stdio: 'ignore' });
  t.after(() => { if (parent.exitCode === null) parent.kill(); });
  const { child, closed } = await launch(t, "const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'});console.log(process.pid+','+p.pid);setInterval(()=>{},100)", [], parent.pid);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Target did not start')), 15000);
    child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  parent.kill();
  const result = await closed;
  assert.equal(result.code, 125, result.stderr);
  const pids = result.stdout.trim().split(',').map(Number);
  assert.equal(pids.length, 2);
  for (const pid of pids) {
    assert.ok(Number.isInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});

test('killing the real runner process closes its supervised process tree', { skip: !windows }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-parent-death-'));
  const marker = path.join(directory, 'started.json');
  let pids = [];
  t.after(async () => {
    for (const pid of pids) { try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const target = `const p=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},100)'],{detached:true,stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,p.pid]));setInterval(()=>{},100);`;
  const moduleUrl = new URL('../src/runner.js', import.meta.url).href;
  const program = `import {runCommand} from ${JSON.stringify(moduleUrl)}; await runCommand(['node','-e',${JSON.stringify(target)}],{cwd:${JSON.stringify(directory)},env:process.env,timeoutMs:60000});`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', program], { windowsHide: true, stdio: 'ignore' });
  t.after(() => { if (parent.exitCode === null) parent.kill(); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { pids = JSON.parse(await fs.readFile(marker, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
  }
  assert.equal(pids.length, 2, 'Target must have started before killing runner');
  parent.kill();
  const stopped = pid => { try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } };
  const cleanupDeadline = Date.now() + 5000;
  while (!pids.every(stopped) && Date.now() < cleanupDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(pids.every(stopped), 'Target and detached child must exit after runner death');
});
