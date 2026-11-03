#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const THREAD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const SENSITIVE_KEYS = new Set([
  'nick_name',
  'nickname',
  'avatar_url',
  'avatar_uri',
  'tiny_url',
  'sec_sender',
  'sender_id',
  'receiver_id',
  'user_id',
  'creatorID',
  'creator_id',
  'session_key',
  'cookie',
  'cookies',
  'authorization',
  'access_token',
  'refresh_token',
  'session_id',
  'tea_uuid',
  'open_id',
  'sec_uid',
  'password',
  'secret',
]);

export function threadUrlFromInput(value) {
  const cleaned = String(value || '').trim();
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  return 'https://www.doubao.com/thread/' + cleaned;
}

export function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\\\//g, '/');
}

export function redactValue(value) {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = redactValue(item);
    }
    return out;
  }
  return value;
}

export function extractShareData(html) {
  const marker = 'data-fn-name="mergeLoaderData"';
  const markerIndex = String(html || '').indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('ui_changed: mergeLoaderData marker not found');
  }
  const tail = html.slice(markerIndex);
  const argsMatch = tail.match(/data-fn-args="([^"]*)"/);
  if (!argsMatch) {
    throw new Error('ui_changed: data-fn-args not found');
  }
  const outer = JSON.parse(decodeHtmlEntities(argsMatch[1]));
  const entries = Array.isArray(outer) && Array.isArray(outer[1]) ? outer[1] : [];
  const entry = entries.find((item) => item && item.key === 'shareInfo');
  if (!entry) {
    throw new Error('ui_changed: shareInfo entry not found');
  }
  const fnArgs = entry.routerDataFnArgs;
  const raw = Array.isArray(fnArgs) ? fnArgs[0] : fnArgs;
  const parsed = JSON.parse(raw);
  return parsed && parsed.data ? parsed.data : parsed;
}

async function fetchHtml(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': THREAD_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) {
      throw new Error('network: HTTP ' + response.status + ' ' + response.statusText);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function isoFromMillis(value) {
  if (value == null || value === '') return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const milliseconds = number < 1000000000000 ? number * 1000 : number;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function blockTexts(blocks) {
  const texts = [];
  for (const block of blocks || []) {
    const content = block && block.content ? block.content : {};
    const textBlock = content.text_block;
    if (textBlock && typeof textBlock.text === 'string' && textBlock.text.trim()) {
      texts.push(textBlock.text.trim());
    }
  }
  return texts;
}

function messageTexts(messages) {
  const texts = [];
  for (const message of messages || []) {
    const blocks = Array.isArray(message.content_block)
      ? message.content_block
      : parseContentBlocks(message.content);
    texts.push(...blockTexts(blocks));
  }
  return texts;
}

function parseContentBlocks(content) {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function collectAnchors(text) {
  const anchors = new Set();
  const patterns = [/\[(\d+)\]/g, /【(\d+)】/g, /\^(\d+)/g];
  for (const pattern of patterns) {
    for (const match of String(text || '').matchAll(pattern)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

function collectSearchBlocks(blocks) {
  const out = [];
  for (const block of blocks || []) {
    const content = block && block.content ? block.content : {};
    if (content.search_query_result_block) {
      out.push(content.search_query_result_block);
    }
  }
  return out;
}

function suggestItemsFromMessage(message) {
  const direct = message.suggest_questions_v2 || message.suggest_questions;
  if (Array.isArray(direct) && direct.length) return direct;
  const ext = message.ext && typeof message.ext === 'object' ? message.ext : {};
  const spV2 = ext.sp_v2;
  if (typeof spV2 === 'string' && spV2.trim()) {
    try {
      const parsed = JSON.parse(spV2);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  return [];
}

function completionSignals(message) {
  const signals = [];
  if (message.status != null) signals.push('message_status=' + message.status);
  if (message.content_status) signals.push('content_status=' + message.content_status);
  const ext = message.ext && typeof message.ext === 'object' ? message.ext : {};
  if (ext.is_finish != null) signals.push('ext_is_finish=' + ext.is_finish);
  const blocks = Array.isArray(message.content_block)
    ? message.content_block
    : parseContentBlocks(message.content);
  let allFinished = true;
  for (const block of blocks) {
    if (block && typeof block.is_finish === 'boolean') {
      signals.push('block_is_finish=' + block.is_finish);
      if (!block.is_finish) allFinished = false;
    }
  }
  return { signals, allFinished };
}

function messageIsFinished(message) {
  const { signals, allFinished } = completionSignals(message);
  const statusOk = message.status == null || String(message.status) === '0';
  const extIsFinish = message.ext && message.ext.is_finish != null ? String(message.ext.is_finish) : '1';
  return { finished: allFinished && statusOk && extIsFinish === '1', signals };
}

function normalizeMessage(message) {
  const blocks = Array.isArray(message.content_block)
    ? message.content_block
    : parseContentBlocks(message.content);
  const ext = message.ext && typeof message.ext === 'object' ? message.ext : {};
  let conversationId = String(ext.chat_id || '');
  if (!conversationId && ext.source_share) {
    try {
      conversationId = String((JSON.parse(ext.source_share) || {}).conversation_id || '');
    } catch {
      // ignore
    }
  }
  return {
    message_id: message.message_id || '',
    user_type: message.user_type,
    status: message.status,
    content_type: message.content_type,
    content_status: message.content_status || '',
    index_in_conv: message.index_in_conv,
    create_time: isoFromMillis(message.create_time),
    update_time: isoFromMillis(message.update_time),
    thinking_content: String(message.thinking_content || ''),
    content_block: redactValue(blocks),
    conversation_id: conversationId,
    sec_sender: '[REDACTED]',
  };
}

function extractHeadings(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, ''));
}

function countOccurrences(text, target) {
  if (!target) return null;
  const escaped = String(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = String(text || '').match(new RegExp(escaped, 'gi'));
  return matches ? matches.length : 0;
}

function buildRecord(data, fetchedUrl, target, startedAt) {
  const shareInfo = (data && data.share_info) || {};
  const snapshot = (data && data.message_snapshot) || {};
  const messages = snapshot.message_list || [];
  const userMessages = messages.filter((message) => String(message.user_type) === '1');
  const assistantMessages = messages.filter((message) => String(message.user_type) === '2');

  const question = messageTexts(userMessages).join('\n');
  const answer = messageTexts(assistantMessages).join('\n\n');

  let brief = '';
  for (const message of assistantMessages) {
    brief = message.brief || ((message.ext && message.ext.brief) || '');
    if (brief) break;
  }

  const suggests = [];
  const seenSuggest = new Set();
  for (const message of assistantMessages) {
    for (const item of suggestItemsFromMessage(message)) {
      const content = String(item.content || '').trim();
      if (!content || seenSuggest.has(content)) continue;
      seenSuggest.add(content);
      suggests.push({
        suggest_type: item.suggest_type,
        content,
        icon_url: item.icon_url || '',
        icon_uri: item.icon_uri || '',
        click_url: item.click_url || '',
        bot_id: item.bot_id || '',
        dark_icon_url: item.dark_icon_url || '',
      });
    }
  }

  const anchors = collectAnchors(answer);
  const fullReferences = [];
  const seenRefs = new Set();
  const searchBlocks = [];
  for (const message of assistantMessages) {
    const blocks = Array.isArray(message.content_block)
      ? message.content_block
      : parseContentBlocks(message.content);
    for (const searchBlock of collectSearchBlocks(blocks)) {
      searchBlocks.push({
        summary: searchBlock.summary || '',
        queries: searchBlock.queries || [],
        scene: searchBlock.scene,
        search_type: searchBlock.search_type,
        extend_fields: searchBlock.extend_fields || {},
      });
      for (const result of searchBlock.results || []) {
        const card = result.text_card || result.video_card || result.image_card;
        if (!card) continue;
        const key = String(card.search_id || '') + '|' + String(card.doc_id || card.id || card.url || '');
        if (seenRefs.has(key)) continue;
        seenRefs.add(key);
        const cited = anchors.has(String(card.index || ''));
        fullReferences.push({
          ...card,
          cited,
          cite_anchor: cited ? '[' + card.index + ']' : '',
        });
      }
    }
  }

  const normalizedRefs = fullReferences.map((card, index) => ({
    number: Number(card.index) || index + 1,
    source: String(card.sitename || ''),
    domain: domainFromUrl(card.url),
    title: String(card.title || ''),
    date: String(card.publish_time_second || ''),
    url: String(card.url || ''),
    summary: String(card.summary || ''),
  }));

  const completionResults = assistantMessages.map(messageIsFinished);
  const finished = completionResults.length > 0 && completionResults.every((item) => item.finished);
  const signals = completionResults.flatMap((item) => item.signals);

  const askedAt = userMessages.length ? isoFromMillis(userMessages[0].create_time) : '';
  const lastAssistant = assistantMessages[assistantMessages.length - 1];
  const completedAt = lastAssistant
    ? isoFromMillis(lastAssistant.update_time || lastAssistant.create_time)
    : '';
  const shareTime = isoFromMillis(shareInfo.share_time);

  let conversationId = '';
  for (const message of messages) {
    conversationId = normalizeMessage(message).conversation_id;
    if (conversationId) break;
  }
  const shareId = String(shareInfo.share_id || '');
  const shareUrl = shareId ? 'https://www.doubao.com/thread/' + shareId : fetchedUrl;

  return {
    ok: Boolean(answer.trim()),
    collected_at: new Date().toISOString(),
    engine: 'doubao',
    transport: 'doubao-thread-http',
    question,
    options: {
      thread_url: shareUrl,
      started_at: startedAt.toISOString(),
    },
    timing: {
      asked_at: askedAt,
      completed_at: completedAt,
      collected_at: new Date().toISOString(),
      question_message_time: askedAt,
      share_time: shareTime,
    },
    page: {
      url: shareUrl,
      conversation_id: conversationId,
      share_id: shareId,
      title: String(shareInfo.share_name || ''),
    },
    completion: { finished, signals },
    answer: { text: answer, brief: String(brief || '') },
    suggest_questions: suggests,
    references: {
      count: normalizedRefs.length,
      items: normalizedRefs,
      full: fullReferences,
      note: normalizedRefs.length ? '' : 'No structured search results were found in the thread snapshot.',
    },
    search_blocks: searchBlocks,
    share_info: {
      share_id: shareId,
      share_name: String(shareInfo.share_name || ''),
      share_status: shareInfo.share_status,
      share_time: shareTime,
      message_index_end: String(shareInfo.message_index_end || ''),
      bot: shareInfo.bot || {},
      share_platform: String(shareInfo.share_platform || ''),
      share_biz_type: shareInfo.share_biz_type,
    },
    message_list: messages.map(normalizeMessage),
    extraction: {
      char_count: answer.length,
      line_count: answer ? answer.split(/\r?\n/).length : 0,
      headings: extractHeadings(answer),
      reference_count: normalizedRefs.length,
      target: target || null,
      target_mention_count: countOccurrences(answer, target),
    },
    pending_thread_capture: false,
    failure_reason: '',
    redacted: true,
  };
}

function failureRecord(input, error, startedAt) {
  const message = String((error && error.message) || error);
  let failureReason = 'unknown';
  if (/^network:|fetch failed|ECONN|abort/i.test(message)) failureReason = 'network';
  else if (/thread_not_found/i.test(message)) failureReason = 'thread_not_found';
  else if (/ui_changed|JSON|parse|Unexpected token/i.test(message)) failureReason = 'ui_changed';
  return {
    ok: false,
    collected_at: new Date().toISOString(),
    engine: 'doubao',
    transport: 'doubao-thread-http',
    question: '',
    options: { thread_url: threadUrlFromInput(input), started_at: startedAt.toISOString() },
    timing: {},
    page: { url: threadUrlFromInput(input), conversation_id: '', share_id: '', title: '' },
    completion: { finished: false, signals: [] },
    answer: { text: '', brief: '' },
    suggest_questions: [],
    references: { count: 0, items: [], full: [], note: '' },
    search_blocks: [],
    message_list: [],
    extraction: { char_count: 0, line_count: 0, headings: [], reference_count: 0, target: null, target_mention_count: null },
    pending_thread_capture: false,
    failure_reason: failureReason,
    error: message,
    redacted: true,
  };
}

export async function parseThreadRecord(input, options = {}) {
  const fromFile = Boolean(options.fromFile);
  const target = String(options.target || '');
  const timeoutMs = Number(options.timeoutMs || 30000);
  const startedAt = new Date();
  try {
    let data;
    if (fromFile) {
      data = JSON.parse(fs.readFileSync(input, 'utf8'));
    } else {
      const url = threadUrlFromInput(input);
      const html = await fetchHtml(url, timeoutMs);
      data = extractShareData(html);
    }
    data = redactValue(data);
    const record = buildRecord(data, threadUrlFromInput(input), target, startedAt);
    return redactValue(record);
  } catch (error) {
    return redactValue(failureRecord(input, error, startedAt));
  }
}

function parseArgs(argv) {
  const args = { timeout: 30, target: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--from-file') args.fromFile = argv[++i];
    else if (arg === '--target' || arg === '--target-entity') args.target = argv[++i];
    else if (arg === '--timeout') args.timeout = Number(argv[++i]);
    else if (arg === '-h' || arg === '--help') args.help = true;
    else if (!args.input) args.input = arg;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!args.input && !args.fromFile && !args.help) {
    throw new Error('Missing thread URL/share_id (or --from-file <json>)');
  }
  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/parse_doubao_thread.mjs <thread_url|share_id> [--out <file>] [--from-file <json>] [--target <text>] [--timeout <seconds>]');
    return;
  }
  const record = await parseThreadRecord(options.input || options.fromFile, {
    fromFile: Boolean(options.fromFile),
    target: options.target,
    timeoutMs: options.timeout * 1000,
  });
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(path.resolve(options.out), JSON.stringify(record, null, 2) + '\n');
  }
  console.log(JSON.stringify(record, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
