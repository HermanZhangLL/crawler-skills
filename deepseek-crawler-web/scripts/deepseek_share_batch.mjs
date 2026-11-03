#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchShareContent, normalizeShareContent, parseShareLinksInput, cleanText } from './lib/share-utils.mjs';
import { exportDatasetStore } from './lib/store-writer.mjs';
import { collectFieldMapSamples, renderFieldMapHtml, safeFieldMapName } from './lib/field-map-render.mjs';
import { writeShareLinksExcel } from './lib/share-links-excel.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const skillRoot = path.resolve(scriptDir, '..');

function printHelp() {
  console.log(`Usage:
  node scripts/deepseek_share_batch.mjs --links <file> [options]

Options:
  --links <file>            Text file or JSON array of share URLs / share_ids.
  --target-entity <text>    Optional target entity passed into the dataset input.
  --target-aliases <text>   Optional target aliases, comma/pipe/semicolon separated.
  --entity-type <type>      person/company/product or 人/公司/产品 (optional).
  --out-dir <dir>           Output directory. Default: runs/deepseek-shares-<timestamp>.
  --concurrency <n>         Parallel fetches. Default: 4.
  --resume                  Skip share ids that already have valid raw JSON.
  --store                   Export CSV and SQLite tables after collection.
  --html-maps               Generate one field-map HTML per question (implies --store).
  -h, --help                Show help.
`);
}

function parseArgs(argv) {
  const args = {
    links: '',
    targetEntity: '',
    targetAliases: [],
    entityType: '',
    outDir: '',
    concurrency: 4,
    resume: false,
    store: false,
    htmlMaps: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--links') args.links = argv[++i] || '';
    else if (arg === '--target-entity') args.targetEntity = argv[++i] || '';
    else if (arg === '--target-aliases') args.targetAliases = String(argv[++i] || '').split(/[|,，;；]+/).map((s) => s.trim()).filter(Boolean);
    else if (arg === '--entity-type') args.entityType = argv[++i] || '';
    else if (arg === '--out-dir') args.outDir = argv[++i] || '';
    else if (arg === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (arg === '--resume') args.resume = true;
    else if (arg === '--store') args.store = true;
    else if (arg === '--html-maps') { args.htmlMaps = true; args.store = true; }
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok).length;
  const refs = samples.reduce((sum, s) => sum + (s.result?.references?.items?.length || 0), 0);
  const chars = samples.reduce((sum, s) => sum + (s.result?.answer?.text?.length || 0), 0);
  return {
    planned_samples: samples.length,
    completed_samples: samples.length,
    ok_samples: ok,
    failed_samples: samples.length - ok,
    valid_sample_rate: samples.length ? ok / samples.length : 0,
    reference_count: refs,
    answer_chars: chars,
  };
}

async function collectOne(item, outDir, resume) {
  const rawPath = path.join(outDir, 'raw', `${item.share_id}.json`);
  if (resume && fs.existsSync(rawPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
      if (existing?.ok) {
        return {
          sample_id: item.share_id,
          question_id: item.share_id,
          question: existing.question || item.share_id,
          repeat_index: 1,
          ok: true,
          status: 'done',
          reused: true,
          started_at: existing.collected_at || null,
          finished_at: existing.collected_at || null,
          duration_ms: 0,
          raw_path: path.relative(outDir, rawPath).replace(/\\/g, '/'),
          log_path: '',
          error: '',
          result: existing,
        };
      }
    } catch {
      // fall through to refetch
    }
  }

  const started = new Date();
  let result;
  try {
    let content = null;
    let normalized = null;
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        content = await fetchShareContent(item.share_id);
        normalized = normalizeShareContent(content, { share_id: item.share_id });
        if (normalized.ok && normalized.complete) break;
        lastError = normalized.ok
          ? 'share content is not complete (status/incomplete_message)'
          : 'share content has no finished assistant answer text';
      } catch (error) {
        lastError = error.message;
        content = null;
        normalized = null;
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!normalized || !normalized.ok || !normalized.complete) {
      throw new Error(lastError || 'share content was not complete after retries');
    }
    result = {
      schema_version: 'deepseek-crawler-raw/share-api-v1',
      ok: true,
      transport: 'deepseek-share-api',
      collected_at: new Date().toISOString(),
      session: item.share_id,
      question: normalized.question,
      target: '',
      search: normalized.share_meta.search_enabled,
      duration_ms: Date.now() - started.getTime(),
      answer: { text: normalized.answer_text, length: normalized.answer_text.length },
      references: {
        count: normalized.references.length,
        observed_count: normalized.references.length,
        items: normalized.references,
        verified: true,
        source: 'share-api',
      },
      share: { requested: true, created: true, share_ok: true, share_id: item.share_id, url: normalized.share_meta.share_url, content },
      share_meta: normalized.share_meta,
      structure: normalized.structure || null,
      error: '',
    };
  } catch (error) {
    result = {
      schema_version: 'deepseek-crawler-raw/share-api-v1',
      ok: false,
      transport: 'deepseek-share-api',
      collected_at: new Date().toISOString(),
      session: item.share_id,
      question: '',
      target: '',
      search: null,
      duration_ms: Date.now() - started.getTime(),
      answer: { text: '', length: 0 },
      references: { count: 0, observed_count: 0, items: [], verified: false, source: 'share-api' },
      share: { requested: true, created: false, share_ok: false, share_id: item.share_id, error: error.message },
      share_meta: null,
      structure: null,
      error: error.message,
    };
  }
  writeJson(rawPath, result);
  return {
    sample_id: item.share_id,
    question_id: item.share_id,
    question: result.question || item.share_id,
    repeat_index: 1,
    ok: result.ok,
    status: result.ok ? 'done' : 'failed',
    started_at: started.toISOString(),
    finished_at: result.collected_at,
    duration_ms: result.duration_ms,
    raw_path: path.relative(outDir, rawPath).replace(/\\/g, '/'),
    log_path: '',
    error: result.error || '',
    result,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.links) throw new Error('Missing --links <file>');
  const links = parseShareLinksInput(args.links);
  if (!links.length) throw new Error('No share ids found in --links file');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 20) {
    throw new Error('--concurrency must be an integer between 1 and 20');
  }
  const outDir = path.resolve(args.outDir || path.join(skillRoot, 'runs', `deepseek-shares-${timestampId()}`));
  fs.mkdirSync(outDir, { recursive: true });
  const run = {
    id: path.basename(outDir),
    started_at: new Date().toISOString(),
    finished_at: null,
    engine: 'deepseek',
    transport: 'deepseek-share-batch',
    sample_transports: ['deepseek-share-api'],
    dir: outDir,
  };
  const dataset = {
    schema_version: 'deepseek-crawler-web/v1',
    run,
    input: {
      question_count: links.length,
      global_repeat: 1,
      target_entity: args.targetEntity || null,
      target_aliases: args.targetAliases,
      entity_type: args.entityType || null,
      delay_strategy: { mode: 'none' },
      questions: links.map((l) => ({ id: l.share_id, index: l.source?.index || 0, question: l.share_id, repeat: 1 })),
    },
    plan: links.map((l) => ({ sample_id: l.share_id, question_id: l.share_id, question_index: 0, repeat_index: 1, repeat_total: 1, question: l.share_id })),
    samples: [],
    totals: {},
  };
  writeJson(path.join(outDir, 'deepseek-crawl.json'), dataset);

  const samples = [];
  let cursor = 0;
  const workerCount = Math.min(args.concurrency, links.length);
  async function worker() {
    while (cursor < links.length) {
      const item = links[cursor];
      cursor += 1;
      const record = await collectOne(item, outDir, args.resume);
      samples.push(record);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  samples.sort((a, b) => a.sample_id.localeCompare(b.sample_id));
  dataset.samples = samples;
  dataset.run.finished_at = new Date().toISOString();
  dataset.totals = summarize(samples);
  writeJson(path.join(outDir, 'deepseek-crawl.json'), dataset);

  const report = { ok: true, out_dir: outDir, dataset: path.join(outDir, 'deepseek-crawl.json'), totals: dataset.totals };
  if (args.store || args.htmlMaps) {
    const store = exportDatasetStore(dataset, path.join(outDir, 'store'), { sqlite: true });
    const linksExcel = writeShareLinksExcel(dataset, path.join(outDir, 'store'));
    store.share_links_excel = linksExcel.ok ? linksExcel.path : null;
    store.share_links_excel_error = linksExcel.ok ? '' : linksExcel.error;
    report.store = store;
    if (args.htmlMaps) {
      const fieldMapDir = path.join(outDir, 'store', 'field-maps');
      fs.mkdirSync(fieldMapDir, { recursive: true });
      let count = 0;
      for (const [key, sample] of collectFieldMapSamples(dataset)) {
        const html = renderFieldMapHtml(sample, dataset, { title: `DeepSeek 数据字段地图 · ${sample.question_id || sample.sample_id}` });
        if (!html) continue;
        fs.writeFileSync(path.join(fieldMapDir, `${safeFieldMapName(key)}.html`), html, 'utf8');
        count += 1;
      }
      report.field_map_count = count;
      report.field_map_dir = fieldMapDir;
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
