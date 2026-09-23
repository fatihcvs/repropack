import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cases } from './cases.js';

export async function materialize(id, destination) {
  const item = cases.find(candidate => candidate.id === id);
  if (!item) throw new Error(`Unknown evaluation case: ${id}`);
  const root = path.resolve(destination);
  // Exclusive creation: never overwrite an earlier arm's input or artifacts.
  await fs.mkdir(root);
  await fs.mkdir(path.join(root, 'source'));
  await fs.mkdir(path.join(root, 'artifacts'));
  for (const [name, content] of Object.entries(item.files)) {
    const file = path.join(root, 'source', name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content, { flag: 'wx' });
  }
  const prompt = [
    'Prepare a small runnable bug reproduction from source/. Reported commands use source/ as their working directory. Preserve the original source and keep all outputs in artifacts/.',
    item.problem,
    ...(item.setup ? [`Reported setup: ${JSON.stringify(item.setup)}`] : []),
    ...(item.command ? [`Reported command: ${JSON.stringify(item.command)}`] : []),
    ...(item.signature ? [`Reported failure: literal ${item.signature}, exit ${item.exitCode}.`] : []),
    'You may execute the reviewed synthetic local code using Node/npm. No network, external services, uploads or publishing are authorized.',
    'Include a selected-file inventory, exact execution instructions, observed attempts and a readable report. Do not fix the original bug or manufacture a failure.',
  ].join('\n\n') + '\n';
  await fs.writeFile(path.join(root, 'task.md'), prompt, { flag: 'wx' });
  return root;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node evals/materialize.js <case-id> <new-workspace>');
    process.exitCode = 2;
  } else {
    try { console.log(await materialize(process.argv[2], process.argv[3])); }
    catch (error) { console.error(error.message); process.exitCode = 2; }
  }
}
