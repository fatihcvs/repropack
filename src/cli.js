#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createPackage } from './package.js';
import { verifyPackage } from './verify.js';
import { reproduce } from './runner.js';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('repropack create <recipe.json> | verify <package-directory> | run <package-directory> --allow-execution\nRecipe: root, output, files[], command[], signature; optional setup[], exitCode, cwd, timeoutMs.\ncreate/verify do not execute code. run executes reviewed code locally in temporary directories, NOT a sandbox. No uploads.');
} else if (args.length === 2 && args[0] === 'create') {
  try {
    const manifest = await createPackage(JSON.parse(await fs.readFile(args[1], 'utf8')));
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) { console.error(`repropack: ${error.message}`); process.exitCode = 2; }
} else if (args.length === 2 && args[0] === 'verify') {
  try {
    const { manifest } = await verifyPackage(args[1]);
    console.log(JSON.stringify({ status: 'verified', fileCount: manifest.files.length, execution: 'not_run' }));
  } catch (error) { console.error(`repropack: ${error.message}`); process.exitCode = 2; }
} else if (args.length === 3 && args[0] === 'run' && args[2] === '--allow-execution') {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const result = await reproduce(args[1], { allowExecution: true, signal: controller.signal });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'reproduced' ? 0 : 1;
  } catch (error) { console.error(`repropack: ${error.message}`); process.exitCode = 2; }
  finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
} else { console.error('Usage: repropack create <recipe.json> | verify <package-directory> | run <package-directory> --allow-execution | --help'); process.exitCode = 2; }
