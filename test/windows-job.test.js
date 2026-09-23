import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
async function launch(t, code, args = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'repropack-job-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const specification = path.join(directory, 'specification.json');
  await fs.writeFile(specification, JSON.stringify({ executable: process.execPath, arguments: ['-e', code, ...args], cwd: directory }));
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
