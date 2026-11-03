#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { opencliExec } from './lib/opencli-command.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);

const YUANBAO_ORIGIN = 'https://yuanbao.tencent.com';
const EXCLUDED_REFERENCE_DOMAINS = new Set([
  'yuanbao.tencent.com',
  'static.yuanbao.tencent.com',
  'avatar.yuanbao.tencent.com',
  'hy-openapi-pulbic.hunyuan.tencent.com',
  'hy-openapi.hunyuan.tencent.com',
  'cdn-yb.icon.qq.com',
  'lizhicdn.search.qq.com',
  'cdn-hybrid-prod.hunyuan.tencent.com',
]);
const YUANBAO_SESSION_RE = /\/chat\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\/|$)/i;

function printHelp() {
  console.log(`Usage:
  node scripts/yuanbao_browser_crawl.mjs --prompt <text> --out <file> [options]

Options:
  --session <id>      Temporary browser session id. Default: ybcw-<pid>.
  --prompt <text>     Prompt to send to 腾讯元宝.
  --timeout <sec>     Timeout passed to OpenCLI. Default: 600.
  --out <file>        Raw JSON output path.
  --profile <name>    OpenCLI Browser Bridge profile.
  --target <text>     Target entity recorded in output metadata.
  --no-search         Disable 腾讯元宝 internet search.
  --think             Enable 腾讯元宝 deep thinking mode. Default: quick mode.
  --create-share      After the answer, auto-create the public share link and parse full data from it (default: enabled).
  --no-create-share   Disable public share link creation and parsing.
  --model <mode>      Collection mode: quick (default), expert, or vision (expert approximates with deep thinking; vision needs adapter/UI support).
  -h, --help          Show help.

Requires:
  npm install -g @jackwener/opencli (1.8.6+ includes the yuanbao site adapter)
`);
}

function parseArgs(argv) {
  const args = {
    session: `ybcw-${process.pid}`,
    prompt: '',
    timeout: 600,
    out: '',
    profile: '',
    target: '',
    search: true,
    think: false,
    model: 'quick',
    createShare: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--session') args.session = takeValue(argv, ++i, arg);
    else if (arg === '--prompt') args.prompt = takeValue(argv, ++i, arg);
    else if (arg === '--timeout') args.timeout = Number(takeValue(argv, ++i, arg));
    else if (arg === '--out') args.out = takeValue(argv, ++i, arg);
    else if (arg === '--profile') args.profile = takeValue(argv, ++i, arg);
    else if (arg === '--target') args.target = takeValue(argv, ++i, arg);
    else if (arg === '--no-search') args.search = false;
    else if (arg === '--think') args.think = true;
    else if (arg === '--model') args.model = takeValue(argv, ++i, arg).toLowerCase();
    else if (arg === '--create-share') args.createShare = true;
    else if (arg === '--no-create-share') args.createShare = false;
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

function validate(args) {
  if (args.help) return;
  if (!args.prompt) throw new Error('Missing --prompt <text>');
  if (!args.out) throw new Error('Missing --out <file>');
  if (!Number.isInteger(args.timeout) || args.timeout < 30 || args.timeout > 1200) {
    throw new Error('--timeout must be an integer between 30 and 1200');
  }
  if (!['quick', 'expert', 'vision'].includes(args.model)) {
    throw new Error('--model must be quick, expert, or vision');
  }
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const starts = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '[' || raw[i] === '{') starts.push(i);
  }
  for (const start of starts) {
    for (let end = raw.length; end > start; end -= 1) {
      const candidate = raw.slice(start, end).trim();
      if (!candidate) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next boundary.
      }
    }
  }
  return null;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function textFingerprint(value) {
  return createHash('sha256').update(normalizeText(value), 'utf8').digest('hex');
}

function normalizeCompareText(value) {
  return normalizeText(String(value || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\[citation:\d+\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ''));
}

function countMentions(text, target) {
  const source = String(text || '');
  const needle = String(target || '').trim();
  if (!needle) return 0;
  return source.split(needle).length - 1;
}

function assistantTextFromRows(parsed) {
  if (!Array.isArray(parsed)) return '';
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    const row = parsed[i];
    if (!row || typeof row !== 'object') continue;
    const role = String(row.Role || row.role || '').toLowerCase();
    if (role.includes('assistant')) {
      const text = String(row.Text || row.text || '').trim();
      if (text) return text;
    }
  }
  return '';
}

async function runOpenCliCommand(cliArgs, timeoutMs, maxBuffer = 10 * 1024 * 1024) {
  return execFileAsync(...opencliExec(cliArgs), {
    timeout: timeoutMs,
    maxBuffer,
    env: process.env,
  });
}

async function startFreshConversation(args) {
  const cliArgs = [];
  if (args.profile) cliArgs.push('--profile', args.profile);
  cliArgs.push('yuanbao', 'new', '--window', 'foreground', '--site-session', 'persistent', '--keep-tab', 'true');
  try {
    await runOpenCliCommand(cliArgs, 60000);
    return { ok: true, error: '' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function moveConversationToGroup(args, conversationUrl) {
  const group = String(process.env.YUANBAO_GROUP || '').trim();
  const parts = String(conversationUrl || '').match(/\/chat\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/i);
  if (!group || !parts) return { ok: true, error: '', skipped: true };
  const agentId = parts[1];
  const conversationId = parts[2];
  const cliArgs = [];
  if (args.profile) cliArgs.push('--profile', args.profile);
  try {
    await runOpenCliCommand([...cliArgs, 'browser', 'site:yuanbao', 'open', 'https://yuanbao.tencent.com/chat'], 60000);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const groupJson = JSON.stringify(group);
    const resolveJs = `(() => {
      const needle = ${groupJson};
      const byName = (name) => String(name || '').trim() === needle;
      return (async () => {
        try {
          const resp = await fetch('/api/v5/projectLogic/project/get-user-projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offset: 0, page_size: 100 }),
          });
          const json = await resp.json();
          const items = (json.data && json.data.items) || [];
          const hit = items.find((p) => byName(p.name));
          if (hit && hit.project_id) return hit.project_id;
        } catch (error) { /* fall through to DOM lookup */ }
        const items = Array.from(document.querySelectorAll('.yb-project-list__item'));
        const target = items.find((el) => (el.textContent || '').includes(needle));
        return target ? (target.getAttribute('data-project-id') || '') : '';
      })();
    })()`;
    const projectIdResult = await runOpenCliCommand([...cliArgs, 'browser', 'site:yuanbao', 'eval', resolveJs], 60000);
    const rawProjectId = `${projectIdResult.stdout || ''}${projectIdResult.stderr || ''}`;
    // opencli may append an "Update available" banner to stdout; extract the
    // 32-hex project id with a regex instead of trusting the trimmed output.
    const projectIdMatch = String(rawProjectId).match(/[0-9a-f]{32}/i);
    const projectId = projectIdMatch ? projectIdMatch[0] : '';
    if (!/^[0-9a-f]{32}$/i.test(projectId)) {
      return { ok: false, error: `group project id not found (got=${projectId})` };
    }
    const moveJs = `(async () => {
      const payload = {
        agent_id: ${JSON.stringify(agentId)},
        target_project_id: ${JSON.stringify(projectId)},
        source_cid: ${JSON.stringify(conversationId)}
      };
      const resp = await fetch('/api/user/agent/conversation/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await resp.text();
      return JSON.stringify({ status: resp.status, body: text.slice(0, 500) });
    })()`;
    const moveResult = await runOpenCliCommand([...cliArgs, 'browser', 'site:yuanbao', 'eval', moveJs], 60000);
    const parsed = extractJson(`${moveResult.stdout || ''}${moveResult.stderr || ''}`);
    const status = parsed && Number(parsed.status);
    if (status !== 200) {
      return { ok: false, error: `move api returned ${status}`, detail: parsed || null };
    }
    return { ok: true, error: '', skipped: false, projectId, agentId, conversationId, status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function askYuanbao(args) {
  const cliArgs = [];
  if (args.profile) cliArgs.push('--profile', args.profile);
  cliArgs.push(
    'yuanbao',
    'ask',
    args.prompt,
    '--timeout',
    String(args.timeout),
    '--search',
    args.search ? 'true' : 'false',
    '--think',
    (args.think || args.model === 'expert') ? 'true' : 'false',
    '-f',
    'json',
    '--window',
    'foreground',
    '--site-session',
    'persistent',
    '--keep-tab',
    'true',
  );
  const started = new Date();
  try {
    const result = await runOpenCliCommand(cliArgs, (args.timeout + 45) * 1000, 30 * 1024 * 1024);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const parsed = extractJson(output);
    const answerText = assistantTextFromRows(parsed);
    return {
      ok: Boolean(answerText),
      code: 0,
      output,
      parsed,
      answerText,
      started,
      finished: new Date(),
      error: answerText ? '' : 'OpenCLI returned no assistant response text',
    };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    const parsed = extractJson(output);
    const answerText = assistantTextFromRows(parsed);
    return {
      ok: Boolean(answerText),
      code: error.code ?? 1,
      output,
      parsed,
      answerText,
      started,
      finished: new Date(),
      error: answerText ? '' : (output.trim() || error.message),
    };
  }
}

async function getYuanbaoStatus(args) {
  const cliArgs = [];
  if (args.profile) cliArgs.push('--profile', args.profile);
  cliArgs.push('yuanbao', 'status', '-f', 'json', '--keep-tab', 'true');
  try {
    const result = await runOpenCliCommand(cliArgs, 30000);
    const parsed = extractJson(`${result.stdout || ''}`);
    const record = Array.isArray(parsed) ? (parsed[0] || {}) : (parsed || {});
    return {
      url: String(record.Url || '').trim(),
      agent_id: String(record.AgentId || '').trim(),
      session_id: String(record.SessionId || '').trim(),
      model: String(record.Model || '').trim(),
      model_id: String(record.ModelId || '').trim(),
      login: String(record.Login || '').trim(),
      parsed,
      error: '',
    };
  } catch (error) {
    return {
      url: '',
      agent_id: '',
      session_id: '',
      model: '',
      model_id: '',
      login: '',
      parsed: null,
      error: error.message,
    };
  }
}

async function getRecentConversationUrl(args) {
  const cliArgs = [];
  if (args.profile) cliArgs.push('--profile', args.profile);
  cliArgs.push('yuanbao', 'history', '-f', 'json', '--limit', '1', '--keep-tab', 'false');
  try {
    const result = await runOpenCliCommand(cliArgs, 30000);
    const parsed = extractJson(`${result.stdout || ''}`);
    const rows = Array.isArray(parsed) ? parsed : [];
    for (const row of rows) {
      const url = String(row.Url || row.url || '').trim();
      if (/yuanbao\.tencent\.com\/chat\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/i.test(url)) return url;
    }
    return '';
  } catch (error) {
    return '';
  }
}

async function readCurrentConversationUrl(args) {
  const browserSession = args.session;
  const profileArgs = args.profile ? ['--profile', args.profile] : [];
  const js = `(async () => ({ href: location.href, title: document.title }))()`;
  try {
    await runOpenCliCommand([...profileArgs, 'browser', browserSession, 'bind', '--window', 'foreground'], 15000);
  } catch (error) {
    return '';
  }
  try {
    const result = await runOpenCliCommand([...profileArgs, 'browser', browserSession, 'eval', base64EvalScript(js)], 30000);
    const parsed = extractJson(`${result.stdout || ''}`);
    const href = String(parsed?.href || '').trim();
    if (/yuanbao\.tencent\.com\/chat\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/i.test(href)) return href;
    return '';
  } catch (error) {
    return '';
  } finally {
    try {
      await runOpenCliCommand([...profileArgs, 'browser', browserSession, 'unbind'], 15000);
    } catch {
      // best-effort cleanup
    }
  }
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isExcludedReferenceUrl(url) {
  const domain = hostnameFromUrl(url);
  if (!domain) return false;
  if (EXCLUDED_REFERENCE_DOMAINS.has(domain)) return true;
  if (/\.cos\.ap-[a-z0-9-]+\.myqcloud\.com$/.test(domain)) return true;
  if (domain === 'wxqcloud.qq.com.cn' || domain.endsWith('.wxqcloud.qq.com.cn')) return true;
  if (/^(thumbnail\d*|lizhicdn|hy-openapi|static|avatar)\./.test(domain) && /(yuanbao|hunyuan|search\.qq\.com|wxqcloud)/.test(domain)) return true;
  return false;
}

function stripTrailingPunctuation(url) {
  return String(url || '').replace(/[),\]。;；，、,.]+$/g, '');
}

function referenceKey(url) {
  const cleaned = stripTrailingPunctuation(url);
  try {
    const parsed = new URL(cleaned);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return cleaned.replace(/\/$/, '').toLowerCase();
  }
}

function normalizeReference(item, fallbackPosition = 'answer_text') {
  if (!item || typeof item !== 'object') return null;
  const url = stripTrailingPunctuation(String(item.url || item.href || '').trim());
  if (!url) return null;
  const domain = item.domain || hostnameFromUrl(url);
  if (!domain) return null;
  const number = Number.parseInt(String(item.number || item.num || '').replace(/\D+/g, ''), 10) || null;
  const source = String(item.source || domain || '').trim();
  const explicitTitle = String(item.title || '').trim();
  const title = explicitTitle || source || domain;
  return {
    number,
    source,
    source_origin: String(item.source_origin || (item.source ? 'browser-dom' : 'url-hostname')).trim(),
    domain: String(domain).trim(),
    title: String(title).trim(),
    title_origin: String(item.title_origin || (explicitTitle ? 'browser-dom-attribute' : '')).trim(),
    date: String(item.date || '').trim(),
    url,
    summary: String(item.summary || item.context || '').trim(),
    summary_origin: String(item.summary_origin || (item.summary || item.context ? 'answer-context' : '')).trim(),
  };
}

function collectReferencesFromText(text) {
  const items = [];
  const seen = new Set();
  const add = (title, url) => {
    if (isExcludedReferenceUrl(url)) return;
    const item = normalizeReference({ title, url, source: hostnameFromUrl(url) }, 'answer_text');
    if (!item) return;
    const key = referenceKey(item.url);
    if (seen.has(key)) return;
    seen.add(key);
    item.source_origin = 'answer-text';
    item.title_origin = title ? 'answer-text-link-label' : '';
    item.summary_origin = '';
    item.position = 'answer_text';
    items.push(item);
  };
  const markdownLink = /\[([^\]\n]{1,220})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of text.matchAll(markdownLink)) add(match[1], match[2]);
  const bareUrl = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of text.matchAll(bareUrl)) add('', match[0]);
  return items;
}

function mergeReferenceCollections(collections) {
  const merged = [];
  const byKey = new Map();
  for (const items of collections) {
    for (const item of items || []) {
      const ref = normalizeReference(item);
      if (!ref) continue;
      const key = referenceKey(ref.url);
      const existing = byKey.get(key);
      if (!existing) {
        merged.push(ref);
        byKey.set(key, ref);
        continue;
      }
      if (!existing.title || existing.title_origin === 'url-derived') {
        if (ref.title && ref.title_origin !== 'url-derived') existing.title = ref.title;
      }
      if (!existing.summary && ref.summary) existing.summary = ref.summary;
      if (!existing.date && ref.date) existing.date = ref.date;
      if (ref.source_origin === 'browser-dom' && existing.source_origin !== 'browser-dom') {
        existing.source = ref.source;
        existing.source_origin = ref.source_origin;
      }
    }
  }
  merged.forEach((item, index) => {
    item.number = index + 1;
  });
  return merged;
}

function base64EvalScript(js) {
  const encoded = Buffer.from(js, 'utf8').toString('base64');
  return `(async () => { const bin = atob('${encoded}'); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return eval(new TextDecoder().decode(bytes)); })()`;
}

function collectBrowserReferences(args, conversationUrl, expectedAnswerText) {
  if (!conversationUrl || !String(conversationUrl).startsWith(YUANBAO_ORIGIN)) {
    return Promise.resolve({
      items: [],
      verified: false,
      count_observed: 0,
      note: 'No 腾讯元宝 conversation URL was available for DOM reference extraction.',
    });
  }
  const browserSession = args.session;
  const profileArgs = args.profile ? ['--profile', args.profile] : [];
  const expectedPromptJson = JSON.stringify(args.prompt);
  const js = `(async () => {
    const expectedPrompt = ${expectedPromptJson};
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const textOf = (node) => {
      const content = node.querySelector('.hyc-content-md-done')
        || node.querySelector('.hyc-content-md')
        || node.querySelector('.agent-chat__speech-text')
        || node.querySelector('.agent-chat__bubble__content')
        || node;
      return clean(content.innerText || content.textContent || '');
    };
    if (location.origin !== '${YUANBAO_ORIGIN}') {
      return {
        href: location.href,
        title: document.title,
        prompt_matched: false,
        answer_matched: false,
        matched_prompt: '',
        conversation_id: '',
        references: []
      };
    }
    const conversationMatch = location.pathname.match(new RegExp(${JSON.stringify(YUANBAO_SESSION_RE.source)}, 'i'));
    const conversationId = conversationMatch ? conversationMatch[2].toLowerCase() : '';
    if (!conversationMatch) {
      return {
        href: location.href,
        title: document.title,
        prompt_matched: false,
        answer_matched: false,
        matched_prompt: '',
        conversation_id: '',
        references: []
      };
    }
    const humanNodes = Array.from(document.querySelectorAll('.agent-chat__list__item--human'));
    const aiNodes = Array.from(document.querySelectorAll('.agent-chat__list__item--ai'));
    const messages = [
      ...humanNodes.map((node) => ({ role: 'user', node, text: textOf(node) })),
      ...aiNodes.map((node) => ({ role: 'assistant', node, text: textOf(node) })),
    ].filter((message) => message.text);
    const expected = clean(expectedPrompt);
    const userMessage = [...messages].reverse().find((message) => message.role === 'user');
    const promptMatched = Boolean(userMessage && (
      userMessage.text === expected
      || userMessage.text.startsWith(expected)
      || expected.startsWith(userMessage.text)
      || userMessage.text.includes(expected)
    ));
    if (!userMessage || !promptMatched) {
      return {
        href: location.href,
        title: document.title,
        prompt_matched: false,
        answer_matched: false,
        matched_prompt: '',
        conversation_id: conversationId,
        references: []
      };
    }
    const userIndex = messages.indexOf(userMessage);
    const afterUser = messages.slice(userIndex + 1);
    const assistantMessage = [...afterUser].reverse().find((message) => message.role === 'assistant');
    const lastAssistantText = assistantMessage ? clean(assistantMessage.text) : '';
    if (!assistantMessage || !lastAssistantText) {
      return {
        href: location.href,
        title: document.title,
        prompt_matched: true,
        answer_matched: false,
        matched_prompt: userMessage.text,
        conversation_id: conversationId,
        last_assistant_text: '',
        read_count: 0,
        references: []
      };
    }
    const dialogueRoot = document.querySelector('.agent-dialogue__content--common, .agent-dialogue__content, .agent-dialogue, main') || document.body;
    const anchors = Array.from(assistantMessage.node.querySelectorAll('a[href^="http"]'));
    const referenceContainers = Array.from(dialogueRoot.querySelectorAll('[class*="reference" i], [class*="source" i]'));
    for (const container of referenceContainers) {
      anchors.push(...Array.from(container.querySelectorAll('a[href^="http"]')));
    }
    const seen = new Set();
    const references = [];
    for (const a of anchors) {
      const rawNum = (a.innerText || a.textContent || '').replace(/\\s+/g, '');
      const number = Number.parseInt(rawNum.replace(/\\D+/g, ''), 10) || null;
      const url = a.href || '';
      if (!url) continue;
      const key = (number || '') + '|' + url;
      if (seen.has(key)) continue;
      seen.add(key);
      let domain = '';
      try { domain = new URL(url).hostname.replace(/^www\\./, ''); } catch {}
      const contextNode = a.closest('tr,p,li,td,div') || a.parentElement;
      const context = (contextNode?.innerText || '').trim().slice(0, 500);
      const title = a.title || a.getAttribute('aria-label') || '';
      references.push({
        number,
        url,
        domain,
        source: domain,
        source_origin: 'url-hostname',
        title,
        title_origin: title ? 'browser-dom-attribute' : '',
        summary: context,
        summary_origin: context ? 'answer-context' : ''
      });
    }
    const readMatch = (assistantMessage.node.innerText || '').match(/(已阅读|参考)\\s*(\\d+)\\s*个?[网来]?[页源]?/);
    return {
      href: location.href,
      title: document.title,
      prompt_matched: true,
      answer_matched: true,
      matched_prompt: userMessage.text,
      conversation_id: conversationId,
      last_assistant_text: lastAssistantText,
      read_count: readMatch ? Number(readMatch[2] || readMatch[1]) : null,
      references
    };
  })()`;
  const bindArgs = [...profileArgs, 'browser', browserSession, 'bind', '--window', 'foreground'];
  const evalArgs = [...profileArgs, 'browser', browserSession, 'eval', base64EvalScript(js)];
  const unbindArgs = [...profileArgs, 'browser', browserSession, 'unbind'];
  const outcome = {
    items: [],
    verified: false,
    count_observed: 0,
    note: 'Browser reference extraction did not run.',
  };
  return (async () => {
    try {
      await runOpenCliCommand(bindArgs, 15000);
    } catch (error) {
      outcome.note = `Browser session bind failed: ${error.message}`;
      return outcome;
    }
    try {
      await runOpenCliCommand([...profileArgs, 'browser', browserSession, 'open', conversationUrl], 30000);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const result = await runOpenCliCommand(evalArgs, 30000, 20 * 1024 * 1024);
      const parsed = extractJson(`${result.stdout || ''}${result.stderr || ''}`);
      const pageUrl = String(parsed?.href || '').trim();
      const pageTitle = String(parsed?.title || '').trim();
      let pageOrigin = '';
      try {
        pageOrigin = new URL(pageUrl).origin;
      } catch {}
      const matchedPrompt = String(parsed?.matched_prompt || '').replace(/\s+/g, ' ').trim();
      const expectedPrompt = String(args.prompt || '').replace(/\s+/g, ' ').trim();
      const conversationId = String(parsed?.conversation_id || '').trim().toLowerCase();
      const validConversationId = /^[A-Za-z0-9_-]+$/i.test(conversationId);
      const domAnswerText = normalizeText(parsed?.last_assistant_text);
      const normalizedAnswer = normalizeCompareText(expectedAnswerText);
      const normalizedDom = normalizeCompareText(domAnswerText);
      const answerMatched = Boolean(domAnswerText && (
        textFingerprint(domAnswerText) === textFingerprint(expectedAnswerText)
        || normalizedDom === normalizedAnswer
        || (normalizedDom.length > 80 && normalizedAnswer.startsWith(normalizedDom.slice(0, 80)))
        || (normalizedAnswer.length > 80 && normalizedDom.startsWith(normalizedAnswer.slice(0, 80)))
      ));

      const promptMatched = matchedPrompt === expectedPrompt
        || matchedPrompt.startsWith(expectedPrompt)
        || expectedPrompt.startsWith(matchedPrompt)
        || matchedPrompt.includes(expectedPrompt);
      if (
        pageOrigin !== YUANBAO_ORIGIN
        || !validConversationId
        || parsed?.prompt_matched !== true
        || !promptMatched
        || !answerMatched
      ) {
        outcome.items = [];
        outcome.verified = false;
        outcome.page_url = pageUrl;
        outcome.page_title = pageTitle;
        outcome.reject_reason = [
          pageOrigin !== YUANBAO_ORIGIN ? 'origin_mismatch' : null,
          !validConversationId ? 'conversation_id_missing' : null,
          parsed?.prompt_matched !== true || !promptMatched ? 'prompt_mismatch' : null,
          !answerMatched ? 'answer_mismatch' : null,
        ].filter(Boolean).join('+');
        outcome.note = 'Browser reference extraction rejected a page that did not match the submitted 腾讯元宝 prompt and returned answer. reason=' + outcome.reject_reason;
        outcome.parsed = parsed;
        return outcome;
      }
      const items = (parsed.references || []).map((item) => normalizeReference(item, 'browser_dom')).filter(Boolean);
      outcome.count_observed = Number.isInteger(parsed?.read_count) ? parsed.read_count : items.length;
      outcome.items = items;
      outcome.verified = true;
      outcome.page_url = pageUrl;
      outcome.page_title = pageTitle;
      outcome.conversation_id = conversationId;
      outcome.answer_matched = true;
      outcome.note = items.length
        ? 'References were extracted from 腾讯元宝 citation links scoped to the submitted prompt.'
        : 'The submitted 腾讯元宝 prompt was verified, but no citation links were found in its answer.';
      return outcome;
    } catch (error) {
      outcome.items = [];
      outcome.verified = false;
      outcome.note = `Browser reference extraction failed: ${error.message}`;
      return outcome;
    } finally {
      try {
        await runOpenCliCommand(unbindArgs, 15000);
      } catch (error) {
        outcome.cleanup_error = `Browser session unbind failed: ${error.message}`;
        outcome.note = `${outcome.note} ${outcome.cleanup_error}`.trim();
      }
    }
  })();
}


function writeJson(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(data, null, 2)}\n`);
}

async function browserEvalJson(args, js, timeoutMs = 30000) {
  const profileArgs = args.profile ? ['--profile', args.profile] : [];
  const result = await runOpenCliCommand([...profileArgs, 'browser', args.session, 'eval', base64EvalScript(js)], timeoutMs);
  return extractJson(`${result.stdout || ''}${result.stderr || ''}`);
}

async function browserTabNew(args, url) {
  const profileArgs = args.profile ? ['--profile', args.profile] : [];
  const result = await runOpenCliCommand([...profileArgs, 'browser', args.session, 'tab', 'new', url], 30000);
  const parsed = extractJson(`${result.stdout || ''}`);
  return parsed && parsed.page ? parsed.page : '';
}

async function browserTabSelect(args, page) {
  const profileArgs = args.profile ? ['--profile', args.profile] : [];
  try {
    await runOpenCliCommand([...profileArgs, 'browser', args.session, 'tab', 'select', page], 30000);
  } catch (error) {
    // tab new already activates the new tab; select is best-effort. Some
    // sandboxes block the session state-file write that select performs, so
    // ignore failures here and let the subsequent eval target the active tab.
  }
}

async function browserOpenUrl(args, url) {
  const profileArgs = args.profile ? ['--profile', args.profile] : [];
  await runOpenCliCommand([...profileArgs, 'browser', args.session, 'open', url], 30000);
}


function agentIdFromUrl(url) {
  const match = String(url || '').match(/yuanbao\.tencent\.com\/chat\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : 'naQivTmsDa';
}

function shareIdFromUrl(url) {
  const match = String(url || '').match(/\/s\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

const LIST_CONVERSATIONS_JS = `(async () => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const nodes = Array.from(document.querySelectorAll('.yb-recent-conv-list__item'));
  return nodes.slice(0, 8).map((node) => ({
    title: clean(node.getAttribute('data-item-name') || node.innerText || node.textContent).slice(0, 60),
    cid: node.getAttribute('dt-cid') || '',
    agentId: node.getAttribute('dt-agent-id') || ''
  })).filter((item) => item.cid);
})()`;

const PAGE_MATCH_JS = `(async () => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const textOf = (node) => {
    const content = node.querySelector('.hyc-content-md-done')
      || node.querySelector('.hyc-content-md')
      || node.querySelector('.agent-chat__speech-text')
      || node.querySelector('.agent-chat__bubble__content')
      || node;
    return clean(content.innerText || content.textContent || '');
  };
  const human = Array.from(document.querySelectorAll('.agent-chat__list__item--human'));
  const ai = Array.from(document.querySelectorAll('.agent-chat__list__item--ai'));
  return {
    href: location.href,
    last_user: human.length ? textOf(human[human.length - 1]) : '',
    last_assistant: ai.length ? textOf(ai[ai.length - 1]) : ''
  };
})()`;

function buildCreateShareApiJs(conversationId, agentId) {
  const cidJson = JSON.stringify(conversationId || '');
  const aidJson = JSON.stringify(agentId || '');
  return `(async () => {
  const href = location.href;
  const urlMatch = href.match(/\\/chat\\/([A-Za-z0-9_-]+)\\/([A-Za-z0-9_-]+)/i);
  const conversationId = ${cidJson} || (urlMatch ? urlMatch[2] : '');
  const agentId = ${aidJson} || (urlMatch ? urlMatch[1] : '');
  if (!conversationId || !agentId) return { ok: false, error: 'no conversation url in current tab', href };
  const nickname = (() => {
    try {
      const value = localStorage.getItem('X-ID');
      if (value) return value;
    } catch {}
    const cookieMatch = document.cookie.match(/(?:^|;\\s*)hy_user=([^;]+)/);
    return cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  })();
  // Share the LAST question/answer pair of the conversation, not always the
  // first pair. On some accounts the new-chat action fails to start a fresh
  // chat and the prompt is appended to the previous conversation; the sample's
  // own Q&A is then the last pair (indexes = message count - 1, count). For a
  // normal single-Q&A conversation the last pair equals indexes 1-2.
  const humanNodes = Array.from(document.querySelectorAll('.agent-chat__list__item--human'));
  const aiNodes = Array.from(document.querySelectorAll('.agent-chat__list__item--ai'));
  const messageCount = humanNodes.length + aiNodes.length;
  const lastIndex = messageCount >= 2 ? messageCount : 2;
  const payload = {
    conversationId,
    agentId,
    conversations: [{ index: lastIndex - 1 }, { index: lastIndex }],
    selectAll: false,
    excludeIndexes: [],
    nickname,
    platform: 'WEB',
  };
  try {
    const response = await fetch('/api/conversations/v2/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const shareId = String((parsed && parsed.shareId) || '');
    return {
      ok: response.status === 200 && Boolean(shareId),
      status: response.status,
      shareId,
      response: text.slice(0, 2000),
      conversationId,
      agentId,
      href,
    };
  } catch (error) {
    return { ok: false, error: String(error), href };
  }
})()`;
}

const SHARE_BAR_CAPTURE_JS = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  window.__shareCap = { text: '', shareId: '', raw: '' };
  const captureBody = (body) => {
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed && parsed.shareId) {
        window.__shareCap.shareId = String(parsed.shareId);
        window.__shareCap.raw = String(body || '').slice(0, 2000);
      }
    } catch {}
  };
  const installHooks = () => {
    try { navigator.clipboard.writeText = (value) => { window.__shareCap.text = String(value || ''); return Promise.resolve(); }; } catch {}
    try {
      navigator.clipboard.write = (items) => {
        try {
          const item = items && items[0];
          if (item && typeof item.getType === 'function') {
            item.getType('text/plain').then((blob) => blob.text().then((value) => { window.__shareCap.text = value; })).catch(() => {});
          }
        } catch {}
        return Promise.resolve();
      };
    } catch {}
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ybShareUrl = String(url || '');
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', () => {
        try {
          const body = String(this.responseText || '');
          if (/share/i.test(this.__ybShareUrl || '') && /shareId/i.test(body)) captureBody(body);
        } catch {}
      });
      return origSend.apply(this, args);
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = (...args) => origFetch(...args).then(async (resp) => {
      try {
        const url = String(args[0] && args[0].url ? args[0].url : args[0] || '');
        if (/share/i.test(url)) {
          const clone = resp.clone();
          const body = await clone.text();
          if (/shareId/i.test(body)) captureBody(body);
        }
      } catch {}
      return resp;
    });
  };
  try {
    const buttons = Array.from(document.querySelectorAll('[aria-label="分享"]'));
    if (!buttons.length) return { ok: false, error: 'share button not found', barVisible: false };
    buttons[buttons.length - 1].click();
    let copyItem = null;
    for (let attempt = 0; attempt < 8 && !copyItem; attempt += 1) {
      await sleep(500);
      const items = Array.from(document.querySelectorAll('.agent-chat__share-bar__item'));
      copyItem = items.find((el) => clean(el.innerText || el.textContent) === '复制链接') || null;
    }
    if (!copyItem) return { ok: false, error: 'copy link item not found after opening share bar', barVisible: true };
    installHooks();
    const clickEl = copyItem.querySelector('.agent-chat__share-bar__item__logo') || copyItem;
    clickEl.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(500);
      const text = String(window.__shareCap.text || '');
      const shareId = String(window.__shareCap.shareId || '');
      if (text.includes('yb.tencent.com/s/') || shareId) {
        return { ok: true, text, shareId, barVisible: true };
      }
    }
    return { ok: false, text: String(window.__shareCap.text || ''), shareId: String(window.__shareCap.shareId || ''), error: 'copy did not expose a share link within 10s', barVisible: true };
  } catch (error) {
    return { ok: false, error: String(error), barVisible: false };
  }
})()`;

async function listRecentConversations(args, agentId) {
  const agent = agentId || 'naQivTmsDa';
  let page = '';
  try {
    page = await browserTabNew(args, `https://yuanbao.tencent.com/chat/${agent}`);
    if (page) await browserTabSelect(args, page);
  } catch (error) {
    return { ok: false, error: error.message, page, items: [] };
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    const parsed = await browserEvalJson(args, LIST_CONVERSATIONS_JS, 30000);
    return { ok: true, page, items: Array.isArray(parsed) ? parsed : [] };
  } catch (error) {
    return { ok: false, error: error.message, page, items: [] };
  }
}

async function findMatchingConversation(args, prompt, answerText) {
  const listing = await listRecentConversations(args, 'naQivTmsDa');
  if (!listing.ok || !listing.items.length) {
    return { ok: false, error: listing.error || 'no sidebar conversations found', items: listing.items || [] };
  }
  const expectedPrompt = normalizeText(prompt);
  const normalizedAnswer = normalizeCompareText(answerText);
  const debugTrail = [];
  for (const item of listing.items) {
    const agentId = item.agentId || 'naQivTmsDa';
    const url = `https://yuanbao.tencent.com/chat/${agentId}/${item.cid}`;
    try {
      await browserOpenUrl(args, url);
      let parsed = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 4000 : 1500));
        parsed = await browserEvalJson(args, PAGE_MATCH_JS, 30000);
        if (normalizeText(parsed?.last_user)) break;
      }
      const lastUser = normalizeText(parsed?.last_user);
      const lastAssistant = normalizeText(parsed?.last_assistant);
      const promptMatched = Boolean(lastUser && (
        lastUser === expectedPrompt
        || lastUser.startsWith(expectedPrompt)
        || expectedPrompt.startsWith(lastUser)
        || lastUser.includes(expectedPrompt)
      ));
      const normalizedDom = normalizeCompareText(lastAssistant);
      const answerMatched = Boolean(lastAssistant && (
        textFingerprint(lastAssistant) === textFingerprint(answerText)
        || normalizedDom === normalizedAnswer
        || (normalizedDom.length > 80 && normalizedAnswer.startsWith(normalizedDom.slice(0, 80)))
        || (normalizedAnswer.length > 80 && normalizedDom.startsWith(normalizedAnswer.slice(0, 80)))
      ));
      debugTrail.push({
        cid: item.cid,
        title: item.title,
        lastUser: String(lastUser || '').slice(0, 80),
        lastAssistant: String(lastAssistant || '').slice(0, 80),
        promptMatched,
        answerMatched,
        normDom80: String(normalizedDom || '').slice(0, 80),
        normAns80: String(normalizedAnswer || '').slice(0, 80),
        fpEqual: textFingerprint(lastAssistant) === textFingerprint(answerText),
        domLen: String(lastAssistant || '').length,
        ansLen: String(answerText || '').length,
      });
      // Match on the prompt text alone. Requiring the answer to match too is
      // too brittle: the ask transcript can be truncated or normalized
      // differently from the DOM, which made the crawler fall back to a stale
      // conversation URL and share the previous sample's Q&A.
      if (promptMatched) {
        return { ok: true, url, cid: item.cid, agentId, title: item.title, debugTrail };
      }
    } catch (error) {
      // try the next conversation
    }
  }
  return {
    ok: false,
    error: `no matching conversation found in sidebar (items=${(listing.items || []).length}, listingError=${listing.error || ''}, trail=${JSON.stringify(debugTrail)})`,
    items: listing.items || [],
    debugTrail,
  };
}

function normalizeShareReferences(refs) {
  return (refs || []).map((ref, index) => {
    const url = String(ref.url || '').trim();
    if (!url) return null;
    const domain = hostnameFromUrl(url);
    return {
      number: Number(ref.index) || index + 1,
      source: ref.web_site_name || ref.source_name || domain || '未知来源',
      source_origin: 'share-page',
      domain,
      title: String(ref.title || domain || '').trim(),
      title_origin: 'share-page',
      date: '',
      url,
      summary: String(ref.quote || '').trim(),
      summary_origin: ref.quote ? 'share-page' : '',
      source_type: String(ref.source_type || '').trim(),
    };
  }).filter(Boolean);
}

async function fetchSharePayload(args, shareUrl) {
  const fixture = process.env.YUANBAO_SHARE_FIXTURE;
  if (fixture) {
    try {
      const data = JSON.parse(fs.readFileSync(path.resolve(fixture), 'utf8'));
      return { ok: Boolean(data && data.answer && data.answer.text), fixture: true, data };
    } catch (error) {
      return { ok: false, fixture: true, error: error.message, data: null };
    }
  }
  const shareAnalyzer = path.join(path.dirname(__filename), 'analyze_yuanbao_share.mjs');
  const shareId = shareIdFromUrl(shareUrl) || 'share';
  const outFile = path.join(path.dirname(path.resolve(args.out)), `${shareId}-share.json`);
  try {
    const analyzerArgs = [shareAnalyzer, '--link', shareUrl];
    // Some sandboxes block Node's direct fetch to yb.tencent.com. In that case
    // fetch the share page HTML through the connected browser (which has
    // network) and let the analyzer parse the local HTML instead.
    const htmlFile = await fetchShareHtmlViaBrowser(args, shareUrl);
    if (htmlFile) analyzerArgs.push('--html', htmlFile);
    analyzerArgs.push('--out', outFile);
    await execFileAsync(process.execPath, analyzerArgs, {
      timeout: 60000,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });
    const data = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    return { ok: Boolean(data && data.answer && data.answer.text), fixture: false, data };
  } catch (error) {
    return { ok: false, fixture: false, error: error.message, data: null };
  }
}

async function fetchShareHtmlViaBrowser(args, shareUrl) {
  try {
    const profileArgs = args.profile ? ['--profile', args.profile] : [];
    const page = await browserTabNew(args, shareUrl);
    if (page) await browserTabSelect(args, page);
    let html = '';
    for (let attempt = 0; attempt < 2 && !html.includes('__NEXT_DATA__'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4500));
      const result = await runOpenCliCommand([...profileArgs, 'browser', args.session, 'eval', 'document.documentElement.outerHTML'], 60000);
      html = `${result.stdout || ''}`.trim();
    }
    if (!html || !html.includes('__NEXT_DATA__')) return '';
    const htmlFile = path.join(path.dirname(path.resolve(args.out)), `${shareIdFromUrl(shareUrl) || 'share'}-share.html`);
    fs.writeFileSync(htmlFile, html, 'utf8');
    return htmlFile;
  } catch (error) {
    return '';
  }
}

async function createYuanbaoShare(args, run, conversationUrl) {
  const share = { requested: Boolean(args.createShare), created: false, url: '', share_id: '', error: '', source: '' };
  if (!args.createShare || !run.ok) return { ok: false, share, data: null };
  try {
    let matchedUrl = '';
    const matched = await findMatchingConversation(args, args.prompt, run.answerText);
    if (matched.ok) {
      matchedUrl = matched.url;
      share.find_debug = matched.debugTrail || null;
    } else {
      share.find_debug = matched.debugTrail || null;
      share.find_error = matched.error || '';
      const knownUrl = String(conversationUrl || '').match(/yuanbao\.tencent\.com\/chat\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/i);
      if (knownUrl) {
        try {
          await browserOpenUrl(args, String(conversationUrl));
          await new Promise((resolve) => setTimeout(resolve, 2500));
          const page = await browserEvalJson(args, PAGE_MATCH_JS, 30000);
          const pagePrompt = normalizeText(page?.last_user);
          const expectedPrompt = normalizeText(args.prompt);
          const promptOk = Boolean(pagePrompt && (
            pagePrompt === expectedPrompt
            || pagePrompt.startsWith(expectedPrompt)
            || expectedPrompt.startsWith(pagePrompt)
            || pagePrompt.includes(expectedPrompt)
          ));
          if (!promptOk) {
            share.find_error = 'knownUrl prompt check failed (pagePrompt=' + String(pagePrompt || '').slice(0, 60) + ')';
          }
          matchedUrl = String(conversationUrl);
        } catch (error) {
          share.open_error = error instanceof Error ? error.message : String(error);
          matchedUrl = String(conversationUrl);
        }
      }
    }
    if (!matchedUrl) {
      share.error = matched.ok ? '' : 'no matching conversation found in sidebar';
      return { ok: false, share, data: null };
    }
    let shareId = '';
    let shareConversationId = matched.ok ? matched.cid : '';
    let shareAgentId = matched.ok ? matched.agentId : '';
    if (!shareConversationId) {
      const urlParts = String(matchedUrl || '').match(/\/chat\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)/i);
      if (urlParts) {
        shareAgentId = urlParts[1];
        shareConversationId = urlParts[2];
      }
    }
    const apiJs = buildCreateShareApiJs(shareConversationId, shareAgentId);
    const api = await browserEvalJson(args, apiJs, 40000);
    if (api && api.ok && api.shareId) {
      shareId = String(api.shareId);
      share.source = 'share-api';
      share.api = { ok: true, status: Number(api.status) || 200, conversation_id: String(api.conversationId || ''), agent_id: String(api.agentId || '') };
    } else {
      const apiError = api && api.error ? String(api.error) : (api && api.status ? `share api returned status ${api.status}` : 'share api returned no shareId');
      share.api = { ok: false, error: apiError, status: api && api.status ? Number(api.status) : null };
      const ui = await browserEvalJson(args, SHARE_BAR_CAPTURE_JS, 60000);
      if (ui && ui.ok && (ui.shareId || /https:\/\/yb\.tencent\.com\/s\/[A-Za-z0-9_-]+/i.test(String(ui.text || '')))) {
        shareId = String(ui.shareId || ((String(ui.text || '').match(/https:\/\/yb\.tencent\.com\/s\/([A-Za-z0-9_-]+)/i) || [])[1] || ''));
        share.source = 'share-ui';
        share.ui = { ok: true, text: String(ui.text || '').slice(0, 500) };
      } else {
        share.ui = { ok: false, error: String((ui && ui.error) || 'share bar fallback did not return a share link') };
      }
    }
    if (!shareId) {
      share.error = 'share creation failed (api and ui fallback)';
      return { ok: false, share, data: null };
    }
    share.url = `https://yb.tencent.com/s/${shareId}`;
    share.share_id = shareId;
    const payload = await fetchSharePayload(args, share.url);
    if (!payload.ok) {
      share.error = payload.error || 'share page parse failed';
      return { ok: false, share, data: null };
    }
    const shareQuestion = String((payload.data?.question?.text) || '').trim();
    const promptText = String(args.prompt || '').trim();
    if (shareQuestion && promptText && shareQuestion !== promptText) {
      share.content_mismatch = true;
      share.content_mismatch_detail = `share question '${shareQuestion.slice(0, 60)}' != prompt '${promptText.slice(0, 60)}'`;
    } else {
      share.content_mismatch = false;
    }
    share.created = true;
    return { ok: true, share, data: payload.data };
  } catch (error) {
    share.error = error instanceof Error ? error.message : String(error);
    return { ok: false, share, data: null };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  validate(args);

  const fresh = await startFreshConversation(args);
  const run = await askYuanbao(args);
  const status = await getYuanbaoStatus(args);
  let conversationUrl = status.url || '';
  const urlSources = { status: conversationUrl, history: '', browser_tab: '' };
  if (!/\/chat\/[^/]+\/[A-Za-z0-9_-]+/i.test(conversationUrl)) {
    urlSources.history = await getRecentConversationUrl(args);
    conversationUrl = urlSources.history || conversationUrl;
  }
  if (!/\/chat\/[^/]+\/[A-Za-z0-9_-]+/i.test(conversationUrl) && run.ok) {
    urlSources.browser_tab = await readCurrentConversationUrl(args);
    conversationUrl = urlSources.browser_tab || conversationUrl;
  }
  const browserReferences = await collectBrowserReferences(args, conversationUrl, run.answerText);
  const textReferences = collectReferencesFromText(run.answerText);
  const baseReferenceItems = mergeReferenceCollections([browserReferences.items, textReferences]);
  const shareResult = await createYuanbaoShare(args, run, conversationUrl);
  const share = shareResult.share;
  const shareData = shareResult.data;
  let finalAnswerText = run.answerText;
  let referenceItems = baseReferenceItems;
  let referencesVerified = Boolean(browserReferences.verified);
  let referencesSource = referencesVerified ? 'browser-dom' : 'answer-text';
  let referencesNote = referencesVerified
    ? browserReferences.note
    : [
      browserReferences.note,
      referenceItems.length
        ? 'References were extracted from the 腾讯元宝 answer text (markdown links and bare URLs).'
        : 'No external URLs were found in the 腾讯元宝 answer text. Use public share links (yb.tencent.com/s/<shareId>) for full references.',
    ].filter(Boolean).join(' ');
  let mediaItems = [];
  let shareChat = {};
  if (shareData) {
    finalAnswerText = shareData.answer?.text || finalAnswerText;
    referenceItems = normalizeShareReferences(shareData.references);
    referencesVerified = true;
    referencesSource = 'share-public';
    referencesNote = `References parsed from the public share page (${share.url || ''}).`;
    mediaItems = Array.isArray(shareData.media) ? shareData.media : [];
    shareChat = shareData.chat || {};
    if (shareChat.id && shareChat.agent_id) {
      conversationUrl = `https://yuanbao.tencent.com/chat/${shareChat.agent_id}/${shareChat.id}`;
    }
  }
  // Resolve the authoritative conversation id before moving it into a group:
  // prefer the share page chat id, then the share API ids. `yuanbao status`
  // may return only /chat/<agent> on some accounts, and the sidebar fallbacks
  // can return a stale conversation, so never move based on those alone.
  if (!/\/chat\/[^/]+\/[A-Za-z0-9_-]+/i.test(conversationUrl)) {
    const apiCid = shareResult.share?.api?.conversation_id;
    const apiAid = shareResult.share?.api?.agent_id;
    if (apiCid && apiAid) {
      conversationUrl = `https://yuanbao.tencent.com/chat/${apiAid}/${apiCid}`;
    }
  }
  const groupMove = await moveConversationToGroup(args, conversationUrl);
  const raw = {
    schema_version: 'yuanbao-crawler-raw/opencli-adapter-v1',
    ok: run.ok,
    transport: shareData ? 'opencli-yuanbao-adapter+share' : 'opencli-yuanbao-adapter',
    collected_at: run.finished.toISOString(),
    session: args.session,
    question: args.prompt,
    target: args.target,
    search: args.search,
    think: args.think,
    duration_ms: run.finished.getTime() - run.started.getTime(),
    fresh_conversation: fresh,
    answer: {
      text: finalAnswerText,
      length: finalAnswerText.length,
      target_mention_count: args.target ? countMentions(finalAnswerText, args.target) : 0,
    },
    references: {
      count: referenceItems.length,
      observed_count: shareData ? referenceItems.length : (browserReferences.count_observed ?? referenceItems.length),
      items: referenceItems,
      verified: referencesVerified,
      note: referencesNote,
      source: referencesSource,
    },
    model_mode: args.model || 'quick',
    model_warning: args.model === 'vision' ? 'Yuanbao OpenCLI adapter has no vision model switch; this sample ran in quick mode.' : '',
    conversation: {
      url: conversationUrl,
      agent_id: status.agent_id || shareChat.agent_id || '',
      session_id: status.session_id || shareChat.id || '',
      model: status.model || shareChat.chat_model_id || '',
      model_id: status.model_id || shareChat.model_id || '',
      url_sources: urlSources,
    },
    group_move: groupMove,
    share: {
      requested: share.requested,
      created: share.created,
      url: share.url,
      share_id: share.share_id,
      error: share.error,
      source: share.source || '',
      find_error: share.find_error || '',
      open_error: share.open_error || '',
      api: share.api || null,
      ui: share.ui || null,
      find_debug: share.find_debug || null,
      content_mismatch: share.content_mismatch === undefined ? null : share.content_mismatch,
      content_mismatch_detail: share.content_mismatch_detail || '',
    },
    media: mediaItems,
    dom_references: browserReferences,
    opencli: {
      exit_code: run.code,
      parsed: run.parsed,
      output_excerpt: run.output.trim().slice(0, 4000),
      status_error: status.error || '',
    },
    error: run.ok ? '' : run.error,
    opencli_error: run.error || '',
  };
  const shareRequired = Boolean(args.createShare) && run.ok;
  if (shareRequired && !share.created) {
    raw.ok = false;
    raw.error = share.error || 'share creation failed';
    raw.opencli_error = raw.error;
  }
  writeJson(args.out, raw);
  console.log(JSON.stringify(raw, null, 2));
  if (!raw.ok) {
    console.error(raw.error || 'sample failed');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
