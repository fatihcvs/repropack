#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createPackage } from './package.js';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('repropack create <recipe.json>\nRecipe: root, output, files[], command[], signature; optional exitCode, cwd, timeoutMs.\nCreates a local package; does not execute or upload it.');
} else if (args.length === 2 && args[0] === 'create') {
  try {
    const manifest = await createPackage(JSON.parse(await fs.readFile(args[1], 'utf8')));
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) { console.error(`repropack: ${error.message}`); process.exitCode = 2; }
} else { console.error('Usage: repropack create <recipe.json> | --help'); process.exitCode = 2; }
