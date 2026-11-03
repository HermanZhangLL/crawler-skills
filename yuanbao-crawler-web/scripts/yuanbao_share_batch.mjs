#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFieldMaps } from './lib/yuanbao-field-map.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const skillRoot = path.resolve(scriptDir, '..');
const shareAnalyzer = path.join(scriptDir, 'analyze_yuanbao_share.mjs');
const SHARE_URL_RE = /yb\.tencent\.com\/s\/([A-Za-z0-9_-]+)/i;

function printHelp() {
  console.log(`Usage:
  node scripts/yuanbao_share_batch.mjs --links <file> [options]

Options:
  --links <file>        Text file with one public share URL per line, or JSON array.
  --target-entity <text>    Optional primary entity for later analysis.
  --target-aliases <text>   Optional aliases separated by comma, pipe, semicolon, or newline.
  --entity-type <type>      Optional: person/company/product or 人/公司/产品.
  --out-dir <dir>           Run output directory. Default: runs/<timestamp>.
  --timeout <seconds>       Per-link fetch timeout. Default: 90.
  --no-field-maps           Skip per-question field map HTML (default: enabled).
  --dry-run                 Validate links without fetching share pages.
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
    timeout: 90,
    fieldMaps: true,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--links') args.links = takeValue(argv, ++i, arg);
    else if (arg === '--target-entity') args.targetEntity = takeValue(argv, ++i, arg);
    else if (arg === '--target-aliases') args.targetAliases = splitAliases(takeValue(argv, ++i, arg));
    else if (arg === '--entity-type') args.entityType = normalizeEntityType(takeValue(argv, ++i, arg));
    else if (arg === '--out-dir') args.outDir = takeValue(argv, ++i, arg);
    else if (arg === '--timeout') args.timeout = Number(takeValue(argv, ++i, arg));
    else if (arg === '--no-field-maps') args.fieldMaps = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function takeValue(argv, index, option) {
  const value = argv[index];
  if (value == null || value === '' || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function splitAliases(value) {
  return String(value || '').split(/[|,，;；\n\r\t]+/).map((s) => s.trim()).filter(Boolean);
}

function normalizeEntityType(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  const map = new Map([
    ['person', 'person'], ['people', 'person'], ['人', 'person'], ['人物', 'person'], ['专家', 'person'],
    ['company', 'company'], ['brand', 'company'], ['organization', 'company'], ['公司', 'company'], ['机构', 'company'], ['品牌', 'company'], ['服务商', 'company'],
    ['product', 'product'], ['tool', 'product'], ['产品', 'product'], ['工具', 'product'], ['平台', 'product'],
  ]);
  return map.get(raw) || map.get(key) || raw;
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
}

function safeId(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (cleaned || fallback).slice(0, 80);
}

function readLinks(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const trimmed = raw.trim();
  let values;
  if (trimmed.startsWith('[')) {
    values = JSON.parse(trimmed);
  } else {
    values = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('links must contain at least one share URL');
  }
  const seen = new Set();
  const out = [];
  for (const item of values) {
    const url = typeof item === 'string' ? item : String(item.url || item.link || '');
    const match = String(url).match(SHARE_URL_RE);
    if (!match) throw new Error(`invalid share link: ${url}`);
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url, share_id: key });
  }
  return out;
}

function domainFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeSampleResult(normalized) {
  const refs = (normalized.references || []).map((r) => ({
    number: r.index,
    doc_id: r.doc_id,
    url: r.url,
    domain: domainFromUrl(r.url),
    source: r.web_site_name || r.source_name || domainFromUrl(r.url),
    title: r.title,
    quote: r.quote,
    source_type: r.source_type,
    source_name: r.source_name,
    web_site_name: r.web_site_name,
  }));
  const chat = normalized.chat || {};
  const share = normalized.share || {};
  const answer = normalized.answer || {};
  return {
    schema_version: 'yuanbao-crawler-raw/share-public-v1',
    ok: true,
    transport: 'yuanbao-share-public',
    collected_at: normalized.collected_at || new Date().toISOString(),
    question: (normalized.question || {}).text || '',
    answer: {
      text: answer.text || '',
      char_count: answer.char_count || String(answer.text || '').length,
    },
    references: {
      count: refs.length,
      items: refs,
      verified: true,
      source: 'public-share-page',
      note: 'Parsed from the public share page __NEXT_DATA__ payload.',
    },
    conversation: {
      url: share.url || '',
      agent_id: chat.agent_id || '',
      session_id: chat.id || '',
      model: chat.chat_model_id || '',
      model_id: chat.model_id || '',
    },
    share,
    chat,
    media: normalized.media || [],
    counts: normalized.counts || {},
  };
}

async function fetchShare(args, link, outFile) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      shareAnalyzer, '--link', link.url, '--out', outFile,
    ], {
      timeout: (args.timeout + 30) * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });
    const result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error.stderr || error.message || String(error),
    };
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.links) throw new Error('Missing --links <file>');
  if (!Number.isInteger(args.timeout) || args.timeout < 10 || args.timeout > 600) {
    throw new Error('--timeout must be an integer between 10 and 600');
  }
  const links = readLinks(args.links);
  const runId = safeId(path.basename(args.outDir || ''), '') || `yuanbao-shares-${timestampId()}`;
  const outDir = path.resolve(args.outDir || path.join(skillRoot, 'runs', runId));
  const run = {
    id: runId,
    started_at: new Date().toISOString(),
    finished_at: null,
    engine: 'yuanbao',
    transport: 'share-batch-orchestrator',
    sample_transports: [],
    dir: outDir,
    dry_run: args.dryRun,
  };
  const dataset = {
    schema_version: 'yuanbao-crawler-web/v1',
    run,
    input: {
      source: 'share-links',
      question_count: 0,
      global_repeat: 1,
      timeout: args.timeout,
      profile: null,
      target_entity: args.targetEntity || null,
      target_aliases: args.targetAliases,
      entity_type: args.entityType || null,
      delay_strategy: { mode: 'none' },
      links: links.map((l) => ({ url: l.url, share_id: l.share_id })),
    },
    plan: [],
    samples: [],
    totals: {},
  };
  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, 'yuanbao-crawl.json'), dataset);

  if (args.dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, out_dir: outDir, links: links.length }, null, 2));
    return;
  }

  const questions = new Map();
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    console.error(`[${i + 1}/${links.length}] ${link.share_id}`);
    const outFile = path.join(outDir, 'raw', `${safeId(link.share_id, `share-${i + 1}`)}.json`);
    const outcome = await fetchShare(args, link, outFile);
    if (!outcome.ok) {
      dataset.samples.push({
        sample_id: `s${String(i + 1).padStart(2, '0')}`,
        question_id: `q${String(questions.size + 1).padStart(2, '0')}`,
        question: '',
        repeat_index: 1,
        repeat_total: 1,
        ok: false,
        status: 'failed',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: 0,
        raw_path: '',
        log_path: '',
        error: outcome.error,
        result: null,
      });
      continue;
    }
    const result = normalizeSampleResult(outcome.result);
    const question = result.question || link.url;
    if (!questions.has(question)) {
      questions.set(question, `q${String(questions.size + 1).padStart(2, '0')}`);
    }
    const qid = questions.get(question);
    const repeatIndex = dataset.samples.filter((s) => s.question_id === qid).length + 1;
    const sample = {
      sample_id: `${qid}-r${String(repeatIndex).padStart(2, '0')}`,
      question_id: qid,
      question,
      repeat_index: repeatIndex,
      repeat_total: 1,
      ok: true,
      status: 'done',
      started_at: result.collected_at,
      finished_at: result.collected_at,
      duration_ms: 0,
      raw_path: path.relative(outDir, outFile),
      log_path: '',
      error: '',
      result,
    };
    dataset.samples.push(sample);
    writeJson(path.join(outDir, 'yuanbao-crawl.json'), dataset);
  }

  dataset.run.finished_at = new Date().toISOString();
  dataset.input.question_count = questions.size;
  dataset.totals = {
    planned_samples: links.length,
    completed_samples: dataset.samples.length,
    ok_samples: dataset.samples.filter((s) => s.ok).length,
    failed_samples: dataset.samples.filter((s) => !s.ok).length,
    valid_sample_rate: links.length ? dataset.samples.filter((s) => s.ok).length / links.length : 0,
    reference_count: dataset.samples.reduce((sum, s) => sum + (s.result?.references?.items?.length || 0), 0),
    answer_chars: dataset.samples.reduce((sum, s) => sum + (s.result?.answer?.text?.length || 0), 0),
  };
  writeJson(path.join(outDir, 'yuanbao-crawl.json'), dataset);

  let fieldMaps = null;
  if (args.fieldMaps) {
    try {
      fieldMaps = writeFieldMaps(dataset, outDir, { titlePrefix: '腾讯元宝 分享链接数据字段地图' });
    } catch (error) {
      console.error(`[warn] field map generation failed: ${error.message}`);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    out_dir: outDir,
    dataset: path.join(outDir, 'yuanbao-crawl.json'),
    totals: dataset.totals,
    field_maps: fieldMaps ? { dir: fieldMaps.dir, count: fieldMaps.files.length } : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
