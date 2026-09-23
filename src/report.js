const statuses = new Set(['reproduced', 'not_reproduced', 'intermittent', 'setup_failed', 'timed_out', 'cancelled', 'output_limit', 'spawn_failed', 'startup_failed', 'unsupported']);

function fence(text) {
  let length = 3;
  for (const match of text.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const marker = '`'.repeat(length);
  return `${marker}\n${text}\n${marker}`;
}

export function renderReport(result, { maskPaths = [] } = {}) {
  if (!result || result.schemaVersion !== 1 || !statuses.has(result.status) || !Array.isArray(result.attempts) || result.attempts.length > 2 || !result.recipe?.expected) throw new Error('Unsupported execution result');
  const { exitCode, signature } = result.recipe.expected;
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255 || typeof signature !== 'string' || !signature.trim()) throw new Error('Invalid failure criteria');
  if (!Array.isArray(maskPaths) || maskPaths.some(value => typeof value !== 'string' || !value)) throw new Error('Mask paths must be nonempty strings');
  // Mask strings before JSON escaping so Windows backslashes and nested arguments
  // receive the same treatment as raw process output.
  const masks = [...new Set(maskPaths.flatMap(value => [value, value.replaceAll('\\', '/')]))].sort((a, b) => b.length - a.length);
  function mask(value) {
    if (typeof value === 'string') {
      for (const prefix of masks) value = value.split(prefix).join('<LOCAL_PATH>');
      return value;
    }
    if (Array.isArray(value)) return value.map(mask);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [mask(key), mask(entry)]));
    return value;
  }
  const matched = result.attempts.filter(attempt => {
    const target = attempt.target;
    return target?.status === 'exited' && target.exitCode === result.recipe.expected.exitCode &&
      (typeof target.stdout === 'string' && target.stdout.includes(result.recipe.expected.signature) ||
       typeof target.stderr === 'string' && target.stderr.includes(result.recipe.expected.signature)) &&
      (!attempt.setup || attempt.setup.status === 'exited' && attempt.setup.exitCode === 0);
  }).length;
  if (result.status === 'reproduced' && (result.attempts.length !== 2 || matched !== 2)) throw new Error('Reproduced claim does not match recorded attempts');
  const safe = mask(result);
  const lines = [
    '# ReproPack execution report', '',
    `Outcome: **${safe.status}**`, '',
    `Recorded attempts: ${safe.attempts.length}; matching failure signatures: ${matched}.`, '',
    '## Expected behavior and recipe', '',
    'The command must exit with the specified code and include the literal signature in stdout or stderr.', '',
    fence(JSON.stringify(safe.recipe, null, 2)), '',
    '## Environment and selected files', '',
    fence(JSON.stringify({ environment: safe.environment, source: safe.source, files: safe.files }, null, 2)), '',
  ];
  if (safe.reason) lines.push('## Execution note', '', fence(String(safe.reason)), '');
  for (const [index, attempt] of safe.attempts.entries()) {
    lines.push(`## Attempt ${index + 1}`, '');
    for (const name of ['setup', 'target']) {
      const phase = attempt[name];
      if (!phase) { lines.push(`${name}: not run.`, ''); continue; }
      const { stdout, stderr, ...details } = phase;
      lines.push(`### ${name}`, '', fence(JSON.stringify(details, null, 2)), '', 'stdout:', '', fence(String(stdout ?? '')), '', 'stderr:', '', fence(String(stderr ?? '')), '');
    }
  }
  lines.push('## Limits and sharing review', '',
    'These are local-machine observations, not cross-machine or cross-OS proof. A signature match does not establish root cause.', '',
    'This report renders saved results; it does not execute code or authenticate the evidence. Review every selected file, command and output before sharing. No upload is performed.', '',
    'Path masking replaces only the exact supplied strings and forward-slash variants. It is not a secret scanner; credentials, other paths and encoded variants can remain. The original JSON and package are unchanged.', '',
    'Execution used ordinary OS permissions, not a sandbox. POSIX detached-process cleanup remains a development-preview limitation; only Windows lifecycle behavior has been tested.', '');
  return lines.join('\n');
}
