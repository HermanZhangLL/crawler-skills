#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseThreadRecord } from './parse_doubao_thread.mjs';
import { runOpenCli } from './opencli_runtime.mjs';

let activeWindowMode = 'background';

function parseArgs(argv) {
  const args = {
    timeout: 300,
    referenceExtraction: true,
    profile: '',
    siteSession: 'persistent',
    newConversation: true,
    completionTimeout: 600,
    pollIntervalSeconds: 8,
    stableReads: 2,
    threadCapture: true,
    completionMode: 'browser',
    browserSession: 'doubao-crawl',
    doubaoMode: 'quick',
    doubaoModeExplicit: false,
    project: String(process.env.DOUBAO_PROJECT || '').trim(),
    windowMode: String(process.env.DOUBAO_WINDOW_MODE || 'background').trim().toLowerCase(),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--prompt' || arg === '-p') args.prompt = argv[++i];
    else if (arg === '--profile') args.profile = argv[++i];
    else if (arg === '--timeout') args.timeout = Number(argv[++i]);
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--target' || arg === '--target-entity') args.target = argv[++i];
    else if (arg === '--site-session') args.siteSession = argv[++i];
    else if (arg === '--completion-timeout') args.completionTimeout = Number(argv[++i]);
    else if (arg === '--poll-interval-seconds') args.pollIntervalSeconds = Number(argv[++i]);
    else if (arg === '--stable-reads') args.stableReads = Number(argv[++i]);
    else if (arg === '--completion-mode') args.completionMode = argv[++i];
    else if (arg === '--browser-session') args.browserSession = argv[++i];
    else if (arg === '--doubao-mode') { args.doubaoMode = argv[++i]; args.doubaoModeExplicit = true; }
    else if (arg === '--project') args.project = argv[++i];
    else if (arg === '--window-mode') args.windowMode = String(argv[++i] || '').trim().toLowerCase();
    else if (arg === '--thread-url') args.threadUrl = argv[++i];
    else if (arg === '--thread-file') args.threadFile = argv[++i];
    else if (arg === '--no-thread-capture') args.threadCapture = false;
    else if (arg === '--no-search' || arg === '--no-reference-extraction') args.referenceExtraction = false;
    else if (arg === '--no-new') args.newConversation = false;
    else if (arg === '--capture-current') args.captureCurrent = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!args.prompt) args.prompt = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  activeWindowMode = String(args.windowMode || process.env.DOUBAO_WINDOW_MODE || 'background').trim().toLowerCase();
  if (activeWindowMode !== 'foreground') activeWindowMode = 'background';
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/doubao_browser_crawl.mjs --profile <profile> --prompt <question> [options]
  node scripts/doubao_browser_crawl.mjs --thread-url <thread_url|share_id> [options]

Options:
  --profile <name>          OpenCLI Browser Bridge profile alias/id.
  --timeout <seconds>       Max opencli command timeout. Default: 300.
  --completion-timeout <s>  Max seconds to wait for a stable answer. Default: 600.
  --poll-interval-seconds   Seconds between completion checks. Default: 8.
  --stable-reads <n>        Consecutive identical reads required. Default: 2.
  --completion-mode <mode>  ask, send, or browser. Default: browser.
  --browser-session <name>  Browser session name for browser mode. Default: doubao-crawl.
  --doubao-mode <mode>      quick, expert, work-turbo, or work-pro (Chinese aliases accepted). Default: quick.
  --project <name>          Move the fresh conversation into a Doubao 项目 after capture (or set DOUBAO_PROJECT).
  --window-mode <mode>      foreground or background browser window mode. Default: background (or DOUBAO_WINDOW_MODE).
  --thread-url <url|id>     Parse a Doubao thread share link (no opencli needed).
  --thread-file <json>      Parse a local share snapshot JSON (offline tests).
  --no-thread-capture       Do not look for a thread URL after asking.
  --target <text>           Optional target term to count in the answer.
  --target-entity <text>    Alias for --target.
  --site-session <mode>     OpenCLI site session: persistent or ephemeral. Default: persistent.
  --no-reference-extraction Skip visible URL extraction from the answer text.
  --no-search               Alias for --no-reference-extraction, kept for batch compatibility.
  --no-new                  Do not call opencli doubao new before asking.
  --capture-current         Capture the current Doubao conversation instead of sending.
  --out <file>              Save normalized JSON.
  -h, --help                Show help.
`);
}

function validateOptions(options) {
  if (options.help) return;
  const hasThreadInput = Boolean(options.threadUrl || options.threadFile);
  if (!options.captureCurrent && !options.prompt && !hasThreadInput) {
    throw new Error('Missing --prompt <question> or --thread-url <url>');
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
  if (!['ask', 'send', 'browser'].includes(options.completionMode)) {
    throw new Error('--completion-mode must be ask, send, or browser');
  }
  if (!['persistent', 'ephemeral'].includes(options.siteSession)) {
    throw new Error('--site-session must be persistent or ephemeral');
  }
  const normalizedMode = normalizeDoubaoMode(options.doubaoMode);
  if (!normalizedMode) throw new Error('--doubao-mode must be quick, expert, work-turbo, or work-pro (Chinese aliases accepted)');
  options.doubaoMode = normalizedMode;
}

const DOUBAO_MODE_LABELS = {
  quick: { label: '快速', matchText: '快速适用于', verifyText: '快速' },
  expert: { label: '专家', matchText: '专家研究', verifyText: '专家' },
  work_turbo: { label: '工作任务 Turbo', matchText: '工作任务 Turbo', verifyText: '工作任务 Turbo' },
  work_pro: { label: '工作任务 Pro', matchText: '工作任务 Pro', verifyText: '工作任务 Pro' },
};

const DOUBAO_MODE_ALIASES = {
  quick: 'quick',
  '快速': 'quick',
  '快速模式': 'quick',
  expert: 'expert',
  '专家': 'expert',
  '专家模式': 'expert',
  'work-turbo': 'work_turbo',
  'work_turbo': 'work_turbo',
  'workturbo': 'work_turbo',
  '工作任务': 'work_turbo',
  '工作任务 turbo': 'work_turbo',
  '工作任务turbo': 'work_turbo',
  'work-pro': 'work_pro',
  'work_pro': 'work_pro',
  'workpro': 'work_pro',
  '工作任务 pro': 'work_pro',
  '工作任务pro': 'work_pro',
  '工作任务 Pro': 'work_pro',
  '工作任务Pro': 'work_pro',
};

export function normalizeDoubaoMode(value) {
  const raw = String(value || '').trim();
  const key = raw.toLowerCase();
  return DOUBAO_MODE_ALIASES[raw] || DOUBAO_MODE_ALIASES[key] || '';
}

function findBrowserRef(session, options, findArgs) {
  try {
    const output = runBrowser(session, findArgs, { profile: options.profile });
    const parsed = parseJsonFromOpenCli(output);
    const entries = (parsed && parsed.entries) || [];
    return entries.length ? entries[0].ref : null;
  } catch {
    return null;
  }
}

async function selectDoubaoModeViaBrowser(session, options, trace) {
  if (options.completionMode !== 'browser') return false;
  const modeInfo = DOUBAO_MODE_LABELS[options.doubaoMode] || DOUBAO_MODE_LABELS.quick;
  let currentText = '';
  try {
    const check = runBrowser(session, ['eval', `(() => { const b = Array.from(document.querySelectorAll('button')).find((el) => /豆包|快速|专家|工作任务/.test(el.textContent || '') && el.getBoundingClientRect().width > 0); return b ? b.innerText.trim() : ''; })()`, '--window', 'foreground'], { profile: options.profile });
    currentText = String(check || '').trim();
  } catch {
    currentText = '';
  }
  if (currentText && currentText.includes(modeInfo.verifyText)) {
    trace.push(`doubao_mode=${options.doubaoMode}: already selected`);
    return true;
  }
  let triggerClicked = false;
  const triggerRef = findBrowserRef(session, options, ['find', '--css', '[data-valid-btn="mode-select-action-btn"] button', '--limit', '1']);
  if (triggerRef != null) {
    trace.push(runBrowser(session, ['click', String(triggerRef), '--window', 'foreground'], { profile: options.profile }));
    triggerClicked = true;
  } else {
    try {
      const triggerJs = `(() => { const b = Array.from(document.querySelectorAll('button')).find((el) => /豆包|快速|专家|工作任务/.test(el.textContent || '') && el.getBoundingClientRect().width > 0); if (b) { b.click(); return 'clicked'; } return 'not_found'; })()`;
      const result = runBrowser(session, ['eval', triggerJs, '--window', 'foreground'], { profile: options.profile });
      triggerClicked = /clicked/.test(String(result || ''));
    } catch {
      triggerClicked = false;
    }
  }
  if (!triggerClicked) {
    trace.push(`doubao_mode=${options.doubaoMode}: mode trigger not found; skip selection`);
    return false;
  }
  const deadline = Date.now() + 8000;
  let itemRef = null;
  while (Date.now() < deadline) {
    itemRef = findBrowserRef(session, options, ['find', '--role', 'menuitem', '--text', modeInfo.matchText, '--limit', '1']);
    if (itemRef != null) break;
    await sleep(400);
  }
  if (itemRef == null) {
    trace.push(`doubao_mode=${options.doubaoMode}: mode menu did not render options; keep current mode`);
    return false;
  }
  trace.push(runBrowser(session, ['click', String(itemRef), '--window', 'foreground'], { profile: options.profile }));
  let verifiedText = '';
  try {
    const check = runBrowser(session, ['eval', `(() => { const b = Array.from(document.querySelectorAll('button')).find((el) => /豆包|快速|专家|工作任务/.test(el.textContent || '') && el.getBoundingClientRect().width > 0); return b ? b.innerText.trim() : ''; })()`, '--window', 'foreground'], { profile: options.profile });
    verifiedText = String(check || '').trim();
  } catch {
    verifiedText = '';
  }
  if (!verifiedText.includes(modeInfo.verifyText)) {
    trace.push(`doubao_mode=${options.doubaoMode}: verify text mismatch (${verifiedText || 'none'}); keep current mode`);
    return false;
  }
  trace.push(`doubao_mode=${options.doubaoMode}`);
  return true;
}

function runOpenCliWithFallbackError(args, options = {}) {
  try {
    return runOpenCli(args, options);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    throw new Error(output || error.message);
  }
}

function parseJsonFromOpenCli(output) {
  const trimmed = String(output || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {}
  const arrayStart = trimmed.indexOf('[');
  const objectStart = trimmed.indexOf('{');
  const starts = [arrayStart, objectStart].filter((index) => index >= 0);
  if (!starts.length) throw new Error(`No JSON found in opencli output:\n${trimmed}`);
  const start = Math.min(...starts);
  const lastArray = trimmed.lastIndexOf(']');
  const lastObject = trimmed.lastIndexOf('}');
  const end = Math.max(lastArray, lastObject);
  if (end < start) throw new Error(`Malformed JSON in opencli output:\n${trimmed}`);
  return JSON.parse(trimmed.slice(start, end + 1));
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function multilineText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function compactOutput(value, maxLength = 5000) {
  const text = multilineText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function stableSignature(value) {
  const text = multilineText(value);
  const length = text.length;
  let hash = 0;
  for (let i = 0; i < Math.min(text.length, 2000); i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `${length}:${hash}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function testMode() {
  return Boolean(process.env.DOUBAO_OPENCLI_JS || process.env.FAKE_DOUBAO_CASE);
}

function dismissDoubaoPopups(session, options, trace) {
  const js = `(() => {
    const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const closeBtnOf = (dialog) => {
      const btns = Array.from(dialog.querySelectorAll('button'));
      const byLabel = btns.find((b) => {
        const label = String(b.getAttribute('aria-label') || '') + ' ' + String(b.textContent || '');
        return /关闭|取消|知道了|我知道了|close|dismiss/i.test(label);
      });
      if (byLabel) return byLabel;
      const byClass = btns.find((b) => /close|dismiss/i.test(String(b.className || '')));
      if (byClass) return byClass;
      const rect = dialog.getBoundingClientRect();
      const candidates = btns.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width <= 48 && r.height <= 48 && r.top < rect.top + 80 && r.left > rect.right - 80;
      });
      return candidates.length ? candidates[candidates.length - 1] : null;
    };
    const overlays = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="Modal"], [class*="popup"], [class*="Popup"]')).filter((el) => {
      if (!isVisible(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 200 && r.height >= 100;
    });
    const dismissed = [];
    for (const d of overlays) {
      const b = closeBtnOf(d);
      if (b) {
        b.click();
        dismissed.push(String(d.className || '').slice(0, 70));
      }
    }
    return JSON.stringify({ dismissed });
  })()`;
  try {
    const output = runBrowser(session, ['eval', js, '--window', 'foreground'], { profile: options.profile });
    const parsed = (() => { try { return JSON.parse(String(output || '').replace(/^"|"$/g, '')); } catch { return null; } })();
    const dismissed = (parsed && parsed.dismissed) || [];
    if (dismissed.length && trace) trace.push(`popup_dismissed=${dismissed.join(',')}`);
    return dismissed.length;
  } catch {
    return 0;
  }
}

function firstRecord(value) {
  if (Array.isArray(value)) return firstRecord(value[0]);
  if (!value || typeof value !== 'object') return value;
  for (const key of ['data', 'rows', 'result', 'results']) {
    if (Array.isArray(value[key]) && value[key].length) return firstRecord(value[key][0]);
    if (value[key] && typeof value[key] === 'object') return firstRecord(value[key]);
  }
  return value;
}

function findStringByKeys(value, keys) {
  if (!value) return '';
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  for (const key of keys) {
    if (typeof value[key] === 'string' && cleanText(value[key])) return multilineText(value[key]);
  }
  for (const child of Object.values(value)) {
    const found = findStringByKeys(child, keys);
    if (found) return found;
  }
  return '';
}

function directText(value) {
  if (!value || typeof value !== 'object') return '';
  for (const key of ['response', 'answer', 'assistant', 'content', 'Text', 'text']) {
    if (typeof value[key] === 'string' && cleanText(value[key])) return multilineText(value[key]);
  }
  return '';
}

function messageRole(value) {
  if (!value || typeof value !== 'object') return '';
  return cleanText(value.role || value.Role || value.author || value.Author).toLowerCase();
}

function extractAssistantMessage(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const found = extractAssistantMessage(value[i]);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const role = messageRole(value);
  const userRole = /user|human|用户|我|访客/.test(role);
  const assistantRole = /assistant|bot|doubao|豆包|ai|智能体/.test(role);
  const systemRole = /system|系统|tool|工具/.test(role);
  if (assistantRole && !userRole && !systemRole) {
    const text = directText(value);
    if (text) return text;
  }
  for (const key of ['messages', 'rows', 'data', 'result', 'results']) {
    if (value[key]) {
      const found = extractAssistantMessage(value[key]);
      if (found) return found;
    }
  }
  return '';
}

function extractAnswerText(parsed) {
  const assistantMessage = extractAssistantMessage(parsed);
  if (assistantMessage) return assistantMessage;
  const record = firstRecord(parsed);
  if (messageRole(record)) return '';
  const direct = findStringByKeys(record, ['response', 'answer', 'assistant', 'content', 'Text', 'text']);
  if (direct) return direct;
  if (typeof record === 'string') return multilineText(record);
  return '';
}

function extractConversation(parsed) {
  const record = firstRecord(parsed);
  const conversationId = findStringByKeys(record, ['conversationId', 'conversation_id', 'id']);
  const url = findStringByKeys(record, ['conversationUrl', 'conversation_url', 'url']);
  return {
    id: conversationId,
    url: url,
    tool: findStringByKeys(record, ['tool']),
  };
}

function extractHeadings(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, ''));
}

function countOccurrences(text, target) {
  if (!target) return null;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = text.match(new RegExp(escaped, 'gi'));
  return matches ? matches.length : 0;
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function stripTrailingPunctuation(url) {
  return String(url || '').replace(/[),\].。；;，、,.]+$/g, '');
}

function collectReferencesFromText(text) {
  const items = [];
  const seen = new Set();
  const excludedDomains = new Set(['doubao.com']);
  const add = (title, url) => {
    const cleanedUrl = stripTrailingPunctuation(url);
    const domain = domainFromUrl(cleanedUrl);
    if (!cleanedUrl || !domain || excludedDomains.has(domain)) return;
    const key = cleanedUrl.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      number: items.length + 1,
      source: domain,
      domain,
      title: cleanText(title) || domain,
      date: '',
      url: cleanedUrl,
      summary: '',
    });
  };
  const markdownLink = /\[([^\]\n]{1,220})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(markdownLink)) add(match[1], match[2]);
  const bareUrl = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of text.matchAll(bareUrl)) add('', match[0]);
  return {
    requested: true,
    count: items.length,
    items,
    note: items.length ? '' : 'No external URLs were found in the Doubao answer text.',
  };
}

function findThreadUrlInOutput(...values) {
  const joined = values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value || ''))).join(' ');
  const match = joined.match(/https:\/\/www\.doubao\.com\/thread\/[A-Za-z0-9_-]+/);
  return match ? match[0] : '';
}

function captureCurrent(options) {
  const readArgs = [
    'doubao',
    'read',
    '-f',
    'json',
    '--site-session',
    options.siteSession,
    '--keep-tab',
    'false',
  ];
  const output = runOpenCliWithFallbackError(readArgs, {
    profile: options.profile,
    timeoutMs: options.timeout * 1000,
  });
  const parsed = parseJsonFromOpenCli(output);
  return { parsed, output };
}

function readCurrentConversation(options) {
  const readArgs = [
    'doubao',
    'read',
    '-f',
    'json',
    '--site-session',
    options.siteSession,
    '--keep-tab',
    'true',
    '--window',
    'foreground',
  ];
  const output = runOpenCliWithFallbackError(readArgs, {
    profile: options.profile,
    timeoutMs: options.timeout * 1000,
  });
  const parsed = parseJsonFromOpenCli(output);
  return { parsed, output };
}

function startNewConversation(options) {
  if (!options.newConversation) return null;
  const newArgs = [
    'doubao',
    'new',
    '-f',
    'json',
    '--site-session',
    options.siteSession,
    '--keep-tab',
    'true',
    '--window',
    'foreground',
  ];
  const output = runOpenCliWithFallbackError(newArgs, {
    profile: options.profile,
    timeoutMs: 120000,
  });
  return {
    parsed: parseJsonFromOpenCli(output),
    output,
  };
}

function sendPrompt(options) {
  const args = [
    'doubao',
    'send',
    options.prompt,
    '-f',
    'json',
    '--site-session',
    options.siteSession,
    '--keep-tab',
    'true',
    '--window',
    'foreground',
  ];
  const output = runOpenCliWithFallbackError(args, {
    profile: options.profile,
    timeoutMs: 120000,
  });
  return {
    parsed: parseJsonFromOpenCli(output),
    output,
  };
}

function askDoubao(options, existingNewState = null) {
  const newConversationState = existingNewState === null ? startNewConversation(options) : existingNewState;
  const askArgs = [
    'doubao',
    'ask',
    options.prompt,
    '--timeout',
    String(Math.min(options.completionTimeout, options.timeout)),
    '-f',
    'json',
    '--site-session',
    options.siteSession,
    '--keep-tab',
    'true',
    '--window',
    'foreground',
  ];
  const output = runOpenCliWithFallbackError(askArgs, {
    profile: options.profile,
    timeoutMs: (options.completionTimeout + 45) * 1000,
  });
  const parsed = parseJsonFromOpenCli(output);
  return { parsed, output, newConversationState };
}

async function pollReadUntilStable(options) {
  const deadline = Date.now() + options.completionTimeout * 1000;
  let lastSignature = '';
  let stableCount = 0;
  let lastText = '';
  let lastParsed = null;
  let reads = 0;
  while (Date.now() < deadline) {
    reads += 1;
    let readBack = null;
    try {
      readBack = readCurrentConversation(options);
    } catch {
      readBack = null;
    }
    const text = readBack ? extractAnswerText(readBack.parsed) : '';
    const signature = stableSignature(text);
    if (text && signature === lastSignature) stableCount += 1;
    else stableCount = text ? 1 : 0;
    if (text) lastText = text;
    if (readBack) lastParsed = readBack.parsed;
    if (stableCount >= options.stableReads) {
      return { text: lastText, parsed: lastParsed, stable: true, reads };
    }
    lastSignature = signature;
    await sleep(options.pollIntervalSeconds * 1000);
  }
  return { text: lastText, parsed: lastParsed, stable: false, reads };
}

function looksLikePageChrome(text) {
  const source = cleanText(text);
  if (!source) return true;
  const compact = source.replace(/\s+/g, '');
  const exactNoise = new Set([
    '快速视频生成深入研究图像生成帮我写作音乐生成更多',
    'AI创作云盘更多历史对话',
  ]);
  if (exactNoise.has(compact)) return true;
  const uiMarkers = ['新办公任务', '历史对话', '快速帮我写作', '编程PPT', 'AI创作', '云盘更多'];
  const markerCount = uiMarkers.filter((marker) => compact.includes(marker)).length;
  return markerCount >= 3 && !/[。！？]\s*/.test(source.slice(0, 120));
}

function chooseAnswerText(primaryText, fallbackText, target = '') {
  const primary = multilineText(primaryText);
  const fallback = multilineText(fallbackText);
  const primaryIsChrome = looksLikePageChrome(primary);
  const fallbackIsChrome = looksLikePageChrome(fallback);
  if (primaryIsChrome && fallbackIsChrome) return '';
  if (primaryIsChrome) return fallback;
  if (fallbackIsChrome) return primary;
  if (!fallback) return primary;
  if (!primary) return fallback;
  if (target && !primary.includes(target) && fallback.includes(target)) return fallback;
  if (fallback.length > primary.length * 1.4) return fallback;
  return primary;
}

function failureReasonFromMessage(message) {
  const text = String(message || '');
  if (/input element|element not found|selector/i.test(text)) return 'ui_changed';
  if (/login|not logged|未登录/i.test(text)) return 'login_expired';
  if (/region|地区/i.test(text)) return 'region_blocked';
  if (/captcha|验证码|风控/i.test(text)) return 'risk_control';
  if (/network|ECONN|ETIMEDOUT|abort|timeout/i.test(text)) return 'network';
  if (/answer_incomplete/i.test(text)) return 'answer_incomplete';
  if (/window_hidden/i.test(text)) return 'window_hidden';
  if (/thread/i.test(text)) return 'thread_not_found';
  return 'unknown';
}

function failureAskRecord(options, startedAt, message, newConversationState) {
  const finishedAt = new Date().toISOString();
  return {
    ok: false,
    collected_at: finishedAt,
    engine: 'doubao',
    transport: 'opencli-doubao-adapter',
    question: options.prompt || '',
    options: {
      profile: options.profile || null,
      site_session: options.siteSession,
      reference_extraction: options.referenceExtraction,
      new_conversation: Boolean(options.newConversation && !options.captureCurrent),
      capture_current: Boolean(options.captureCurrent),
      started_at: startedAt,
      completion_timeout_seconds: options.completionTimeout,
      poll_interval_seconds: options.pollIntervalSeconds,
      stable_reads: options.stableReads,
      completion_mode: options.completionMode,
      doubao_mode: options.doubaoMode,
    },
    timing: {
      asked_at: startedAt,
      completed_at: '',
      collected_at: finishedAt,
      question_message_time: '',
      share_time: '',
    },
    page: { url: null, title: 'Doubao', conversation_id: null, thread_url: null, share_id: null },
    completion: { finished: false, signals: [] },
    answer: { text: '', brief: '' },
    suggest_questions: [],
    references: { requested: true, count: 0, items: [], note: '' },
    references_full: [],
    search_blocks: [],
    extraction: { char_count: 0, line_count: 0, headings: [], reference_count: 0, target: options.target ?? null, target_mention_count: null },
    pending_thread_capture: false,
    failure_reason: failureReasonFromMessage(message),
    error: String(message || ''),
    raw: {
      opencli_error: String(message || ''),
      new_conversation_state: newConversationState ? redactOpenCliOutput(newConversationState.parsed) : null,
    },
  };
}

function runBrowser(session, args, options = {}) {
  // Force a single, configurable window mode so background mode never steals
  // the user's focus even though many call sites historically passed --window foreground.
  const resolvedMode = windowModeValue(options);
  const cleaned = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--window') {
      i += 1;
      continue;
    }
    cleaned.push(args[i]);
  }
  return runOpenCliWithFallbackError(['browser', session, ...cleaned, '--window', resolvedMode], {
    profile: options.profile,
    timeoutMs: options.timeoutMs ?? 60000,
  });
}

function windowModeValue(options = {}) {
  const value = String(activeWindowMode || options.windowMode || process.env.DOUBAO_WINDOW_MODE || 'background').trim().toLowerCase();
  return value === 'foreground' ? 'foreground' : 'background';
}

function browserExtractContent(output) {
  try {
    const parsed = JSON.parse(String(output || '').trim());
    return String(parsed.content || '');
  } catch {
    return String(output || '');
  }
}

function trimBrowserChrome(text) {
  let trimmed = String(text || '').trim();
  const dropMarker = trimmed.indexOf('在此处拖放文件');
  if (dropMarker >= 0) trimmed = trimmed.slice(0, dropMarker).trim();
  return trimmed;
}

function restoreBrowserWindowViaOS(foregroundMode = true) {
  if (process.platform !== 'win32') return false;
  const showCmd = foregroundMode ? 3 : 8;
  const psForeground = foregroundMode ? '$true' : '$false';
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32Restore2 { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); }'
$p = Get-Process chrome | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.MainWindowTitle -match '豆包|Doubao|doubao') } | Select-Object -First 1
if (-not $p) { $p = Get-Process chrome | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if ($p) {
  [Win32Restore2]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 300
  [Win32Restore2]::ShowWindow($p.MainWindowHandle, ${showCmd}) | Out-Null
  if (${psForeground}) {
    [Win32Restore2]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  }
  Write-Output 'restored'
} else {
  Write-Output 'no-window'
}
`;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 20000 });
    return String(output || '').includes('restored');
  } catch {
    return false;
  }
}

function readBrowserWindowSize(session, options) {
  try {
    const output = runBrowser(session, ['eval', 'JSON.stringify({w: window.innerWidth, h: window.innerHeight})', '--window', 'foreground'], { profile: options.profile });
    const parsed = JSON.parse(String(output).trim());
    const width = Number(parsed.w);
    const height = Number(parsed.h);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
    return null;
  } catch {
    return null;
  }
}

function ensureBrowserWindowUsable(session, options) {
  if (readBrowserWindowSize(session, options)) return true;
  restoreBrowserWindowViaOS(windowModeValue(options) === 'foreground');
  if (readBrowserWindowSize(session, options)) return true;
  throw new Error('window_hidden: browser window has zero size and could not be restored; restore the Chrome window manually and retry');
}

function waitForSendButton(session, options, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const stateOutput = runBrowser(session, ['state', '--window', 'foreground'], { profile: options.profile });
      if (/flow-end-msg-send/.test(String(stateOutput))) return true;
    } catch {
      // ignore transient snapshot errors
    }
    sleep(1000);
  }
  return false;
}

async function sendViaBrowser(session, options, trace) {
  ensureBrowserWindowUsable(session, options);
  trace.push(runBrowser(session, ['state', '--window', 'foreground'], { profile: options.profile }));
  // Clear any leftover composer text first so a failed previous send can never
  // accumulate multiple questions into one submission.
  try {
    const clearComposerJs = `(() => {
      const el = document.querySelector('#input-engine-container [contenteditable="true"], #input-engine-container [contenteditable=true]');
      if (!el) return 'composer_not_found';
      el.focus();
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      document.execCommand('delete');
      return 'cleared:' + el.textContent.length;
    })()`;
    runBrowser(session, ['eval', clearComposerJs, '--window', 'foreground'], { profile: options.profile });
    await sleep(testMode() ? 50 : 400);
  } catch {
    // non-fatal
  }
  // Doubao's composer is now a tiptap/ProseMirror contenteditable without an
  // accessible name (the old "发消息" locator broke with the UI update). Type
  // with real keyboard events first (most reliable for tiptap), then poll until
  // the round send button is enabled and click it.
  const typeTarget = '#input-engine-container [contenteditable="true"]';
  const typeJs = `(() => {
    const el = document.querySelector('#input-engine-container [contenteditable="true"], #input-engine-container [contenteditable=true]');
    if (!(el instanceof HTMLElement)) return 'composer_not_found';
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    el.textContent = ${JSON.stringify(options.prompt)};
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(options.prompt)}, inputType: 'insertText' }));
    return 'typed';
  })()`;
  let typedAction = '';
  try {
    runBrowser(session, ['type', typeTarget, options.prompt, '--window', 'foreground'], { profile: options.profile });
    typedAction = 'typed-css';
  } catch {
    typedAction = String(runBrowser(session, ['eval', typeJs, '--window', 'foreground'], { profile: options.profile }) || '').trim();
  }
  trace.push(`composer_type=${typedAction}`);
  const sendCheckJs = `(() => {
    const btns = Array.from(document.querySelectorAll('#input-engine-container button'));
    const target = [...btns].reverse().find((b) => b instanceof HTMLElement && /rounded-full/.test(String(b.className || '')) && !b.disabled && !/disabled/.test(String(b.className || '')));
    return target ? 'enabled' : (btns.length ? 'disabled' : 'not_found');
  })()`;
  const sendJs = `(() => {
    const btns = Array.from(document.querySelectorAll('#input-engine-container button'));
    const target = [...btns].reverse().find((b) => b instanceof HTMLElement && /rounded-full/.test(String(b.className || '')) && !b.disabled && !/disabled/.test(String(b.className || '')));
    if (target) { target.click(); return 'clicked'; }
    const el = document.querySelector('#input-engine-container [contenteditable="true"], #input-engine-container [contenteditable=true]');
    if (el) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return 'enter-fallback';
    }
    return 'send_not_found';
  })()`;
  let sentAction = '';
  const sendDeadline = Date.now() + 10000;
  let unknownStates = 0;
  while (Date.now() < sendDeadline) {
    let state = '';
    try {
      state = String(runBrowser(session, ['eval', sendCheckJs, '--window', 'foreground'], { profile: options.profile }) || '').trim();
    } catch {
      state = '';
    }
    if (state === 'enabled') {
      sentAction = String(runBrowser(session, ['eval', sendJs, '--window', 'foreground'], { profile: options.profile }) || '').trim();
      if (/clicked|enter-fallback/.test(sentAction)) break;
    } else if (state === 'not_found') {
      break;
    } else if (state !== 'disabled') {
      // Unknown/unparseable send-button state (e.g., mocked browser stubs that
      // return generic JSON): bail to the legacy locator fallback instead of
      // spinning until the deadline.
      unknownStates += 1;
      if (unknownStates >= 2) break;
    }
    await sleep(500);
  }
  trace.push(`composer_send=${sentAction || 'not_sent'}`);
  if (!/clicked|enter-fallback/.test(sentAction)) {
    // Old-UI fallback.
    trace.push(runBrowser(session, ['type', '--name', '发消息', options.prompt, '--window', 'foreground'], { profile: options.profile }));
    if (!waitForSendButton(session, options)) {
      throw new Error('ui_changed: send button did not appear after typing');
    }
    trace.push(runBrowser(session, ['click', '#flow-end-msg-send', '--window', 'foreground'], { profile: options.profile }));
  }
}

export function parseSuggestQuestionsFromBrowserText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const markerIndex = lines.findIndex((line) => line.includes('相关视频'));
  const pool = markerIndex >= 0 ? lines.slice(markerIndex + 1) : lines.slice(-8);
  const questions = [];
  for (const line of pool) {
    if (!/[？?]$/.test(line)) continue;
    if (/^(相关视频|视频|推荐问题|大家还在问|猜你想问)/.test(line)) continue;
    questions.push(line);
    if (questions.length >= 5) break;
  }
  return questions;
}

export function mergeThreadEnrichment(record, threadRecord) {
  const out = { ...(record || {}) };
  if (!threadRecord || !threadRecord.ok) return out;
  const browserText = String((out.answer || {}).text || '');
  const threadText = String((threadRecord.answer || {}).text || '');
  const answerText = threadText.length >= browserText.length ? threadText : browserText;
  out.answer = {
    text: answerText,
    brief: String((threadRecord.answer || {}).brief || (out.answer || {}).brief || ''),
  };
  if ((threadRecord.references && threadRecord.references.items || []).length) {
    out.references = threadRecord.references;
  }
  if ((threadRecord.references && threadRecord.references.full || []).length) {
    out.references_full = threadRecord.references.full;
  }
  if ((threadRecord.search_blocks || []).length) out.search_blocks = threadRecord.search_blocks;
  if ((threadRecord.suggest_questions || []).length) out.suggest_questions = threadRecord.suggest_questions;
  if ((threadRecord.message_list || []).length) out.message_list = threadRecord.message_list;
  if (threadRecord.share_info) out.share_info = threadRecord.share_info;
  out.timing = { ...(out.timing || {}), ...(threadRecord.timing || {}) };
  out.page = { ...(out.page || {}), ...(threadRecord.page || {}) };
  if (!out.page.thread_url && /\/thread\//.test(out.page.url || '')) {
    out.page.thread_url = out.page.url;
  }
  if (threadRecord.completion && threadRecord.completion.finished) out.completion = threadRecord.completion;
  out.extraction = {
    ...(out.extraction || {}),
    char_count: answerText.length,
    line_count: answerText ? answerText.split(/\r?\n/).length : 0,
    reference_count: (out.references && out.references.items || []).length,
  };
  out.ok = Boolean(answerText);
  out.pending_thread_capture = false;
  out.transport = out.transport ? `${out.transport}+thread` : 'doubao-thread-http';
  out.raw = { ...(out.raw || {}), thread_snapshot: threadRecord };
  return out;
}

function readThreadLinkFromPage(session, options) {
  const js = `(() => {
    const pattern = /doubao\\.com\\/thread\\/[A-Za-z0-9_-]+/;
    const els = document.querySelectorAll('input, textarea, a[href], [data-clipboard-text]');
    for (const el of els) {
      const text = (el.value || '') + ' ' + (el.getAttribute ? (el.getAttribute('href') || el.getAttribute('data-clipboard-text') || '') : '') + ' ' + (el.innerText || '');
      const match = text.match(pattern);
      if (match) return match[0];
    }
    const body = document.body.innerText || '';
    const match = body.match(pattern);
    return match ? match[0] : '';
  })()`;
  try {
    const output = runBrowser(session, ['eval', js, '--window', 'foreground'], { profile: options.profile });
    const match = String(output || '').trim().replace(/^"|"$/g, '').match(/doubao\.com\/thread\/[A-Za-z0-9_-]+/);
    return match ? `https://${match[0]}` : '';
  } catch {
    return '';
  }
}

function readThreadLinkFromClipboard() {
  if (process.platform !== 'win32') return '';
  const script = "try { $text = Get-Clipboard -Raw -ErrorAction Stop; if ($text) { $text.Trim() } } catch { '' }";
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 10000 });
    const value = String(output || '').trim();
    const match = value.match(/doubao\.com\/thread\/[A-Za-z0-9_-]+/);
    return match ? `https://${match[0]}` : '';
  } catch {
    return '';
  }
}

function clearThreadClipboard() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', 'Set-Clipboard -Value ""'], { encoding: 'utf8', timeout: 10000, stdio: 'ignore' });
  } catch {
    // ignore
  }
}

async function tryCaptureThreadLink(session, options, conversationId, trace) {
  if (!conversationId) return '';
  const rowSelector = `#conversation_${conversationId}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const outputs = [];
    try {
      ensureBrowserWindowUsable(session, options);
      dismissDoubaoPopups(session, options, trace);
      const scrollJs = `document.getElementById('conversation_${conversationId}')?.scrollIntoView({ block: 'center', inline: 'nearest' }); 'ok'`;
      outputs.push(runBrowser(session, ['eval', scrollJs, '--window', 'foreground'], { profile: options.profile }));
    await sleep(testMode() ? 100 : 400);
      outputs.push(runBrowser(session, ['hover', rowSelector, '--window', 'foreground'], { profile: options.profile }));
    await sleep(testMode() ? 100 : 400);
      outputs.push(runBrowser(session, ['click', `${rowSelector} button[aria-haspopup=menu]`, '--window', 'foreground'], { profile: options.profile }));
    await sleep(testMode() ? 150 : 500);
      clearThreadClipboard();
      const shareClicked = await clickMenuItemByText(session, options, '复制分享链接', 3) || await clickMenuItemByText(session, options, '分享', 2);
      outputs.push(`share_menu=${shareClicked ? 'clicked' : 'not_found'}`);
    await sleep(testMode() ? 300 : 1200);
      let link = readThreadLinkFromPage(session, options) || readThreadLinkFromClipboard();
      if (!link) {
        await sleep(testMode() ? 200 : 800);
        link = readThreadLinkFromPage(session, options) || readThreadLinkFromClipboard();
      }
      if (trace) outputs.forEach((item) => trace.push(compactOutput(item)));
      try {
        runBrowser(session, ['keys', 'Escape', '--window', 'foreground'], { profile: options.profile });
      } catch {
        // ignore
      }
      if (link) return link;
    } catch {
      if (trace) outputs.forEach((item) => trace.push(compactOutput(item)));
      try {
        runBrowser(session, ['keys', 'Escape', '--window', 'foreground'], { profile: options.profile });
      } catch {
        // ignore
      }
    }
    await sleep(800);
  }
  return '';
}

async function moveConversationToProject(session, options, conversationId, projectName, trace) {
  const result = { requested: true, ok: false, project: projectName, error: '', steps: [] };
  if (!conversationId || !projectName) {
    result.error = 'conversationId or projectName missing';
    result.requested = Boolean(projectName);
    return result;
  }
  const rowSelector = `#conversation_${conversationId}`;
  try {
    ensureBrowserWindowUsable(session, options);
    dismissDoubaoPopups(session, options, trace);
    const scrollJs = `document.getElementById('conversation_${conversationId}')?.scrollIntoView({ block: 'center', inline: 'nearest' }); 'ok'`;
    result.steps.push('scroll');
    runBrowser(session, ['eval', scrollJs, '--window', 'foreground'], { profile: options.profile });
    await sleep(400);
    result.steps.push('hover');
    runBrowser(session, ['hover', rowSelector, '--window', 'foreground'], { profile: options.profile });
    await sleep(400);
    result.steps.push('open-menu');
    runBrowser(session, ['click', `${rowSelector} button[aria-haspopup=menu]`, '--window', 'foreground'], { profile: options.profile });
    await sleep(700);
    result.steps.push('move-item');
    const moveClicked = await clickMenuItemByText(session, options, '移动到项目', 4);
    if (!moveClicked) {
      result.error = 'menu item 移动到项目 not found';
      return result;
    }
    await sleep(800);
    result.steps.push('select-project');
    const projectClicked = await clickMenuItemByText(session, options, projectName, 4);
    if (!projectClicked) {
      result.error = `project item not found: ${projectName}`;
      return result;
    }
    await sleep(800);
    try {
      runBrowser(session, ['keys', 'Escape', '--window', 'foreground'], { profile: options.profile });
    } catch {
      // ignore
    }
    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    try {
      runBrowser(session, ['keys', 'Escape', '--window', 'foreground'], { profile: options.profile });
    } catch {
      // ignore
    }
  }
  if (trace) trace.push(`project_move=${result.ok ? projectName : `failed:${result.error}`}`);
  return result;
}

async function clickMenuItemByText(session, options, text, retries = 4) {
  const js = `(() => {
    const menus = Array.from(document.querySelectorAll('[role="menu"][data-state="open"]'));
    for (const menu of menus) {
      const items = Array.from(menu.querySelectorAll('[role="menuitem"], [data-radix-collection-item]'));
      const target = items.find((el) => (el.textContent || '').trim() === ${JSON.stringify(text)})
        || items.find((el) => (el.textContent || '').includes(${JSON.stringify(text)}));
      if (target) {
        target.click();
        return 'clicked';
      }
    }
    return menus.length ? 'not_found' : 'no_menu';
  })()`;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const output = runBrowser(session, ['eval', js, '--window', 'foreground'], { profile: options.profile });
      if (/clicked/.test(String(output || ''))) return true;
    } catch {
      // retry
    }
    await sleep(testMode() ? 100 : 500);
  }
  return false;
}

async function pollBrowserExtractUntilStable(options, session) {
  const deadline = Date.now() + options.completionTimeout * 1000;
  const promptKey = String(options.prompt || '__no_prompt__').replace(/\s+/g, '');
  const minTextLength = String(options.prompt || '').length + 200;
  // Doubao's new-chat welcome/intro screen ("有什么我能帮你的吗？" plus recent
  // question chips) must never be treated as an answer.
  const welcomePattern = /有什么我能帮你的吗/;
  let lastSignature = '';
  let stableCount = 0;
  let lastText = '';
  let reads = 0;
  while (Date.now() < deadline) {
    reads += 1;
    let content = '';
    try {
      const output = runBrowser(session, ['extract', '--window', 'foreground'], { profile: options.profile });
      content = browserExtractContent(output);
    } catch {
      content = '';
    }
    const text = trimBrowserChrome(content);
    const signature = stableSignature(text);
    const hasPrompt = text.replace(/\s+/g, '').includes(promptKey);
    const hasAnswer = text.length > minTextLength;
    const isWelcomeScreen = welcomePattern.test(text) && text.length < 600;
    const ready = text && hasPrompt && hasAnswer && !isWelcomeScreen;
    if (ready && signature === lastSignature) stableCount += 1;
    else stableCount = ready ? 1 : 0;
    if (text) lastText = text;
    if (stableCount >= options.stableReads) {
      return { text: lastText, stable: true, reads };
    }
    lastSignature = signature;
    await sleep(options.pollIntervalSeconds * 1000);
  }
  return { text: lastText, stable: false, reads };
}

async function askViaBrowser(options, startedAt) {
  const session = options.browserSession;
  const trace = [];
  try {
    trace.push(runBrowser(session, ['open', 'https://www.doubao.com/chat', '--window', 'foreground'], { profile: options.profile }));
    await sleep(testMode() ? 400 : 4000);
    ensureBrowserWindowUsable(session, options);
    dismissDoubaoPopups(session, options, trace);
    trace.push(runBrowser(session, ['keys', 'Control+Shift+K', '--window', 'foreground'], { profile: options.profile }));
    await sleep(testMode() ? 400 : 3000);
    dismissDoubaoPopups(session, options, trace);
    // If the shortcut did not open a conversation (URL stays /chat), click the
    // sidebar "新对话" button explicitly so the prompt always lands in a fresh chat.
    try {
      const freshCheckJs = `(() => (/\\/chat\\/(\\d+)/.test(location.href) ? 'fresh' : 'still_list'))()`;
      const freshCheck = String(runBrowser(session, ['eval', freshCheckJs, '--window', 'foreground'], { profile: options.profile }) || '');
      if (/still_list/.test(freshCheck)) {
        const newChatJs = `(() => {
          const el = Array.from(document.querySelectorAll('[role="button"], button, span, div'))
            .find((x) => (x.textContent || '').trim() === '新对话' && x.offsetParent);
          if (el) { el.click(); return 'clicked'; }
          return 'not_found';
        })()`;
        trace.push(`new_chat_fallback=${runBrowser(session, ['eval', newChatJs, '--window', 'foreground'], { profile: options.profile })}`);
        await sleep(testMode() ? 300 : 2500);
      }
    } catch {
      // non-fatal: rely on the DOM conversation-id fallback
    }
    await selectDoubaoModeViaBrowser(session, options, trace);
    dismissDoubaoPopups(session, options, trace);
    await sendViaBrowser(session, options, trace);
    const poll = await pollBrowserExtractUntilStable(options, session);
    const completedAt = new Date().toISOString();
    let conversationId = '';
    try {
      const stateOutput = runBrowser(session, ['state', '--window', 'foreground'], { profile: options.profile });
      const match = String(stateOutput).match(/https:\/\/www\.doubao\.com\/chat\/([A-Za-z0-9_-]+)/);
      if (match) conversationId = match[1];
    } catch {
      conversationId = '';
    }
    if (!conversationId) {
      // DOM fallback: Doubao may keep the URL at /chat while the conversation
      // exists client-side; read the active/latest conversation row from the sidebar.
      try {
        const domJs = `(() => {
          const links = Array.from(document.querySelectorAll('a[href^="/chat/"]'));
          const current = links.find((el) => el.getAttribute('aria-current') || (el.className || '').toString().includes('active'))
            || links[links.length - 1];
          const fromUrl = (location.href.match(/\\/chat\\/([A-Za-z0-9_-]+)/) || [])[1] || '';
          const fromLink = current ? ((current.getAttribute('href') || '').match(/\\/chat\\/([A-Za-z0-9_-]+)/) || [])[1] || '' : '';
          return JSON.stringify({ fromUrl, fromLink });
        })()`;
        const domOutput = runBrowser(session, ['eval', domJs, '--window', 'foreground'], { profile: options.profile });
        const domJson = JSON.parse(String(domOutput).trim());
        conversationId = String(domJson.fromUrl || domJson.fromLink || '');
      } catch {
        conversationId = '';
      }
    }
    if (cleanText(poll.text) && poll.stable && !conversationId) {
      // Never report a "success" without a conversation id: the thread share and
      // project move both depend on it, so the batch will retry this sample.
      return {
        ...failureAskRecord(options, startedAt, 'conversation_id_missing', poll.text),
        pending_thread_capture: false,
      };
    }
    const references = options.referenceExtraction
      ? collectReferencesFromText(poll.text)
      : { requested: false, count: 0, items: [], note: 'Reference extraction was not requested.' };
    const record = {
      ok: Boolean(cleanText(poll.text)) && poll.stable,
      collected_at: new Date().toISOString(),
      engine: 'doubao',
      transport: 'opencli-browser-ui',
      question: options.prompt || '',
      options: {
        profile: options.profile || null,
        browser_session: session,
        completion_mode: 'browser',
        doubao_mode: options.doubaoMode,
        completion_timeout_seconds: options.completionTimeout,
        poll_interval_seconds: options.pollIntervalSeconds,
        stable_reads: options.stableReads,
        started_at: startedAt,
      },
      timing: {
        asked_at: startedAt,
        completed_at: poll.stable ? completedAt : '',
        collected_at: new Date().toISOString(),
        question_message_time: '',
        share_time: '',
      },
      page: {
        url: conversationId ? `https://www.doubao.com/chat/${conversationId}` : 'https://www.doubao.com/chat',
        title: 'Doubao',
        conversation_id: conversationId || null,
        thread_url: null,
        share_id: null,
      },
      completion: {
        finished: poll.stable,
        signals: poll.stable ? [`browser_stable_reads=${options.stableReads}`] : ['answer_incomplete'],
        poll_reads: poll.reads,
      },
      answer: { text: poll.text, brief: '' },
      suggest_questions: parseSuggestQuestionsFromBrowserText(poll.text).map((content) => ({
        suggest_type: 1,
        content,
        icon_url: '',
        icon_uri: '',
        click_url: '',
        bot_id: '',
        dark_icon_url: '',
      })),
      references,
      references_full: [],
      search_blocks: [],
      extraction: {
        char_count: poll.text.length,
        line_count: poll.text ? poll.text.split(/\r?\n/).length : 0,
        headings: extractHeadings(poll.text),
        reference_count: references.count,
        target: options.target ?? null,
        target_mention_count: countOccurrences(poll.text, options.target),
      },
      pending_thread_capture: Boolean(options.threadCapture && conversationId),
      failure_reason: poll.stable ? '' : 'answer_incomplete',
      raw: {
        opencli_browser_trace: trace.map((item) => compactOutput(item)),
        opencli_browser_poll_reads: poll.reads,
      },
    };
    let finalRecord = record;
    const threadCaptureInfo = { attempted: false, link_found: false, parse_ok: false, parse_error: '' };
    if (options.threadCapture && conversationId) {
      threadCaptureInfo.attempted = true;
      const threadLink = await tryCaptureThreadLink(session, options, conversationId, trace);
      if (threadLink) {
        threadCaptureInfo.link_found = true;
        trace.push(`thread_link=${threadLink}`);
        const shareIdMatch = threadLink.match(/\/thread\/([A-Za-z0-9_-]+)/);
        let threadRecord = null;
        let lastError = '';
        for (let attempt = 1; attempt <= 3 && !threadRecord; attempt += 1) {
          const candidate = await parseThreadRecord(threadLink, {
            target: options.target,
            timeoutMs: options.timeout * 1000,
          });
          if (candidate && candidate.ok) {
            threadRecord = candidate;
          } else {
            lastError = String((candidate && (candidate.failure_reason || candidate.error)) || 'parse_failed');
            if (attempt < 3) await sleep(2000 * attempt);
          }
        }
        if (threadRecord) {
          threadCaptureInfo.parse_ok = true;
          finalRecord = mergeThreadEnrichment(record, threadRecord);
          finalRecord.failure_reason = '';
          finalRecord.error = '';
        } else {
          threadCaptureInfo.parse_error = lastError;
          finalRecord = {
            ...record,
            ok: false,
            failure_reason: record.failure_reason || 'thread_parse_failed',
            pending_thread_capture: true,
            page: { ...record.page, thread_url: threadLink, share_id: shareIdMatch ? shareIdMatch[1] : '' },
          };
          trace.push(`thread_parse_failed=${lastError}`);
        }
      } else {
        finalRecord = {
          ...record,
          ok: false,
          failure_reason: record.failure_reason || 'thread_link_failed',
          pending_thread_capture: true,
        };
      }
    }
    if (options.project) {
      const projectMove = await moveConversationToProject(session, options, conversationId, options.project, trace);
      finalRecord = { ...finalRecord, project_move: projectMove };
    }
    finalRecord.thread_capture = threadCaptureInfo;
    return finalRecord;
  } catch (error) {
    return failureAskRecord(options, startedAt, error.message || error, null);
  }
}

async function collectAskRecord(options, startedAt) {
  if (options.completionMode === 'browser') {
    return askViaBrowser(options, startedAt);
  }
  const newConversationState = startNewConversation(options);
  let raw = null;
  let sent = false;
  if (options.completionMode === 'send') {
    try {
      raw = sendPrompt(options);
      sent = true;
    } catch (sendError) {
      try {
        raw = askDoubao(options, newConversationState);
      } catch (askError) {
        return failureAskRecord(options, startedAt, askError.message || askError, newConversationState);
      }
    }
  } else {
    try {
      raw = askDoubao(options, newConversationState);
    } catch (askError) {
      return failureAskRecord(options, startedAt, askError.message || askError, newConversationState);
    }
  }
  const poll = await pollReadUntilStable(options);
  const completedAt = new Date().toISOString();
  const answerText = poll.text;
  const askText = raw ? extractAnswerText(raw.parsed) : '';
  const finalText = sent ? answerText : chooseAnswerText(askText, answerText, options.target);
  const conversation = extractConversation(poll.parsed || raw.parsed);
  const threadUrl = options.threadCapture ? findThreadUrlInOutput(raw?.output, raw?.parsed, poll.parsed) : '';
  const shareIdMatch = threadUrl.match(/\/thread\/([A-Za-z0-9_-]+)/);
  const shareId = shareIdMatch ? shareIdMatch[1] : '';
  const references = options.referenceExtraction
    ? collectReferencesFromText(finalText)
    : { requested: false, count: 0, items: [], note: 'Reference extraction was not requested.' };

  const baseOk = Boolean(cleanText(finalText)) && poll.stable;
  const record = {
    ok: baseOk && (!options.threadCapture || Boolean(threadUrl)),
    collected_at: new Date().toISOString(),
    engine: 'doubao',
    transport: 'opencli-doubao-adapter',
    question: options.prompt || '',
    options: {
      profile: options.profile || null,
      site_session: options.siteSession,
      reference_extraction: options.referenceExtraction,
      new_conversation: Boolean(options.newConversation && !options.captureCurrent),
      capture_current: Boolean(options.captureCurrent),
      started_at: startedAt,
      completion_timeout_seconds: options.completionTimeout,
      poll_interval_seconds: options.pollIntervalSeconds,
      stable_reads: options.stableReads,
      completion_mode: options.completionMode,
      doubao_mode: options.doubaoMode,
    },
    timing: {
      asked_at: startedAt,
      completed_at: poll.stable ? completedAt : '',
      collected_at: new Date().toISOString(),
      question_message_time: '',
      share_time: '',
    },
    page: {
      url: conversation.url || null,
      title: 'Doubao',
      conversation_id: conversation.id || null,
      thread_url: threadUrl || null,
      share_id: shareId || null,
    },
    completion: {
      finished: poll.stable,
      signals: poll.stable ? [`stable_reads=${options.stableReads}`] : ['answer_incomplete'],
      poll_reads: poll.reads,
    },
    answer: {
      text: finalText,
      brief: '',
    },
    suggest_questions: [],
    references,
    references_full: [],
    search_blocks: [],
    extraction: {
      char_count: finalText.length,
      line_count: finalText ? finalText.split(/\r?\n/).length : 0,
      headings: extractHeadings(finalText),
      reference_count: references.count,
      target: options.target ?? null,
      target_mention_count: countOccurrences(finalText, options.target),
    },
    pending_thread_capture: options.threadCapture && !threadUrl && Boolean(conversation.id || options.prompt),
    failure_reason: !baseOk ? 'answer_incomplete' : (options.threadCapture && !threadUrl ? 'thread_link_failed' : ''),
    raw: {
      opencli_result: raw ? redactOpenCliOutput(raw.parsed) : null,
      opencli_output_excerpt: raw ? compactOutput(raw.output) : '',
      opencli_readback_result: poll.parsed ? redactOpenCliOutput(poll.parsed) : null,
      opencli_readback_output_excerpt: '',
      new_conversation_state: newConversationState ? redactOpenCliOutput(newConversationState.parsed) : null,
      tool: conversation.tool || null,
      sent: sent,
    },
  };
  return record;
}

function redactOpenCliOutput(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactOpenCliOutput);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/cookie|session|token|authorization|password|secret|user_id|sec_uid|open_id/i.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = redactOpenCliOutput(item);
    }
    return out;
  }
  return value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  validateOptions(options);
  const startedAt = new Date().toISOString();

  if (options.threadUrl || options.threadFile) {
    const record = await parseThreadRecord(options.threadUrl || options.threadFile, {
      fromFile: Boolean(options.threadFile),
      target: options.target,
      timeoutMs: options.timeout * 1000,
    });
    record.question = record.question || options.prompt || '';
    if (options.target) {
      record.options.target = options.target;
    }
    if (options.out) {
      fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
      fs.writeFileSync(path.resolve(options.out), `${JSON.stringify(record, null, 2)}\n`);
    }
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  const record = options.captureCurrent ? null : await collectAskRecord(options, startedAt);
  let finalRecord = record;
  if (options.captureCurrent) {
    const raw = captureCurrent(options);
    const answerText = extractAnswerText(raw.parsed);
    const conversation = extractConversation(raw.parsed);
    const references = options.referenceExtraction
      ? collectReferencesFromText(answerText)
      : { requested: false, count: 0, items: [], note: 'Reference extraction was not requested.' };
    finalRecord = {
      ok: Boolean(cleanText(answerText)),
      collected_at: new Date().toISOString(),
      engine: 'doubao',
      transport: 'opencli-doubao-adapter',
      question: options.prompt || '',
      options: {
        profile: options.profile || null,
        site_session: options.siteSession,
        reference_extraction: options.referenceExtraction,
        new_conversation: false,
        capture_current: true,
        started_at: startedAt,
      },
      timing: {
        asked_at: '',
        completed_at: '',
        collected_at: new Date().toISOString(),
        question_message_time: '',
        share_time: '',
      },
      page: {
        url: conversation.url || null,
        title: 'Doubao',
        conversation_id: conversation.id || null,
        thread_url: null,
        share_id: null,
      },
      completion: { finished: false, signals: ['capture_current'] },
      answer: { text: answerText, brief: '' },
      suggest_questions: [],
      references,
      references_full: [],
      search_blocks: [],
      extraction: {
        char_count: answerText.length,
        line_count: answerText ? answerText.split(/\r?\n/).length : 0,
        headings: extractHeadings(answerText),
        reference_count: references.count,
        target: options.target ?? null,
        target_mention_count: countOccurrences(answerText, options.target),
      },
      pending_thread_capture: false,
      failure_reason: '',
      raw: {
        opencli_result: redactOpenCliOutput(raw.parsed),
        opencli_output_excerpt: compactOutput(raw.output),
      },
    };
  }

  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(path.resolve(options.out), `${JSON.stringify(finalRecord, null, 2)}\n`);
  }
  console.log(JSON.stringify(finalRecord, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
