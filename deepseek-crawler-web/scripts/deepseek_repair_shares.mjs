#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { opencliExec } from './lib/opencli-command.mjs';
import { cleanText, createShare, fetchHistoryMessages, fetchShareContent, normalizeShareContent } from './lib/share-utils.mjs';
import { exportDatasetStore } from './lib/store-writer.mjs';
import { collectFieldMapSamples, renderFieldMapHtml, safeFieldMapName } from './lib/field-map-render.mjs';
import { writeShareLinksExcel } from './lib/share-links-excel.mjs';

const execFileAsync = promisify(execFile);

function printHelp() {
  console.log(`Usage:
  node scripts/deepseek_repair_shares.mjs --dataset <deepseek-crawl.json> --profile <name> [options]

Options:
  --dataset <file>          Canonical deepseek-crawl.json to repair.
  --profile <name>          OpenCLI Browser Bridge profile.
  --history-limit <n>       Max conversations to scan. Default: 200.
  --target-entity <text>    Optional: patch dataset target entity.
  --target-aliases <text>   Optional: patch target aliases (comma/pipe separated).
  --entity-type <type>      Optional: person/company/product.
  --store                   Export CSV/SQLite tables after repair.
  --html-maps               Generate field-map HTML per question after repair (implies --store).
  --window-mode <mode>      Browser window mode: foreground or background. Default: background
                            (or DEEPSEEK_WINDOW_MODE). Background never steals focus.
  -h, --help                Show help.
`);
}

function windowModeValue() {
  const raw = String(process.env.DEEPSEEK_WINDOW_MODE || 'background').trim().toLowerCase();
  return raw === 'foreground' ? 'foreground' : 'background';
}

function parseArgs(argv) {
  const args = {
    dataset: '',
    profile: '',
    historyLimit: 200,
    targetEntity: '',
    targetAliases: [],
    entityType: '',
    store: false,
    htmlMaps: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dataset') args.dataset = argv[++i] || '';
    else if (arg === '--profile') args.profile = argv[++i] || '';
    else if (arg === '--history-limit') args.historyLimit = Number(argv[++i]);
    else if (arg === '--target-entity') args.targetEntity = argv[++i] || '';
    else if (arg === '--target-aliases') args.targetAliases = String(argv[++i] || '').split(/[|,，;；]+/).map((s) => s.trim()).filter(Boolean);
    else if (arg === '--entity-type') args.entityType = argv[++i] || '';
    else if (arg === '--store') args.store = true;
    else if (arg === '--html-maps') { args.htmlMaps = true; args.store = true; }
    else if (arg === '--window-mode') {
      const mode = String(argv[++i] || '').trim().toLowerCase();
      if (mode !== 'foreground' && mode !== 'background') throw new Error('--window-mode must be foreground or background');
      process.env.DEEPSEEK_WINDOW_MODE = mode;
    }
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function runOpenCli(args, timeout = 30000) {
  const result = await execFileAsync(...opencliExec(args), { timeout, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' });
  return `${result.stdout || ''}${result.stderr || ''}`;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
  }
  const startObj = raw.indexOf('{');
  const endObj = raw.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    try { return JSON.parse(raw.slice(startObj, endObj + 1)); } catch {}
  }
  return null;
}

function base64EvalScript(js) {
  const encoded = Buffer.from(js, 'utf8').toString('base64');
  return `(async () => { const bin = atob('${encoded}'); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return eval(new TextDecoder().decode(bytes)); })()`;
}

async function getAuthToken(profile) {
  const profileArgs = profile ? ['--profile', profile] : [];
  const session = `dscw-repair-${Date.now()}`;
  try {
    await runOpenCli([...profileArgs, 'browser', session, 'bind', '--window', windowModeValue()], 15000);
  } catch {
    return '';
  }
  let token = '';
  try {
    await runOpenCli([...profileArgs, 'browser', session, 'open', 'https://chat.deepseek.com/'], 30000);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const js = `(() => { const raw = localStorage.getItem('userToken') || ''; let token = raw; try { token = JSON.parse(raw).value || raw; } catch {} return { token }; })()`;
    const out = await runOpenCli([...profileArgs, 'browser', session, 'eval', base64EvalScript(js)], 30000);
    const parsed = extractJson(out);
    if (parsed && typeof parsed.token === 'string' && parsed.token) token = parsed.token;
  } catch {
    token = '';
  }
  try {
    await runOpenCli([...profileArgs, 'browser', session, 'unbind'], 15000);
  } catch {}
  return token;
}

async function getHistory(profile, limit) {
  const profileArgs = profile ? ['--profile', profile] : [];
  const out = await runOpenCli([...profileArgs, 'deepseek', 'history', '--limit', String(limit), '-f', 'json'], 60000);
  const parsed = extractJson(out);
  return Array.isArray(parsed) ? parsed : [];
}

function lastMessageByRole(messages, role) {
  const rows = messages.filter((m) => String(m.role || '').toUpperCase() === role);
  return rows[rows.length - 1] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.dataset) throw new Error('Missing --dataset <file>');
  if (!args.profile) throw new Error('Missing --profile <name>');

  const datasetPath = path.resolve(args.dataset);
  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const samples = Array.isArray(dataset.samples) ? dataset.samples : [];
  const missing = samples.filter((s) => s.ok && !(s.result?.share?.share_id));
  if (!missing.length) {
    console.log(JSON.stringify({ ok: true, repaired: 0, message: 'no samples missing share data' }, null, 2));
    return;
  }

  const token = await getAuthToken(args.profile);
  if (!token) throw new Error('Failed to read auth token from browser; cannot create shares.');

  const history = await getHistory(args.profile, args.historyLimit);
  const missingQuestions = new Set(missing.map((s) => cleanText(s.question || s.result?.question || '').toLowerCase()));

  const candidates = [];
  for (const item of history) {
    const id = String(item.Id || '').trim();
    if (!id) continue;
    try {
      const messages = await fetchHistoryMessages(id, token);
      const lastUser = lastMessageByRole(messages, 'USER');
      const lastAssistant = lastMessageByRole(messages, 'ASSISTANT');
      const question = cleanText(lastUser?.content || '');
      if (!question || !missingQuestions.has(question.toLowerCase())) continue;
      candidates.push({
        id,
        question,
        answer: cleanText(lastAssistant?.content || ''),
        messages,
      });
    } catch {
      // skip conversations that cannot be read
    }
  }

  const byQuestion = new Map();
  for (const candidate of candidates) {
    const key = candidate.question.toLowerCase();
    if (!byQuestion.has(key)) byQuestion.set(key, []);
    byQuestion.get(key).push(candidate);
  }

  const repaired = [];
  const unmatched = [];
  const used = new Set();
  for (const sample of missing) {
    const question = cleanText(sample.question || sample.result?.question || '').toLowerCase();
    const answer = cleanText(sample.result?.answer?.text || '');
    const pool = byQuestion.get(question) || [];
    const exact = pool.find((c) => !used.has(c.id) && c.answer && c.answer === answer);
    const fallback = pool.find((c) => !used.has(c.id));
    const candidate = exact || fallback;
    if (!candidate) {
      unmatched.push(sample.sample_id);
      continue;
    }
    used.add(candidate.id);
    try {
      const messageIds = candidate.messages.map((m) => m.message_id).filter((v) => v != null && v !== '');
      const shareId = await createShare(candidate.id, messageIds, token);
      const content = await fetchShareContent(shareId);
      const normalized = normalizeShareContent(content, { share_id: shareId });
      if (!normalized.ok || !normalized.complete) throw new Error('share content not complete');
      const result = sample.result;
      result.answer = { text: normalized.answer_text, length: normalized.answer_text.length, target_mention_count: 0 };
      result.references = {
        count: normalized.references.length,
        observed_count: normalized.references.length,
        items: normalized.references,
        verified: true,
        source: 'share-api',
      };
      result.share = {
        requested: true,
        created: true,
        share_ok: true,
        share_id: shareId,
        url: normalized.share_meta.share_url,
        conversation_id: candidate.id,
        content,
      };
      result.share_meta = normalized.share_meta;
      result.structure = normalized.structure || null;
      result.error = '';
      if (args.targetEntity) result.target = args.targetEntity;
      const rawPath = path.resolve(path.dirname(datasetPath), String(sample.raw_path || ''));
      fs.mkdirSync(path.dirname(rawPath), { recursive: true });
      fs.writeFileSync(rawPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      repaired.push(sample.sample_id);
    } catch (error) {
      unmatched.push(`${sample.sample_id} (${error.message})`);
    }
  }

  if (args.targetEntity) {
    dataset.input = dataset.input || {};
    dataset.input.target_entity = args.targetEntity;
    dataset.input.target_aliases = args.targetAliases;
    dataset.input.entity_type = args.entityType || dataset.input.entity_type || '';
  }
  dataset.totals = dataset.totals || {};
  dataset.totals.samples_without_share = samples.filter((s) => s.ok && !(s.result?.share?.share_id)).length;
  fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  let store = null;
  if (args.store || args.htmlMaps) {
    const outDir = path.join(path.dirname(datasetPath), 'store');
    store = exportDatasetStore(dataset, outDir, { sqlite: true });
    const linksExcel = writeShareLinksExcel(dataset, outDir);
    store.share_links_excel = linksExcel.ok ? linksExcel.path : null;
    store.share_links_excel_error = linksExcel.ok ? '' : linksExcel.error;
    if (args.htmlMaps) {
      const fieldMapDir = path.join(outDir, 'field-maps');
      fs.mkdirSync(fieldMapDir, { recursive: true });
      let count = 0;
      for (const [key, sample] of collectFieldMapSamples(dataset)) {
        const html = renderFieldMapHtml(sample, dataset, { title: `DeepSeek 数据字段地图 · ${sample.question_id || sample.sample_id}` });
        if (!html) continue;
        fs.writeFileSync(path.join(fieldMapDir, `${safeFieldMapName(key)}.html`), html, 'utf8');
        count += 1;
      }
      store.field_map_count = count;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dataset: datasetPath,
    missing_before: missing.length,
    repaired,
    unmatched,
    totals: dataset.totals,
    store,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
