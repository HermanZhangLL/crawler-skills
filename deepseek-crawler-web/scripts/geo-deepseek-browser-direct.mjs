#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { cleanText, conversationIdFromUrl, createShare, fetchHistoryMessages, fetchShareContent, normalizeShareContent } from './lib/share-utils.mjs';
import { opencliExec } from './lib/opencli-command.mjs';

const execFileAsync = promisify(execFile);

let activeWindowMode = 'background';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printHelp() {
  console.log(`Usage:
  node scripts/geo-deepseek-browser-direct.mjs --prompt <text> --out <file> [options]

Options:
  --session <id>      Temporary browser session id. Default: dscw-<pid>.
  --prompt <text>     Prompt to send to DeepSeek.
  --timeout <sec>     Timeout passed to OpenCLI. Default: 600.
  --out <file>        Raw JSON output path.
  --profile <name>    OpenCLI Browser Bridge profile.
  --target <text>     Target entity recorded in output metadata.
  --no-search         Do not pass --search to DeepSeek.
  --create-share       After the answer, create a public share and pull full structured data from the share API.
  --no-create-share     Disable public share creation (default: enabled).
  --think               Enable DeepSeek deep thinking mode. Default: quick mode.
  --model <mode>         DeepSeek model: instant (default), expert, or vision.
  --fast-ask             Do not wait for OpenCLI ask's own stability poll; ask with a short
                         timeout, then poll the DeepSeek history API until the answer finishes.
  --window-mode <mode>   Browser window mode: foreground or background. Default: background (or DEEPSEEK_WINDOW_MODE).
  -h, --help          Show help.

Requires:
  npm install -g @jackwener/opencli
  opencli plugin install github:ssddi456/opencli-deepseek
`);
}

function parseArgs(argv) {
  const args = {
    session: `dscw-${process.pid}`,
    prompt: '',
    timeout: 600,
    out: '',
    profile: '',
    target: '',
    search: true,
    think: false,
    model: 'instant',
    createShare: true,
    fastAsk: String(process.env.DEEPSEEK_FAST_ASK || '').trim() === '1',
    windowMode: String(process.env.DEEPSEEK_WINDOW_MODE || 'background').trim().toLowerCase(),
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
    else if (arg === '--create-share') args.createShare = true;
    else if (arg === '--no-create-share') args.createShare = false;
    else if (arg === '--think') args.think = true;
    else if (arg === '--model') args.model = String(takeValue(argv, ++i, arg)).toLowerCase();
    else if (arg === '--fast-ask') args.fastAsk = true;
    else if (arg === '--window-mode') args.windowMode = String(takeValue(argv, ++i, arg)).trim().toLowerCase();
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  activeWindowMode = args.windowMode === 'foreground' ? 'foreground' : 'background';
  return args;
}

function windowModeValue() {
  return activeWindowMode === 'foreground' ? 'foreground' : 'background';
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

function getResponse(parsed) {
  if (Array.isArray(parsed)) {
    const row = parsed.find((item) => item && typeof item === 'object') || {};
    return String(row.response || row.Response || row.answer || row.text || '').trim();
  }
  if (parsed && typeof parsed === 'object') {
    return String(parsed.response || parsed.Response || parsed.answer || parsed.text || '').trim();
  }
  return '';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function textFingerprint(value) {
  return createHash('sha256').update(normalizeText(value), 'utf8').digest('hex');
}

function parseReferencesFromBrowserPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  const items = Array.isArray(parsed.references) ? parsed.references : [];
  return items.map((item) => normalizeReference(item)).filter(Boolean);
}

function normalizeReference(item) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || item.href || '').trim();
  if (!url) return null;
  const number = Number.parseInt(String(item.number || item.num || '').replace(/\D+/g, ''), 10) || null;
  const domain = item.domain || hostnameFromUrl(url);
  const source = String(item.source || domain || '').trim();
  const explicitTitle = String(item.title || '').trim();
  const title = explicitTitle || titleFromUrl(url) || domain || url;
  const summary = String(item.summary || item.context || '').trim();
  return {
    number,
    source,
    source_origin: String(item.source_origin || (item.source ? 'browser-dom' : 'url-hostname')).trim(),
    domain: String(domain || '').trim(),
    title: String(title).trim(),
    title_origin: String(item.title_origin || (explicitTitle ? 'browser-dom-attribute' : 'url-derived')).trim(),
    date: String(item.date || '').trim(),
    url,
    summary,
    summary_origin: String(item.summary_origin || (summary ? 'answer-context' : '')).trim(),
  };
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function titleFromUrl(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const itemIndex = pathParts.findIndex((part) => part.toLowerCase() === 'item');
    if (itemIndex >= 0 && pathParts[itemIndex + 1]) {
      return decodeURIComponent(pathParts[itemIndex + 1]).replace(/[-_]+/g, ' ').slice(0, 120);
    }
    const tail = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || parsed.hostname;
    return decodeURIComponent(tail).replace(/[-_]+/g, ' ').slice(0, 120);
  } catch {
    return '';
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(path.resolve(file), `${JSON.stringify(data, null, 2)}\n`);
}

async function runOpenCli(args) {
  const cliArgs = [];
  if (args.profile) cliArgs.push('--profile', args.profile);
  // In fast mode, ask only needs to fire the message and leave the kept tab
  // running; completion is verified below through the DeepSeek history API,
  // so cap the OpenCLI ask wait to 30s instead of the legacy 600s stability poll.
  const askTimeout = args.fastAsk ? Math.min(args.timeout, 30) : args.timeout;
  cliArgs.push(
    'deepseek',
    'ask',
    args.prompt,
    '--new',
    'true',
    '--timeout',
    String(askTimeout),
    '--format',
    'json',
    '--keep-tab',
    'true',
    '--site-session',
    'persistent',
    '--window',
    windowModeValue(),
  );
  if (args.search) cliArgs.push('--search', 'true');
  if (args.model) cliArgs.push('--model', args.model);
  if (args.think) cliArgs.push('--think', 'true');

  const started = new Date();
  try {
    const result = await execFileAsync(...opencliExec(cliArgs), {
      timeout: (args.timeout + 30) * 1000,
      maxBuffer: 30 * 1024 * 1024,
      env: process.env,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const parsed = extractJson(output);
    const answerText = getResponse(parsed);
    return {
      ok: Boolean(answerText),
      code: 0,
      output,
      parsed,
      answerText,
      started,
      finished: new Date(),
      error: answerText ? '' : 'OpenCLI returned no response text',
    };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`;
    const parsed = extractJson(output);
    const answerText = getResponse(parsed);
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

async function collectBrowserReferences(args, expectedAnswerText) {
  if (!args.search) return { items: [], verified: false, note: 'Search was disabled.' };
  const browserSession = args.session;
  const bindArgs = [];
  if (args.profile) bindArgs.push('--profile', args.profile);
  bindArgs.push('browser', browserSession, 'bind', '--window', windowModeValue());
  const unbindArgs = [];
  if (args.profile) unbindArgs.push('--profile', args.profile);
  unbindArgs.push('browser', browserSession, 'unbind');
  let outcome = {
    items: [],
    verified: false,
    note: 'Browser reference extraction did not run.',
  };

  const expectedPromptJson = JSON.stringify(args.prompt);
  const expectedAnswerFingerprint = textFingerprint(expectedAnswerText);
  const expectedAnswerFingerprintJson = JSON.stringify(expectedAnswerFingerprint);
  const js = `(async () => {
    const expectedPrompt = ${expectedPromptJson};
    const expectedAnswerFingerprint = ${expectedAnswerFingerprintJson};
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const fingerprint = async (value) => {
      const bytes = new TextEncoder().encode(clean(value));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    };
    const roleOf = (node) => {
      const explicit = clean(
        node.getAttribute('data-role')
        || node.getAttribute('data-message-role')
        || node.getAttribute('data-author')
        || node.getAttribute('aria-label')
      ).toLowerCase();
      if (/user|human|用户|我|访客/.test(explicit)) return 'user';
      if (/assistant|deepseek|ai|助手/.test(explicit)) return 'assistant';
      return node.classList.length > 2 ? 'user' : 'assistant';
    };
    if (location.origin !== 'https://chat.deepseek.com') {
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
    const conversationMatch = location.pathname.match(/^\\/a\\/chat\\/s\\/([a-f0-9-]+)(?:\\/|$)/i);
    const conversationId = conversationMatch ? conversationMatch[1].toLowerCase() : '';
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(conversationId)) {
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
    const messages = Array.from(document.querySelectorAll('.ds-message'))
      .map((node) => ({ node, role: roleOf(node), text: clean(node.innerText || node.textContent) }))
      .filter((message) => message.text);
    const expected = clean(expectedPrompt);
    const userMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!userMessage || userMessage.text !== expected) {
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
    const userMessageIndex = messages.indexOf(userMessage);
    const afterUser = messages.slice(userMessageIndex + 1);
    const nextUserOffset = afterUser.findIndex((message) => message.role === 'user');
    const answerScope = nextUserOffset >= 0 ? afterUser.slice(0, nextUserOffset) : afterUser;
    const assistantMessage = [...answerScope].reverse().find((message) => message.role === 'assistant');
    const answerFingerprint = assistantMessage ? await fingerprint(assistantMessage.text) : '';
    const answerMatched = Boolean(assistantMessage && answerFingerprint === expectedAnswerFingerprint);
    if (!assistantMessage || !answerMatched) {
      return {
        href: location.href,
        title: document.title,
        prompt_matched: true,
        answer_matched: false,
        matched_prompt: userMessage.text,
        conversation_id: conversationId,
        answer_fingerprint: answerFingerprint,
        read_count: 0,
        references: []
      };
    }
    const last = assistantMessage.node;
    const anchors = Array.from(last.querySelectorAll('a[href^="http"]'));
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
    const readMatch = (last.innerText || '').match(/已阅读\\s*(\\d+)\\s*个网页|^(\\d+)\\s*个网页$/m);
    return {
      href: location.href,
      title: document.title,
      prompt_matched: true,
      answer_matched: true,
      matched_prompt: userMessage.text,
      conversation_id: conversationId,
      answer_fingerprint: answerFingerprint,
      read_count: readMatch ? Number(readMatch[1] || readMatch[2]) : null,
      references
    };
  })()`;
  const evalArgs = [];
  if (args.profile) evalArgs.push('--profile', args.profile);
  evalArgs.push('browser', browserSession, 'eval', base64EvalScript(js));
  try {
    await execFileAsync(...opencliExec(bindArgs), {
      timeout: 15 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      env: process.env,
    });
    try {
      const result = await execFileAsync(...opencliExec(evalArgs), {
        timeout: 30 * 1000,
        maxBuffer: 20 * 1024 * 1024,
        env: process.env,
      });
      const parsed = extractJson(`${result.stdout || ''}${result.stderr || ''}`);
      const pageUrl = String(parsed?.href || '').trim();
      const pageTitle = String(parsed?.title || '').trim();
      let pageOrigin = '';
      try {
        pageOrigin = new URL(pageUrl).origin;
      } catch {
        pageOrigin = '';
      }
      const matchedPrompt = String(parsed?.matched_prompt || '').replace(/\s+/g, ' ').trim();
      const expectedPrompt = String(args.prompt || '').replace(/\s+/g, ' ').trim();
      const conversationId = String(parsed?.conversation_id || '').trim().toLowerCase();
      const validConversationId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(conversationId);
      const answerFingerprint = String(parsed?.answer_fingerprint || '').trim().toLowerCase();
      if (
        pageOrigin !== 'https://chat.deepseek.com'
        || !validConversationId
        || parsed?.prompt_matched !== true
        || parsed?.answer_matched !== true
        || matchedPrompt !== expectedPrompt
        || answerFingerprint !== expectedAnswerFingerprint
      ) {
        outcome = {
          items: [],
          verified: false,
          page_url: pageUrl,
          page_title: pageTitle,
          note: 'Browser reference extraction rejected a page that did not match the submitted DeepSeek prompt and returned answer.',
        };
      } else {
        const items = parseReferencesFromBrowserPayload(parsed);
        outcome = {
          count_observed: Number.isInteger(parsed?.read_count) ? parsed.read_count : items.length,
          items,
          verified: true,
          page_url: pageUrl,
          page_title: pageTitle,
          conversation_id: conversationId,
          answer_matched: true,
          answer_fingerprint: answerFingerprint,
          note: items.length
            ? 'References were extracted from citation links scoped to the submitted DeepSeek prompt. DeepSeek did not expose a separate source-panel object through the public OpenCLI adapter.'
            : 'The submitted DeepSeek prompt was verified, but no citation links were found in its answer.',
        };
      }
    } catch (error) {
      outcome = {
        items: [],
        verified: false,
        note: `Browser reference extraction failed: ${error.message}`,
      };
    }
  } catch (error) {
    outcome = {
      items: [],
      verified: false,
      note: `Browser session bind failed: ${error.message}`,
    };
  } finally {
    try {
      await execFileAsync(...opencliExec(unbindArgs), {
        timeout: 15 * 1000,
        maxBuffer: 5 * 1024 * 1024,
        env: process.env,
      });
    } catch (error) {
      outcome.cleanup_error = `Browser session unbind failed: ${error.message}`;
      outcome.note = `${outcome.note} ${outcome.cleanup_error}`.trim();
    }
  }
  return outcome;
}


async function getDeepSeekConversationId(args) {
  try {
    const statusArgs = [];
    if (args.profile) statusArgs.push('--profile', args.profile);
    statusArgs.push('deepseek', 'status', '-f', 'json');
    const result = await execFileAsync(...opencliExec(statusArgs), {
      timeout: 30 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    const parsed = extractJson(`${result.stdout || ''}`);
    const url = Array.isArray(parsed) ? parsed[0]?.Url : parsed?.Url;
    return conversationIdFromUrl(url || '');
  } catch {
    return '';
  }
}

async function getAuthToken(args, conversationUrl) {
  const browserSession = args.session;
  const profileArgs = [];
  if (args.profile) profileArgs.push('--profile', args.profile);
  const url = String(conversationUrl || 'https://chat.deepseek.com/');
  try {
    await execFileAsync(...opencliExec([...profileArgs, 'browser', browserSession, 'bind', '--window', windowModeValue()]), {
      timeout: 15 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      env: process.env,
    });
  } catch {
    return '';
  }
  let token = '';
  try {
    await execFileAsync(...opencliExec([...profileArgs, 'browser', browserSession, 'open', url]), {
      timeout: 30 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const js = `(() => { const raw = localStorage.getItem('userToken') || ''; let token = raw; try { token = JSON.parse(raw).value || raw; } catch {} return { token }; })()`;
    const result = await execFileAsync(...opencliExec([...profileArgs, 'browser', browserSession, 'eval', base64EvalScript(js)]), {
      timeout: 30 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    const parsed = extractJson(`${result.stdout || ''}`);
    if (parsed && typeof parsed.token === 'string' && parsed.token) token = parsed.token;
  } catch {
    token = '';
  }
  try {
    await execFileAsync(...opencliExec([...profileArgs, 'browser', browserSession, 'unbind']), {
      timeout: 15 * 1000,
      maxBuffer: 5 * 1024 * 1024,
      env: process.env,
    });
  } catch {
    // best-effort cleanup
  }
  return token;
}

function base64EvalScript(js) {
  const encoded = Buffer.from(js, 'utf8').toString('base64');
  return `(async () => { const bin = atob('${encoded}'); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return eval(new TextDecoder().decode(bytes)); })()`;
}

async function activateDeepSeekTab(args) {
  try {
    const statusArgs = [];
    if (args.profile) statusArgs.push('--profile', args.profile);
    statusArgs.push('deepseek', 'status', '-f', 'json');
    await execFileAsync(...opencliExec(statusArgs), {
      timeout: 30 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
  } catch {
    // activation is best-effort; binding still attempts the active tab
  }
}

function historyRole(message) {
  return String(
    message?.role
    || message?.type
    || message?.message_type
    || message?.content_type
    || '',
  ).toLowerCase();
}

function historyIsUser(message) {
  return /user|human|我|用户/.test(historyRole(message));
}

function historyIsAssistant(message) {
  const role = historyRole(message);
  if (/assistant|ai|deepseek|bot|助手/.test(role)) return true;
  if (String(message?.type ?? message?.content_type ?? '') === '2') return true;
  if (historyIsUser(message)) return false;
  // DeepSeek history bubbles are user/assistant pairs; any non-user bubble
  // that carries content is treated as an assistant message.
  return Boolean(message?.content || message?.text);
}

function historyIsFinished(message) {
  const status = String(message?.status || message?.msg_status || '').toUpperCase();
  if (['FINISHED', 'DONE', 'COMPLETED', 'SUCCESS', '2'].includes(status)) return true;
  if (message?.incomplete_message != null) return false;
  return false;
}

async function pollHistoryUntilComplete(args, conversationId, token) {
  const deadline = Date.now() + (args.fastAsk ? 300000 : 90000);
  let previousText = '';
  let stableCount = 0;
  let lastAnswer = '';
  let finishedFlag = false;
  while (Date.now() < deadline) {
    let messages = [];
    try {
      messages = await fetchHistoryMessages(conversationId, token);
    } catch {
      messages = [];
    }
    const answers = messages
      .filter((m) => historyIsAssistant(m))
      .map((m) => cleanText(m?.content || m?.text || ''))
      .filter(Boolean);
    const last = answers[answers.length - 1] || '';
    const statusFinished = messages.some((m) => historyIsAssistant(m) && historyIsFinished(m));
    if (statusFinished && last) {
      lastAnswer = last;
      finishedFlag = true;
      break;
    }
    if (last) {
      lastAnswer = last;
      stableCount = cleanText(last) === cleanText(previousText) ? stableCount + 1 : 1;
      if (stableCount >= 3) break;
      previousText = last;
    }
    await sleep(3000);
  }
  return { complete: Boolean(finishedFlag || (lastAnswer && stableCount >= 3)), answerText: lastAnswer };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  validate(args);

  const startedWall = Date.now();
  const run = await runOpenCli(args);
  await activateDeepSeekTab(args);
  const browserReferences = await collectBrowserReferences(args, run.answerText);
  let referenceItems = browserReferences.items || [];
  let finalAnswerText = run.answerText;
  let completionText = '';
  let share = { requested: Boolean(args.createShare), created: false, error: '' };
  let shareMeta = null;
  let shareStructure = null;
  if (args.createShare) {
    const conversationId = await getDeepSeekConversationId(args);
    if (!conversationId) {
      share.error = 'no conversation id from deepseek status';
    } else {
      share.conversation_id = conversationId;
      const token = await getAuthToken(args, `https://chat.deepseek.com/a/chat/s/${conversationId}`);
      if (!token) {
        share.error = 'failed to read auth token from browser';
      } else {
        // Fast mode: OpenCLI ask only fired the message (short 30s wait). Wait
        // for the DeepSeek history API to report a finished assistant answer
        // before creating the public share; this replaces the legacy
        // 600s text-stability poll in the OpenCLI adapter.
        if (args.fastAsk) {
          const completion = await pollHistoryUntilComplete(args, conversationId, token);
          if (completion.complete && completion.answerText) {
            completionText = completion.answerText;
          } else {
            share.error = 'fast ask: answer did not finish within poll window';
          }
        }
        let lastError = '';
        let normalized = null;
        let shareContent = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const messages = await fetchHistoryMessages(conversationId, token);
            const messageIds = messages.map((m) => m.message_id).filter((v) => v != null && v !== '');
            if (!messageIds.length) throw new Error('history returned no message ids');
            const shareId = await createShare(conversationId, messageIds, token);
            shareContent = await fetchShareContent(shareId);
            normalized = normalizeShareContent(shareContent, { share_id: shareId });
            if (normalized.ok && normalized.complete) {
              share.created = true;
              share.share_id = shareId;
              share.url = `https://chat.deepseek.com/share/${shareId}`;
              break;
            }
            lastError = normalized.ok
              ? 'share content is not complete (status/incomplete_message)'
              : 'share content has no finished assistant answer text';
          } catch (error) {
            lastError = error.message;
            normalized = null;
            shareContent = null;
          }
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        share.content = shareContent;
        if (share.created && normalized) {
          shareMeta = normalized.share_meta || null;
          shareStructure = normalized.structure || null;
          finalAnswerText = normalized.answer_text;
          referenceItems = normalized.references;
        } else {
          share.error = lastError || 'share creation failed after retries';
          shareMeta = normalized?.share_meta || null;
          shareStructure = normalized?.structure || null;
        }
      }
    }
  }
  share.share_ok = Boolean(share.created && shareMeta && shareMeta.complete);
  const shareComplete = share.share_ok;
  if (!shareComplete && completionText && !finalAnswerText) finalAnswerText = completionText;
  const dataOk = shareComplete || run.ok || Boolean(completionText);
  const finishedWall = Date.now();
  const raw = {
    schema_version: 'deepseek-crawler-raw/opencli-plugin-v1',
    ok: dataOk,
    transport: 'opencli-deepseek-plugin',
    collected_at: new Date(finishedWall).toISOString(),
    session: args.session,
    question: args.prompt,
    target: args.target,
    search: args.search,
    think: args.think,
    model: args.model,
    duration_ms: finishedWall - startedWall,
    answer: {
      text: finalAnswerText,
      length: finalAnswerText.length,
      target_mention_count: args.target ? countMentions(finalAnswerText, args.target) : 0,
    },
    references: {
      count: referenceItems.length,
      observed_count: share.created ? referenceItems.length : (browserReferences.count_observed ?? referenceItems.length),
      items: referenceItems,
      verified: share.created ? true : Boolean(browserReferences.verified),
      note: share.created
        ? 'References sourced from the public share API created after browser-automated ask.'
        : browserReferences.note,
      source: share.created ? 'share-api' : 'browser-dom',
      page_url: browserReferences.page_url || '',
      page_title: browserReferences.page_title || '',
      conversation_id: browserReferences.conversation_id || '',
      answer_matched: Boolean(browserReferences.answer_matched),
      answer_fingerprint: browserReferences.answer_fingerprint || '',
      cleanup_error: browserReferences.cleanup_error || '',
    },
    dom_references: share.created ? browserReferences : undefined,
    share,
    share_meta: shareMeta || undefined,
    structure: shareStructure || undefined,
    opencli: {
      exit_code: run.code,
      parsed: run.parsed,
      output_excerpt: run.output.trim().slice(0, 4000),
    },
    error: shareComplete ? '' : run.error,
    opencli_error: run.error || '',
  };
  writeJson(args.out, raw);
  if (!dataOk) {
    console.error(run.error);
    process.exit(1);
  }
}

function countMentions(text, target) {
  const source = String(text || '');
  const needle = String(target || '').trim();
  if (!needle) return 0;
  return source.split(needle).length - 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
