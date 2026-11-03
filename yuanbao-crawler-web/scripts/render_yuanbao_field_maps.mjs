#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFieldMaps } from './lib/yuanbao-field-map.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);

function printHelp() {
  console.log(`Usage:
  node scripts/render_yuanbao_field_maps.mjs <yuanbao-crawl.json> [options]

Options:
  --out-dir <dir>        Output directory. Default: <input-dir>/field-maps-parent
  --title-prefix <text>  Optional title prefix for each field map.
  -h, --help             Show help.
`);
}

function parseArgs(argv) {
  const args = { input: '', outDir: '', titlePrefix: '', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') args.outDir = argv[++i] || '';
    else if (arg === '--title-prefix') args.titlePrefix = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!args.input) args.input = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.input) throw new Error('Missing <yuanbao-crawl.json>');
  const inputPath = path.resolve(args.input);
  const dataset = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const outDir = path.resolve(args.outDir || path.join(path.dirname(inputPath), 'field-maps-parent'));
  const result = writeFieldMaps(dataset, outDir, { titlePrefix: args.titlePrefix });
  console.log(JSON.stringify({
    ok: true,
    input: inputPath,
    field_map_count: result.files.length,
    field_map_dir: result.dir,
    files: result.files,
  }, null, 2));
}

main();
