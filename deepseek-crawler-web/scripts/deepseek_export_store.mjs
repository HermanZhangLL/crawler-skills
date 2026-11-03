#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDatasetStore } from './lib/store-writer.mjs';
import { collectFieldMapSamples, renderFieldMapHtml, safeFieldMapName } from './lib/field-map-render.mjs';
import { writeShareLinksExcel } from './lib/share-links-excel.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);

function printHelp() {
  console.log(`Usage:
  node scripts/deepseek_export_store.mjs <deepseek-crawl.json> [options]

Options:
  --out-dir <dir>     Output directory. Default: <input-dir>/store
  --html-maps         Generate one field-map HTML per question under <out-dir>/field-maps
  --no-sqlite         Skip SQLite export, write CSV only
  -h, --help          Show help
`);
}

function parseArgs(argv) {
  const args = { input: '', outDir: '', htmlMaps: false, sqlite: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir') args.outDir = argv[++i] || '';
    else if (arg === '--html-maps') args.htmlMaps = true;
    else if (arg === '--no-sqlite') args.sqlite = false;
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
  if (!args.input) throw new Error('Missing <deepseek-crawl.json>');
  const inputPath = path.resolve(args.input);
  const dataset = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const outDir = path.resolve(args.outDir || path.join(path.dirname(inputPath), 'store'));
  const store = exportDatasetStore(dataset, outDir, { sqlite: args.sqlite });
  const linksExcel = writeShareLinksExcel(dataset, outDir);
  store.share_links_excel = linksExcel.ok ? linksExcel.path : null;
  store.share_links_excel_error = linksExcel.ok ? '' : linksExcel.error;

  const fieldMapDir = path.join(outDir, 'field-maps');
  const fieldMaps = [];
  if (args.htmlMaps) {
    fs.mkdirSync(fieldMapDir, { recursive: true });
    for (const [key, sample] of collectFieldMapSamples(dataset)) {
      const html = renderFieldMapHtml(sample, dataset, {
        title: `DeepSeek 数据字段地图 · ${sample.question_id || sample.sample_id || 'sample'}`,
      });
      if (!html) continue;
      const file = path.join(fieldMapDir, `${safeFieldMapName(key)}.html`);
      fs.writeFileSync(file, html, 'utf8');
      fieldMaps.push(file);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    out_dir: outDir,
    samples_csv: store.samples_csv,
    references_csv: store.references_csv,
    sqlite_db: store.db_path || null,
    sqlite_ok: store.sqlite,
    sqlite_error: store.sqlite_error || '',
    field_map_count: fieldMaps.length,
    field_map_dir: args.htmlMaps ? fieldMapDir : null,
  }, null, 2));
}

main();
