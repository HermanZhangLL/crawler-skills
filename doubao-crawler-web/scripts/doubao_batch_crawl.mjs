#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { resolveOpenCli } from './opencli_runtime.mjs';
import { mergeThreadEnrichment, normalizeDoubaoMode } from './doubao_browser_crawl.mjs';
import { renderFieldMap } from './render_field_maps.mjs';
import { writeShareLinksExcel } from './lib/share-links-excel.mjs';

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const skillRoot = path.resolve(scriptDir, '..');
const defaultCrawlerScript = path.join(skillRoot, 'scripts', 'doubao_browser_crawl.mjs');
const MINUTE_MS = 60 * 1000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const QUESTION_LINK_HEADER = [
  'run_id',
  'sample_id',
  'question_id',
  'question',
  'repeat_index',
  'backend',
  'doubao_mode',
  'conversation_id',
  'thread_url',
  'share_id',
  'asked_at',
  'completed_at',
  'fetched_at',
  'ok',
  'status',
  'raw_path',
];

const FULL_SAMPLE_HEADER = [
  'run_id',
  'sample_id',
  'question_id',
  'question',
  'repeat_index',
  'backend',
  'doubao_mode',
  'thread_url',
  'share_id',
  'share_title',
  'conversation_id',
  'asked_at',
  'completed_at',
  'collected_at',
  'share_time',
  'ok',
  'status',
  'transport',
  'attempt_count',
  'answer_text',
  'answer_brief',
  'answer_char_count',
  'suggest_questions_json',
  'search_queries_json',
  'search_blocks_json',
  'references_count',
  'references_json',
  'references_full_json',
  'message_list_json',
  'share_info_json',
  'completion_json',
  'timing_json',
  'extraction_json',
  'pending_thread_capture',
  'failure_reason',
  'error',
  'raw_path',
  'log_path',
];

function printHelp() {
  console.log(`Usage:
  node scripts/doubao_batch_crawl.mjs --questions <file> --repeat <n> [options]
  node scripts/doubao_batch_crawl.mjs --thread-urls <file> [options]
  node scripts/doubao_batch_crawl.mjs --capture-threads --out-dir <existing-run>

Options:
  --questions <file>        Text file, JSON array of strings, or JSON array of objects.
  --thread-urls <file>      Thread share links/share_ids, one per line or JSON array.
  --repeat <n>              Global repeat count per question. Default: 1.
  --profile <name>          OpenCLI Browser Bridge profile.
  --target <text>           Optional target term passed to the underlying crawler.
  --target-entity <text>    Required for standard reports. Primary entity to diagnose.
  --target-aliases <text>   Optional aliases separated by comma, pipe, semicolon, or newline.
  --entity-type <type>      Required with --target-entity: person/company/product or 人/公司/产品.
  --site-session <mode>     OpenCLI site session: persistent or ephemeral. Default: persistent.
  --out-dir <dir>           Run output directory. Default: runs/<timestamp>; existing run dirs get a -vN version suffix instead of overwrite.
  --crawler-script <file>   Doubao crawler script. Default: scripts/doubao_browser_crawl.mjs.
  --timeout <seconds>       Opencli command timeout. Default: 300.
  --completion-timeout <s>  Max wait for a stable answer. Default: 600.
  --poll-interval-seconds   Completion poll interval. Default: 8.
  --stable-reads <n>        Consecutive stable reads required. Default: 2.
  --retry <n>               Retry failed samples within this run. Default: 0.
  --completion-mode <mode>  ask, send, or browser. Default: browser.
  --browser-session <name>  Browser session for browser mode. Default: doubao-crawl.
  --doubao-mode <mode>      quick, expert, work-turbo, or work-pro. Default: quick.
  --plan-order <order>      round (default) interleaves questions by round; question runs one question fully first.
  --create-share            After each answer, create a public thread share and parse it (default: enabled).
  --no-create-share         Disable thread share creation and parsing.
  --moderate-delay          Random 60-180 second delay between samples.
  --delay-ms <ms>           Fixed delay between samples; overrides the random default.
  --safe-random-delay       Random delay of 5-20 minutes between fresh samples.
  --delay-min-minutes <n>   Custom random delay lower bound, in minutes.
  --delay-max-minutes <n>   Custom random delay upper bound, in minutes.
  --delay-min-ms <ms>       Custom random delay lower bound, in milliseconds.
  --delay-max-ms <ms>       Custom random delay upper bound, in milliseconds.
  --defer-parse             Collect text first; parse thread snapshots later.
  --capture-threads         Second phase: fetch thread snapshots for pending samples.
  --resume                  Reuse existing raw JSON files when valid.
  --repair-shares           With --resume, re-run samples that lack a valid public thread share.
  --dry-run                 Write the plan without running Doubao.
  --no-circuit-breaker       Disable circuit breaker (skip is automatic when 3 consecutive answer_incomplete).
  --no-field-maps            Skip per-question field map HTML (default: enabled).
  --no-excel                Skip the question->share-link Excel export (default: enabled).
  --no-reference-extraction Skip visible URL extraction from answer text.
  --no-search               Alias for --no-reference-extraction, kept for compatibility.
  --no-new                  Do not request a fresh Doubao conversation before each sample.
  -h, --help                Show help.

Defaults: repeat=1, random 60-100 second delay, public thread share creation on, field maps on, Excel export on.
`);
}

function versionedOutDir(baseDir) {
  const dir = path.resolve(baseDir || path.join(skillRoot, 'runs', `doubao-${timestampId()}`));
  if (!fs.existsSync(path.join(dir, 'doubao-crawl.json'))) return dir;
  let index = 2;
  while (fs.existsSync(path.join(`${dir}-v${index}`, 'doubao-crawl.json'))) index += 1;
  return `${dir}-v${index}`;
}

function hasValidThreadShare(result) {
  if (!result || !result.ok) return false;
  const page = result.page || {};
  if (!(page.thread_url || page.share_id)) return false;
  if (result.pending_thread_capture === true) return false;
  if (result.thread_capture && result.thread_capture.parse_ok === false && !String(result.transport || '').includes('thread')) return false;
  return true;
}

function parseArgs(argv) {
  const args = {
    repeat: 1,
    timeout: 300,
    completionTimeout: 600,
    pollIntervalSeconds: 8,
    stableReads: 2,
    retry: 0,
    completionMode: 'browser',
    browserSession: 'doubao-crawl',
    doubaoMode: 'quick',
    delayMs: 1500,
    delayMinMs: 60 * 1000,
    delayMaxMs: 100 * 1000,
    planOrder: 'round',
    createShare: true,
    shareLinksExcel: true,
    repairShares: false,
    resume: false,
    dryRun: false,
    captureThreads: false,
    deferParse: false,
    profile: '',
    target: '',
    targetEntity: '',
    targetAliases: [],
    entityType: '',
    siteSession: 'persistent',
    referenceExtraction: true,
    newConversation: true,
    fieldMaps: true,
    crawlerScript: process.env.DOUBAO_CRAWLER_SCRIPT || defaultCrawlerScript,
    project: process.env.DOUBAO_PROJECT || '',
    windowMode: process.env.DOUBAO_WINDOW_MODE || '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--questions') args.questions = takeArgValue(argv, ++i, arg);
    else if (arg === '--thread-urls') args.threadUrls = takeArgValue(argv, ++i, arg);
    else if (arg === '--repeat') args.repeat = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--profile') args.profile = takeArgValue(argv, ++i, arg);
    else if (arg === '--target') args.target = takeArgValue(argv, ++i, arg);
    else if (arg === '--target-entity') args.targetEntity = takeArgValue(argv, ++i, arg);
    else if (arg === '--target-aliases') args.targetAliases = splitAliases(takeArgValue(argv, ++i, arg));
    else if (arg === '--entity-type') args.entityType = normalizeEntityType(takeArgValue(argv, ++i, arg));
    else if (arg === '--site-session') args.siteSession = takeArgValue(argv, ++i, arg);
    else if (arg === '--out-dir') args.outDir = takeArgValue(argv, ++i, arg);
    else if (arg === '--crawler-script') args.crawlerScript = takeArgValue(argv, ++i, arg);
    else if (arg === '--timeout') args.timeout = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--completion-timeout') args.completionTimeout = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--poll-interval-seconds') args.pollIntervalSeconds = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--stable-reads') args.stableReads = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--retry') args.retry = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--completion-mode') args.completionMode = takeArgValue(argv, ++i, arg);
    else if (arg === '--browser-session') args.browserSession = takeArgValue(argv, ++i, arg);
    else if (arg === '--doubao-mode') args.doubaoMode = takeArgValue(argv, ++i, arg);
    else if (arg === '--project') args.project = takeArgValue(argv, ++i, arg);
    else if (arg === '--window-mode') args.windowMode = takeArgValue(argv, ++i, arg);
    else if (arg === '--delay-ms') {
      args.delayMs = Number(takeArgValue(argv, ++i, arg));
      args.delayMinMs = null;
      args.delayMaxMs = null;
    }
    else if (arg === '--moderate-delay') {
      args.delayMinMs = 60 * 1000;
      args.delayMaxMs = 180 * 1000;
    } else if (arg === '--safe-random-delay') {
      args.delayMinMs = 5 * MINUTE_MS;
      args.delayMaxMs = 20 * MINUTE_MS;
    } else if (arg === '--delay-min-minutes') args.delayMinMs = Math.round(Number(takeArgValue(argv, ++i, arg)) * MINUTE_MS);
    else if (arg === '--delay-max-minutes') args.delayMaxMs = Math.round(Number(takeArgValue(argv, ++i, arg)) * MINUTE_MS);
    else if (arg === '--delay-min-ms') args.delayMinMs = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--delay-max-ms') args.delayMaxMs = Number(takeArgValue(argv, ++i, arg));
    else if (arg === '--plan-order') args.planOrder = takeArgValue(argv, ++i, arg).toLowerCase();
    else if (arg === '--create-share') args.createShare = true;
    else if (arg === '--no-create-share') args.createShare = false;
    else if (arg === '--no-excel') args.shareLinksExcel = false;
    else if (arg === '--resume') args.resume = true;
    else if (arg === '--repair-shares') args.repairShares = true;
    else if (arg === '--no-circuit-breaker') args.circuitBreaker = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--defer-parse') args.deferParse = true;
    else if (arg === '--capture-threads') args.captureThreads = true;
    else if (arg === '--no-search' || arg === '--no-reference-extraction') args.referenceExtraction = false;
    else if (arg === '--no-new') args.newConversation = false;
    else if (arg === '--no-field-maps') args.fieldMaps = false;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function takeArgValue(argv, index, optionName) {
  const value = argv[index];
  if (value == null || value === '' || value.startsWith('--') || value === '-h') {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function splitAliases(value) {
  return String(value || '')
    .split(/[|,，;；\n\r\t]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEntityType(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  const map = new Map([
    ['person', 'person'],
    ['people', 'person'],
    ['human', 'person'],
    ['人', 'person'],
    ['人物', 'person'],
    ['人名', 'person'],
    ['专家', 'person'],
    ['company', 'company'],
    ['brand', 'company'],
    ['organization', 'company'],
    ['org', 'company'],
    ['公司', 'company'],
    ['机构', 'company'],
    ['品牌', 'company'],
    ['服务商', 'company'],
    ['product', 'product'],
    ['tool', 'product'],
    ['产品', 'product'],
    ['工具', 'product'],
    ['平台', 'product'],
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

function isThreadInput(value) {
  const text = String(value || '').trim();
  return /^https?:\/\/(www\.)?doubao\.com\/thread\//i.test(text)
    || /^[A-Za-z0-9_-]{8,64}$/.test(text);
}

function threadUrlFromInput(value) {
  const text = String(value || '').trim();
  return /^https?:\/\//i.test(text) ? text : `https://www.doubao.com/thread/${text}`;
}

function readQuestions(file, globalRepeat, globalTarget) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const trimmed = raw.trim();
  let values;
  if (trimmed.startsWith('[')) {
    values = JSON.parse(trimmed);
  } else {
    values = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('questions must contain at least one question');
  }
  return values.map((value, index) => {
    if (typeof value === 'string') {
      const text = value.trim();
      if (isThreadInput(text)) {
        return {
          id: `q${String(index + 1).padStart(2, '0')}`,
          index: index + 1,
          question: text,
          repeat: 1,
          target: globalTarget || '',
          mode: '',
          threadUrl: threadUrlFromInput(text),
        };
      }
      return {
        id: `q${String(index + 1).padStart(2, '0')}`,
        index: index + 1,
        question: text,
        repeat: globalRepeat,
        target: globalTarget || '',
        mode: '',
      };
    }
    const question = String(value.question || value.prompt || '').trim();
    if (!question) throw new Error(`question object at index ${index} is missing question`);
    const repeat = value.repeat == null ? globalRepeat : Number(value.repeat);
    const threadUrl = value.threadUrl || (isThreadInput(question) ? threadUrlFromInput(question) : '');
    return {
      id: safeId(value.id || value.key, `q${String(index + 1).padStart(2, '0')}`),
      index: index + 1,
      question,
      repeat: threadUrl ? 1 : repeat,
      target: String(value.target || globalTarget || '').trim(),
      mode: String(value.mode || '').trim(),
      threadUrl: threadUrl || '',
    };
  });
}

function readThreadUrls(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const trimmed = raw.trim();
  let values;
  if (trimmed.startsWith('[')) {
    values = JSON.parse(trimmed);
  } else {
    values = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('thread-urls must contain at least one thread link or share_id');
  }
  return values.map((value, index) => {
    const text = typeof value === 'string' ? value.trim() : String((value && (value.url || value.thread_url || value.id)) || '').trim();
    if (!text) throw new Error(`thread-urls item at index ${index} is missing a value`);
    return {
      id: safeId(typeof value === 'object' && value.id ? value.id : `t${String(index + 1).padStart(2, '0')}`, `t${String(index + 1).padStart(2, '0')}`),
      index: index + 1,
      question: typeof value === 'object' && value.question ? String(value.question) : text,
      repeat: 1,
      target: typeof value === 'object' && value.target ? String(value.target) : '',
      mode: typeof value === 'object' && value.mode ? String(value.mode) : '',
      threadUrl: threadUrlFromInput(text),
    };
  });
}

function validateOptions(options) {
  if (options.help) return;
  if (options.captureThreads) {
    if (!options.outDir) throw new Error('--capture-threads requires --out-dir <existing run dir>');
  } else if (!options.questions && !options.threadUrls) {
    throw new Error('Missing --questions <file> or --thread-urls <file>');
  }
  if (options.targetEntity && !options.entityType) {
    throw new Error('--target-entity requires --entity-type person/company/product or 人/公司/产品');
  }
  if (options.entityType && !['person', 'company', 'product'].includes(options.entityType)) {
    throw new Error('--entity-type must be person/company/product or 人/公司/产品');
  }
  if (!['round', 'question'].includes(options.planOrder)) {
    throw new Error('--plan-order must be round or question');
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1 || options.repeat > 50) {
    throw new Error('--repeat must be an integer between 1 and 50');
  }
  if (!Number.isInteger(options.timeout) || options.timeout < 30 || options.timeout > 7200) {
    throw new Error('--timeout must be an integer between 30 and 7200');
  }
  if (!Number.isInteger(options.completionTimeout) || options.completionTimeout < 5 || options.completionTimeout > 3600) {
    throw new Error('--completion-timeout must be an integer between 5 and 3600');
  }
  if (!Number.isFinite(options.pollIntervalSeconds) || options.pollIntervalSeconds < 0 || options.pollIntervalSeconds > 120) {
    throw new Error('--poll-interval-seconds must be a number between 0 and 120');
  }
  if (!Number.isInteger(options.stableReads) || options.stableReads < 1 || options.stableReads > 10) {
    throw new Error('--stable-reads must be an integer between 1 and 10');
  }
  if (!Number.isInteger(options.retry) || options.retry < 0 || options.retry > 10) {
    throw new Error('--retry must be an integer between 0 and 10');
  }
  if (!['ask', 'send', 'browser'].includes(options.completionMode)) {
    throw new Error('--completion-mode must be ask, send, or browser');
  }
  if (!['persistent', 'ephemeral'].includes(options.siteSession)) {
    throw new Error('--site-session must be persistent or ephemeral');
  }
  const normalizedMode = normalizeDoubaoMode(options.doubaoMode);
  if (!normalizedMode) throw new Error('--doubao-mode must be quick, expert, work-turbo, or work-pro (Chinese aliases accepted)');
  options.doubaoMode = normalizedMode;
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be a non-negative integer');
  }
  const hasRandomDelay = options.delayMinMs != null || options.delayMaxMs != null;
  if (hasRandomDelay) {
    if (options.delayMinMs == null || options.delayMaxMs == null) {
      throw new Error('Random delay requires both a minimum and a maximum. Use --safe-random-delay or pass both delay bounds.');
    }
    if (!Number.isInteger(options.delayMinMs) || !Number.isInteger(options.delayMaxMs)) {
      throw new Error('Random delay bounds must resolve to integer milliseconds');
    }
    if (options.delayMinMs < 0 || options.delayMaxMs < 0) {
      throw new Error('Random delay bounds must be non-negative');
    }
    if (options.delayMinMs > options.delayMaxMs) {
      throw new Error('Random delay minimum must be less than or equal to the maximum');
    }
    if (options.delayMaxMs > MAX_DELAY_MS) {
      throw new Error('Random delay maximum must be 24 hours or less');
    }
  }
  options.crawlerScript = path.resolve(options.crawlerScript);
  if (!options.dryRun && !options.captureThreads && !fs.existsSync(options.crawlerScript)) {
    throw new Error(`Crawler script not found: ${options.crawlerScript}`);
  }
}

function makePlan(questions, order = 'round') {
  const plan = [];
  for (const item of questions) {
    if (!Number.isInteger(item.repeat) || item.repeat < 1 || item.repeat > 50) {
      throw new Error(`repeat for ${item.id} must be an integer between 1 and 50`);
    }
    for (let repeatIndex = 1; repeatIndex <= item.repeat; repeatIndex += 1) {
      plan.push({
        sample_id: `${item.id}-r${String(repeatIndex).padStart(2, '0')}`,
        question_id: item.id,
        question_index: item.index,
        repeat_index: repeatIndex,
        repeat_total: item.repeat,
        question: item.question,
        target: item.target,
        mode: item.mode || '',
        threadUrl: item.threadUrl || '',
      });
    }
  }
  if (order === 'round') {
    plan.sort((a, b) => (a.repeat_index - b.repeat_index) || (a.question_index - b.question_index));
  }
  return plan;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!remainingSeconds) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

function delayStrategy(options) {
  if (options.delayMinMs != null && options.delayMaxMs != null) {
    return {
      mode: 'random',
      min_ms: options.delayMinMs,
      max_ms: options.delayMaxMs,
      min_seconds: options.delayMinMs / 1000,
      max_seconds: options.delayMaxMs / 1000,
      min_minutes: options.delayMinMs / MINUTE_MS,
      max_minutes: options.delayMaxMs / MINUTE_MS,
    };
  }
  return {
    mode: 'fixed',
    delay_ms: options.delayMs,
    delay_seconds: options.delayMs / 1000,
    delay_minutes: options.delayMs / MINUTE_MS,
  };
}

function nextDelayMs(options, successRate = 1.0) {
  if (options.delayMinMs == null || options.delayMaxMs == null) return options.delayMs;
  let minMs = options.delayMinMs;
  let maxMs = options.delayMaxMs;
  // Conservative adaptation: keep configured range when healthy, only extend when struggling
  if (successRate < 0.7) {
    minMs = Math.round(minMs * 1.5);
    maxMs = Math.round(maxMs * 1.5);
  }
  const span = maxMs - minMs;
  return minMs + Math.floor(Math.random() * (span + 1));
}

function loadJsonIfValid(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function reusableRawResult(existing, sample, options = {}) {
  if (!existing?.ok) return { ok: false, reason: 'existing raw result had ok=false' };
  if (options.repairShares && !hasValidThreadShare(existing)) {
    return { ok: false, reason: 'existing raw result has no valid public thread share' };
  }
  const answerText = cleanText(existing.answer?.text);
  if (!answerText) return { ok: false, reason: 'existing raw result has no answer text' };
  const existingQuestion = cleanText(existing.question);
  const sampleQuestion = cleanText(sample.question);
  if (existingQuestion && existingQuestion !== sampleQuestion) {
    return { ok: false, reason: 'existing raw result question does not match current plan' };
  }
  return { ok: true, reason: '' };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function appendLog(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function questionLinkRow(runId, sample) {
  const result = sample.result || {};
  const timing = result.timing || {};
  const page = result.page || {};
  const row = {
    run_id: runId,
    sample_id: sample.sample_id,
    question_id: sample.question_id,
    question: sample.question,
    repeat_index: sample.repeat_index,
    backend: 'web',
    doubao_mode: (result.options && result.options.doubao_mode) || (result.page && result.page.doubao_mode) || sample.mode || '',
    conversation_id: page.conversation_id || '',
    thread_url: page.thread_url || sample.threadUrl || '',
    share_id: page.share_id || '',
    asked_at: timing.asked_at || sample.started_at || '',
    completed_at: timing.completed_at || sample.finished_at || '',
    fetched_at: result.collected_at || '',
    ok: sample.ok ? 'true' : 'false',
    status: sample.status || 'unknown',
    raw_path: sample.raw_path || '',
  };
  return QUESTION_LINK_HEADER.map((key) => csvEscape(row[key])).join(',');
}

function safeRemoveFile(file) {
  if (!fs.existsSync(file)) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function writeQuestionLinks(runDir, runId, samples) {
  const lines = [QUESTION_LINK_HEADER.map(csvEscape).join(',')];
  for (const sample of samples) lines.push(questionLinkRow(runId, sample));
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'question-links.csv'), `${lines.join('\n')}\n`, 'utf8');
}
function jsonCompact(value) {
  return value == null ? '' : JSON.stringify(value);
}

function extractSearchQueries(blocks) {
  const queries = [];
  for (const block of blocks || []) {
    for (const query of block.queries || []) {
      const text = String(query || '').trim();
      if (text && !queries.includes(text)) queries.push(text);
    }
  }
  return queries;
}

function fullSampleDataRow(runId, sample) {
  const result = sample.result || {};
  const timing = result.timing || {};
  const page = result.page || {};
  const answer = result.answer || {};
  const references = result.references || {};
  const refsItems = references.items || [];
  return {
    run_id: runId,
    sample_id: sample.sample_id,
    question_id: sample.question_id,
    question: sample.question,
    repeat_index: sample.repeat_index,
    backend: result.transport ? String(result.transport).split('+')[0] : 'web',
    doubao_mode: (result.options && result.options.doubao_mode) || (result.page && result.page.doubao_mode) || sample.mode || '',
    thread_url: page.thread_url || page.url || sample.threadUrl || '',
    share_id: page.share_id || '',
    share_title: page.title || (result.share_info && result.share_info.share_name) || '',
    conversation_id: page.conversation_id || '',
    asked_at: timing.asked_at || sample.started_at || '',
    completed_at: timing.completed_at || sample.finished_at || '',
    collected_at: result.collected_at || sample.finished_at || '',
    share_time: timing.share_time || '',
    ok: sample.ok ? 'true' : 'false',
    status: sample.status || '',
    transport: result.transport || '',
    attempt_count: sample.attempt_count || 1,
    answer_text: answer.text || '',
    answer_brief: answer.brief || '',
    answer_char_count: (result.extraction && result.extraction.char_count != null) ? result.extraction.char_count : String(answer.text || '').length,
    suggest_questions_json: jsonCompact(result.suggest_questions),
    search_queries_json: jsonCompact(extractSearchQueries(result.search_blocks)),
    search_blocks_json: jsonCompact(result.search_blocks),
    references_count: references.count != null ? references.count : refsItems.length,
    references_json: jsonCompact(refsItems),
    references_full_json: jsonCompact(result.references_full || references.full),
    message_list_json: jsonCompact(result.message_list),
    share_info_json: jsonCompact(result.share_info),
    completion_json: jsonCompact(result.completion),
    timing_json: jsonCompact(timing),
    extraction_json: jsonCompact(result.extraction),
    pending_thread_capture: result.pending_thread_capture ? 'true' : 'false',
    failure_reason: result.failure_reason || '',
    error: sample.error || result.error || '',
    raw_path: sample.raw_path || '',
    log_path: sample.log_path || '',
  };
}

function writeFullSampleData(outDir, runId, samples) {
  const lines = [FULL_SAMPLE_HEADER.map(csvEscape).join(',')];
  for (const sample of samples) {
    const row = fullSampleDataRow(runId, sample);
    lines.push(FULL_SAMPLE_HEADER.map((key) => csvEscape(row[key])).join(','));
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'full-sample-data.csv'), '\uFEFF' + lines.join('\n') + '\n', 'utf8');
}

function writeSampleArtifacts(outDir, runId, samples, options) {
  writeFullSampleData(outDir, runId, samples);
  if (!options.fieldMaps) return;
  const byQuestion = new Map();
  for (const sample of samples) {
    if (!sample.result) continue;
    const questionId = sample.question_id || sample.sample_id;
    const current = byQuestion.get(questionId);
    if (!current || (!current.ok && sample.ok)) byQuestion.set(questionId, sample);
  }
  for (const [questionId, sample] of byQuestion) {
    const htmlPath = path.join(outDir, 'field-maps', questionId + '-data-map.html');
    try {
      renderFieldMap(sample.result, htmlPath, {
        sampleId: sample.sample_id,
        runId,
        question: sample.question,
      });
    } catch (error) {
      appendLog(path.join(outDir, 'batch.log'), new Date().toISOString() + ' [field-map error] ' + sample.sample_id + ': ' + (error instanceof Error ? error.message : String(error)) + '\n');
    }
  }
}

function runSample(options, run, sample) {
  return new Promise((resolve) => {
    const rawPath = path.join(run.dir, 'raw', `${sample.sample_id}.json`);
    const logPath = path.join(run.dir, 'logs', `${sample.sample_id}.log`);
    const relativeRawPath = path.relative(run.dir, rawPath);
    const relativeLogPath = path.relative(run.dir, logPath);

    if (options.resume && fs.existsSync(rawPath)) {
      const existing = loadJsonIfValid(rawPath);
      const reuse = existing ? reusableRawResult(existing, sample, options) : { ok: false, reason: 'existing raw result is not valid JSON' };
      if (reuse.ok) {
        resolve({
          ...sample,
          ok: true,
          status: 'done',
          reused: true,
          started_at: existing.collected_at || null,
          finished_at: existing.collected_at || null,
          duration_ms: 0,
          raw_path: relativeRawPath,
          log_path: relativeLogPath,
          error: '',
          attempt_count: existing.attempt_count || 1,
          result: existing,
        });
        return;
      }
      appendLog(logPath, `[resume skipped] ${reuse.reason}; rerunning sample.\n`);
    }

    const childArgs = [options.crawlerScript];
    if (sample.threadUrl) {
      childArgs.push('--thread-url', sample.threadUrl);
      if (sample.mode) childArgs.push('--doubao-mode', sample.mode);
    } else {
      childArgs.push(
        '--prompt',
        sample.question,
        '--timeout',
        String(options.timeout),
        '--completion-timeout',
        String(options.completionTimeout),
        '--poll-interval-seconds',
        String(options.pollIntervalSeconds),
        '--stable-reads',
        String(options.stableReads),
        '--completion-mode',
        options.completionMode,
        '--browser-session',
        options.browserSession,
        '--doubao-mode',
        sample.mode || options.doubaoMode,
      );
      if (options.deferParse || !options.createShare) childArgs.push('--no-thread-capture');
    }
    childArgs.push('--site-session', options.siteSession, '--out', rawPath);
    if (options.profile) childArgs.push('--profile', options.profile);
    if (options.project) childArgs.push('--project', options.project);
    if (sample.target) childArgs.push('--target', sample.target);
    if (!options.referenceExtraction) childArgs.push('--no-reference-extraction');
    if (!options.newConversation && !sample.threadUrl) childArgs.push('--no-new');
    safeRemoveFile(logPath);
    appendLog(logPath, `$ node ${childArgs.map((arg) => JSON.stringify(arg)).join(' ')}\n\n`);

    const started = new Date();
    const child = spawn(process.execPath, childArgs, {
      cwd: path.resolve(path.dirname(options.crawlerScript), '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => appendLog(logPath, chunk.toString()));
    child.stderr.on('data', (chunk) => appendLog(logPath, chunk.toString()));
    child.on('error', (error) => {
      const finished = new Date();
      appendLog(logPath, `\n[spawn error] ${error.message}\n`);
      resolve({
        ...sample,
        ok: false,
        status: 'failed',
        started_at: started.toISOString(),
        finished_at: finished.toISOString(),
        duration_ms: finished.getTime() - started.getTime(),
        raw_path: relativeRawPath,
        log_path: relativeLogPath,
        error: error.message,
        result: null,
      });
    });
    child.on('close', (code) => {
      const finished = new Date();
      const result = loadJsonIfValid(rawPath);
      const ok = code === 0 && Boolean(result?.ok);
      resolve({
        ...sample,
        ok,
        status: ok ? 'done' : 'failed',
        started_at: started.toISOString(),
        finished_at: finished.toISOString(),
        duration_ms: finished.getTime() - started.getTime(),
        raw_path: relativeRawPath,
        log_path: relativeLogPath,
        error: ok ? '' : (result ? `crawler returned ok=false${result.failure_reason ? ` (${result.failure_reason})` : ''}` : `crawler exited with code ${code}`),
        result,
      });
    });
  });
}

function summarize(samples, planned) {
  const completed = samples.filter((sample) => sample.status === 'done' || sample.status === 'failed').length;
  const ok = samples.filter((sample) => sample.ok).length;
  const failed = samples.filter((sample) => sample.status === 'failed').length;
  const referenceCount = samples.reduce((sum, sample) => {
    const refs = sample.result?.references?.items || [];
    return sum + refs.length;
  }, 0);
  const answerChars = samples.reduce((sum, sample) => {
    const text = sample.result?.answer?.text || '';
    return sum + text.length;
  }, 0);
  const failureReasons = {};
  for (const sample of samples) {
    const reason = sample.result?.failure_reason || (sample.ok ? '' : 'unknown');
    failureReasons[reason] = (failureReasons[reason] || 0) + 1;
  }
  return {
    planned_samples: planned.length,
    completed_samples: completed,
    ok_samples: ok,
    failed_samples: failed,
    valid_sample_rate: planned.length ? ok / planned.length : 0,
    reference_count: referenceCount,
    answer_chars: answerChars,
    retry_count: samples.reduce((sum, sample) => sum + Math.max(0, (sample.attempt_count || 1) - 1), 0),
    pending_thread_capture: samples.filter((sample) => Boolean(sample.result?.pending_thread_capture)).length,
    thread_link_samples: samples.filter((sample) => sample.ok && Boolean(sample.result?.page?.thread_url || sample.result?.page?.share_id)).length,
    thread_parse_samples: samples.filter((sample) => sample.ok && String(sample.result?.transport || '').includes('thread')).length,
    suggest_sample_count: samples.filter((sample) => (sample.result?.suggest_questions || []).length > 0).length,
    timing_coverage: samples.filter((sample) => Boolean(sample.result?.timing?.asked_at)).length,
    failure_reasons: failureReasons,
  };
}

async function captureThreadsPhase(options) {
  const outDir = path.resolve(options.outDir);
  const datasetPath = path.join(outDir, 'doubao-crawl.json');
  const dataset = loadJsonIfValid(datasetPath);
  if (!dataset) throw new Error(`No valid doubao-crawl.json found in ${outDir}`);
  const run = dataset.run || {};
  const runId = run.run_id || run.id || 'capture-threads';
  const samples = dataset.samples || [];
  const targets = samples.filter((sample) => {
    const result = sample.result || {};
    if (result.transport === 'doubao-thread-http' && result.ok) return false;
    return Boolean((result.page && (result.page.thread_url || result.page.share_id)) || sample.threadUrl);
  });
  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, dry_run: true, out_dir: outDir, pending_samples: targets.length }, null, 2));
    return;
  }
  console.error(`[capture-threads] ${targets.length} sample(s) with a thread link`);
  for (let i = 0; i < targets.length; i += 1) {
    const sample = targets[i];
    const result = sample.result || {};
    const threadUrl = (result.page && (result.page.thread_url || (result.page.share_id ? `https://www.doubao.com/thread/${result.page.share_id}` : ''))) || sample.threadUrl;
    if (!threadUrl) continue;
    const rawPath = path.join(outDir, 'raw', `${sample.sample_id}.json`);
    const logPath = path.join(outDir, 'logs', `${sample.sample_id}.log`);
    const childArgs = [
      options.crawlerScript,
      '--thread-url',
      threadUrl,
      '--out',
      rawPath,
    ];
    if (sample.mode) childArgs.push('--doubao-mode', sample.mode);
    if (options.profile) childArgs.push('--profile', options.profile);
    appendLog(logPath, `$ node ${childArgs.map((arg) => JSON.stringify(arg)).join(' ')}\n\n`);
    const result2 = await new Promise((resolve) => {
      const child = spawn(process.execPath, childArgs, {
        cwd: path.resolve(path.dirname(options.crawlerScript), '..'),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (chunk) => appendLog(logPath, chunk.toString()));
      child.stderr.on('data', (chunk) => appendLog(logPath, chunk.toString()));
      child.on('close', (code) => resolve({ code, result: loadJsonIfValid(rawPath) }));
    });
    const parsedOk = result2.code === 0 && Boolean(result2.result?.ok);
    if (parsedOk) {
      sample.result = mergeThreadEnrichment(sample.result || {}, result2.result);
      sample.ok = true;
      sample.status = 'done';
    } else {
      sample.ok = Boolean(sample.result && sample.result.ok);
      sample.status = sample.ok ? 'done' : 'failed';
    }
    sample.finished_at = new Date().toISOString();
    sample.attempt_count = (sample.attempt_count || 1) + 1;
    dataset.totals = summarize(dataset.samples || samples, dataset.plan || samples);
    writeJson(datasetPath, dataset);
    writeQuestionLinks(outDir, runId, dataset.samples || samples);
    writeSampleArtifacts(outDir, runId, dataset.samples || samples, options);
    console.error(`[capture-threads] ${i + 1}/${targets.length} ${sample.sample_id} -> ${parsedOk ? 'ok' : 'failed'}`);
    const delayMs = nextDelayMs(options);
    if (i < targets.length - 1 && delayMs > 0) {
      console.error(`[delay] waiting ${formatDuration(delayMs)} before next capture`);
      await sleep(delayMs);
    }
  }
  dataset.run.finished_at = new Date().toISOString();
  writeJson(datasetPath, dataset);
  writeQuestionLinks(outDir, runId, dataset.samples || samples);
  writeSampleArtifacts(outDir, runId, dataset.samples || samples, options);
  let shareLinksResult = null;
  if (options.shareLinksExcel) {
    try {
      shareLinksResult = writeShareLinksExcel(dataset, outDir);
    } catch (error) {
      shareLinksResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
      appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [share-links-excel error] ${shareLinksResult.error}\n`);
    }
  }
  console.log(JSON.stringify({ ok: true, out_dir: outDir, dataset: datasetPath, share_links: shareLinksResult, totals: dataset.totals }, null, 2));
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.windowMode) process.env.DOUBAO_WINDOW_MODE = options.windowMode;
  validateOptions(options);

  if (options.captureThreads) {
    await captureThreadsPhase(options);
    return;
  }

  const crawlerTarget = options.target || options.targetEntity;
  const questions = options.threadUrls ? readThreadUrls(options.threadUrls) : readQuestions(options.questions, options.repeat, crawlerTarget);
  const plan = makePlan(questions, options.planOrder);
  const outDir = options.resume ? path.resolve(options.outDir) : versionedOutDir(options.outDir);
  const runId = safeId(path.basename(outDir), '') || `doubao-${timestampId()}`;
  let opencliVersion = '';
  if (!options.dryRun && plan.some((item) => !item.threadUrl)) {
    try {
      const runtime = resolveOpenCli();
      opencliVersion = String(
        execFileSync(runtime.command, [...runtime.args, '--version'], { encoding: 'utf8', timeout: 15000 }) || ''
      ).trim();
    } catch {
      opencliVersion = '';
    }
  }
  const run = {
    run_id: runId,
    id: runId,
    started_at: new Date().toISOString(),
    finished_at: null,
    engine: 'doubao',
    transport: options.threadUrls && !options.questions ? 'doubao-thread-http' : 'opencli-doubao-adapter',
    crawler_script: options.crawlerScript,
    opencli_version: opencliVersion || null,
    dir: outDir,
    dry_run: options.dryRun,
  };

  const dataset = {
    schema_version: 'doubao-crawler-web/v1',
    run,
    input: {
      question_count: questions.length,
      global_repeat: options.repeat,
      doubao_mode: options.doubaoMode,
      project: options.project || null,
      timeout: options.timeout,
      completion_timeout: options.completionTimeout,
      poll_interval_seconds: options.pollIntervalSeconds,
      stable_reads: options.stableReads,
      retry: options.retry,
      reference_extraction: options.referenceExtraction,
      new_conversation: options.newConversation,
      field_maps: options.fieldMaps,
      share_links_excel: options.shareLinksExcel,
      plan_order: options.planOrder,
      create_share: options.createShare,
      repair_shares: options.repairShares,
      defer_parse: options.deferParse,
      site_session: options.siteSession,
      profile: options.profile || null,
      target_entity: options.targetEntity || null,
      target_aliases: options.targetAliases,
      entity_type: options.entityType || null,
      delay_strategy: delayStrategy(options),
      out_dir: outDir,
      questions,
    },
    plan,
    samples: [],
    totals: summarize([], plan),
  };

  fs.mkdirSync(outDir, { recursive: true });
  writeJson(path.join(outDir, 'doubao-crawl.json'), dataset);
  writeQuestionLinks(outDir, runId, []);
  writeSampleArtifacts(outDir, runId, [], options);

  if (options.dryRun) {
    dataset.run.finished_at = new Date().toISOString();
    dataset.totals = summarize(dataset.samples, plan);
    writeJson(path.join(outDir, 'doubao-crawl.json'), dataset);
    console.log(JSON.stringify({ ok: true, dry_run: true, out_dir: outDir, samples: plan.length, thread_samples: plan.filter((item) => item.threadUrl).length }, null, 2));
    return;
  }

  // --- Circuit breaker state (enabled unless --no-circuit-breaker) ---
  const circuitBreakerEnabled = options.circuitBreaker !== false;
  let consecutiveIncomplete = 0;
  const INCOMPLETE_THRESHOLD = 3;
  let circuitOpen = false;
  let circuitOpenedAt = null;
  const CIRCUIT_COOLDOWN_MS = 10 * MINUTE_MS;
  const MAX_CIRCUIT_PROBES = 2;
  let circuitProbesLeft = MAX_CIRCUIT_PROBES;

  // --- Adaptive delay state ---
  const recentResults = [];
  const ADAPTIVE_WINDOW = 10;

  for (let i = 0; i < plan.length; i += 1) {
    const sample = plan[i];

    // --- Circuit breaker: skip while open ---
    if (circuitBreakerEnabled && circuitOpen) {
      const elapsed = Date.now() - circuitOpenedAt;
      if (elapsed < CIRCUIT_COOLDOWN_MS) {
        const remaining = formatDuration(CIRCUIT_COOLDOWN_MS - elapsed);
        console.error(`[circuit-breaker] OPEN -- skipping ${sample.sample_id} (${remaining} cooldown remaining)`);
        appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [circuit-breaker] OPEN skip ${sample.sample_id}\n`);
        dataset.samples.push({ ...sample, ok: false, failure_reason: 'circuit_breaker_open', error: 'circuit_breaker_open', attempt_count: 1, result: null });
        continue;
      }
      if (circuitProbesLeft <= 0) {
        console.error(`[circuit-breaker] Exhausted ${MAX_CIRCUIT_PROBES} probe opportunities. Skipping remaining ${plan.length - i} samples.`);
        appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [circuit-breaker] EXHAUSTED skipping ${plan.length - i} samples\n`);
        for (let j = i; j < plan.length; j++) {
          dataset.samples.push({ ...plan[j], ok: false, failure_reason: 'circuit_breaker_exhausted', error: 'circuit_breaker_exhausted', attempt_count: 1, result: null });
        }
        break;
      }
      console.error(`[circuit-breaker] HALF-OPEN -- probing ${sample.sample_id} (${circuitProbesLeft} probes left)`);
      appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [circuit-breaker] HALF-OPEN probe ${sample.sample_id}\n`);
      circuitProbesLeft -= 1;
    }

    console.error(`[${i + 1}/${plan.length}] ${sample.sample_id}`);
    let record = await runSample(options, run, sample);

    // --- Retry with answer_incomplete detection ---
    let attempt = 1;
    const maxAttempts = 1 + Math.max(0, options.retry);
    while (!record.ok && attempt < maxAttempts) {
      const reason = record.result?.failure_reason || record.failure_reason || '';
      if (reason === 'answer_incomplete') break;
      attempt += 1;
      appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [retry] ${sample.sample_id} attempt ${attempt}/${maxAttempts}\n`);
      const retried = await runSample({ ...options, resume: false }, run, sample);
      record = { ...retried, attempt_count: attempt };
    }
    if (record.attempt_count == null) record.attempt_count = 1;
    dataset.samples.push(record);

    // --- Update circuit breaker ---
    if (circuitBreakerEnabled) {
      const failReason = record.result?.failure_reason || record.failure_reason || '';
      if (!record.ok && failReason === 'answer_incomplete') {
        consecutiveIncomplete += 1;
        if (consecutiveIncomplete >= INCOMPLETE_THRESHOLD && !circuitOpen) {
          circuitOpen = true;
          circuitOpenedAt = Date.now();
          console.error(`[circuit-breaker] OPENED after ${consecutiveIncomplete} consecutive answer_incomplete failures. Cooling down ${CIRCUIT_COOLDOWN_MS / MINUTE_MS} minutes.`);
          appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [circuit-breaker] OPENED after ${consecutiveIncomplete} failures\n`);
        }
      } else {
        consecutiveIncomplete = 0;
        if (circuitOpen) {
          circuitOpen = false;
          circuitProbesLeft = MAX_CIRCUIT_PROBES;
          console.error(`[circuit-breaker] CLOSED -- success detected, resuming normal operation.`);
          appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [circuit-breaker] CLOSED\n`);
        }
      }
    }

    // --- Update adaptive delay ---
    recentResults.push(record.ok);
    if (recentResults.length > ADAPTIVE_WINDOW) recentResults.shift();

    dataset.totals = summarize(dataset.samples, plan);
    writeJson(path.join(outDir, 'doubao-crawl.json'), dataset);
    writeQuestionLinks(outDir, runId, dataset.samples);
    writeSampleArtifacts(outDir, runId, dataset.samples, options);
    if (i < plan.length - 1 && !record.reused) {
      const successRate = recentResults.length >= 5
        ? recentResults.filter(Boolean).length / recentResults.length
        : 1.0;
      const delayMs = nextDelayMs(options, successRate);
      if (delayMs > 0) {
        const suffix = ` (adaptive, success rate ${(successRate * 100).toFixed(0)}%)`;
        const message = `[delay] waiting ${formatDuration(delayMs)} before next sample${suffix}`;
        console.error(message);
        appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} ${message}\n`);
        await sleep(delayMs);
      }
    }
  }

  dataset.run.finished_at = new Date().toISOString();
  dataset.totals = summarize(dataset.samples, plan);
  writeJson(path.join(outDir, 'doubao-crawl.json'), dataset);
  writeQuestionLinks(outDir, runId, dataset.samples);
  writeSampleArtifacts(outDir, runId, dataset.samples, options);
  let shareLinksResult = null;
  if (options.shareLinksExcel) {
    try {
      shareLinksResult = writeShareLinksExcel(dataset, outDir);
    } catch (error) {
      shareLinksResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
      appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [share-links-excel error] ${shareLinksResult.error}\n`);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    out_dir: outDir,
    dataset: path.join(outDir, 'doubao-crawl.json'),
    question_links: path.join(outDir, 'question-links.csv'),
    full_sample_data: path.join(outDir, 'full-sample-data.csv'),
    field_maps: options.fieldMaps ? path.join(outDir, 'field-maps') : null,
    share_links: shareLinksResult,
    totals: dataset.totals,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
