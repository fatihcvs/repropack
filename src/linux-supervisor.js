// Internal entry point: run as PID 1 in a fresh Linux PID namespace.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';

if (process.platform !== 'linux' || process.pid !== 1) {
  console.error('repropack: Linux supervisor requires a fresh PID namespace');
  process.exit(125);
}

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const status = value => fs.writeFileSync(spec.statusPath, JSON.stringify(value));
// Only the owning runner holds the write end. Its death closes this pipe even
// after SIGKILL; exiting PID 1 makes the kernel kill every namespace descendant.
process.stdin.on('end', () => process.exit(125));
process.stdin.on('error', () => process.exit(125));
process.on('SIGTERM', () => process.exit(125));
process.on('SIGINT', () => process.exit(125));
let input = '';
let started = false;
process.stdin.on('data', chunk => {
  if (started) return;
  input += chunk.toString();
  if (input.length > 6 || !'start\n'.startsWith(input)) process.exit(125);
  if (input !== 'start\n') return;
  started = true;
  status({ state: 'ready' });
  const target = spawn(spec.executable, spec.arguments, {
    cwd: spec.cwd, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
  });
  target.once('error', error => {
    console.error(`repropack: target launch failed: ${error.code || error.message}`);
    process.exit(125);
  });
  // Do not wait for 'close': a detached descendant can still hold the streams.
  target.once('exit', (code, signal) => {
    const exitCode = code ?? 128 + (os.constants.signals[signal] || 0);
    status({ state: 'exited', exitCode });
    process.exit(exitCode);
  });
});
