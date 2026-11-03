import crypto from 'node:crypto';

// Structure-adaptive share payload probing and extraction.
// DeepSeek / Doubao style products iterate their answer payload structure
// often, so field paths are never hardcoded as the only option: the probe
// first discovers where messages, roles, content and references live, then
// extraction follows the discovered structure. The known DeepSeek layout is
// only a high-priority candidate plus a fallback.

const KNOWN_MESSAGE_PATHS = [
  'data.biz_data.messages',
  'data.messages',
  'biz_data.messages',
  'messages',
];

const ROLE_FIELDS = ['role', 'type', 'sender', 'author', 'message_type', 'content_type', 'who'];
const USER_ROLES = new Set(['user', 'human', 'chatgpt-user', '访客', '用户', '我']);
const ASSISTANT_ROLES = new Set(['assistant', 'ai', 'bot', 'model', 'chatgpt', 'deepseek', '助手']);
const CONTENT_FIELDS = ['content', 'text', 'message', 'body', 'answer', 'message_content', 'msg_content'];
const STATUS_FIELDS = ['status', 'msg_status', 'state', 'finish_status', 'message_status'];
const FINISHED_STATUSES = new Set(['FINISHED', 'DONE', 'COMPLETED', 'SUCCESS']);
const INCOMPLETE_FIELDS = ['incomplete_message', 'incomplete', 'stop_reason', 'finish_reason'];
const TOKEN_FIELDS = ['accumulated_token_usage', 'token_usage', 'usage_tokens', 'total_tokens', 'tokens'];
const SEARCH_ENABLED_FIELDS = ['search_enabled', 'web_search_enabled', 'web_search', 'search_on'];
const THINKING_ENABLED_FIELDS = ['thinking_enabled', 'deep_think_enabled', 'deep_think', 'thinking'];
const SEARCH_STATUS_FIELDS = ['search_status', 'searchStatus'];
const INSERTED_AT_FIELDS = ['inserted_at', 'created_at', 'create_time', 'timestamp', 'time'];
const REF_ARRAY_FIELDS = ['search_results', 'references', 'sources', 'citations', 'web_results', 'links', 'footnotes', 'searchResults', 'cite_list'];
const REF_URL_FIELDS = ['url', 'link', 'href', 'source_url', 'cite_url', 'uri', 'address'];
const REF_TITLE_FIELDS = ['title', 'name', 'headline', 'heading', 'subject'];
const REF_SNIPPET_FIELDS = ['snippet', 'summary', 'description', 'excerpt', 'abstract', 'preview'];
const REF_NUMBER_FIELDS = ['cite_index', 'citation_index', 'index', 'number', 'order', 'seq', 'cite_no'];
const REF_DATE_FIELDS = ['published_at', 'publish_time', 'published', 'date', 'create_time', 'created_at', 'timestamp'];
const REF_SITE_FIELDS = ['site_name', 'site', 'source_name', 'source', 'publisher', 'media', 'website'];
const REF_DOMAIN_FIELDS = ['domain', 'host', 'hostname'];
const FRAGMENT_TYPE_FIELDS = ['type', 'kind', 'stage', 'category', 'fragment_type'];
// Type-value classification for typed fragment layouts (observed 2026-10: DeepSeek
// share payloads split content into REQUEST/SEARCH/RESPONSE fragments). Patterns
// classify observed values; extraction also has structural fallbacks so unknown
// type names still work.
const FRAGMENT_TYPE_PATTERNS = {
  request: /request|question|prompt|user|input|ask|query/i,
  response: /response|answer|reply|assistant|output|final/i,
  search: /search|source|citation|web|retrieve|browse/i,
};
const CONVERSATION_TITLE_FIELDS = ['title', 'subject', 'chat_title'];
const MODEL_TYPE_FIELDS = ['model_type', 'modelMode', 'model_mode', 'mode'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function dig(root, dotPath) {
  let current = root;
  for (const key of dotPath.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function normalizeRole(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';
  if (USER_ROLES.has(text)) return 'user';
  if (ASSISTANT_ROLES.has(text)) return 'assistant';
  if (/user|human|访客|用户/.test(text)) return 'user';
  if (/assistant|ai|bot|助手|模型/.test(text)) return 'assistant';
  return text;
}

function looksLikeUrl(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
}

function hostnameFromUrl(url) {
  try {
    return new URL(String(url).trim()).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pickField(items, candidates, predicate) {
  for (const key of candidates) {
    let hits = 0;
    for (const item of items) {
      if (isObject(item) && predicate(item[key], item)) hits += 1;
    }
    if (hits > 0 && hits >= Math.ceil(items.length * 0.5)) return key;
  }
  return '';
}

function scoreMessagesArray(arr) {
  const items = arr.filter(isObject);
  if (!items.length || items.length < arr.length * 0.8) return null;
  let roleField = '';
  for (const key of ROLE_FIELDS) {
    const values = items.map((item) => normalizeRole(item[key])).filter(Boolean);
    const recognized = values.filter((v) => v === 'user' || v === 'assistant');
    if (recognized.length >= Math.ceil(items.length * 0.6)) {
      roleField = key;
      break;
    }
  }
  if (!roleField) {
    // Adaptive fallback: unknown key name — scan every key by value pattern
    // (handles platform renames like speaker/author_role/messageRole...).
    const keys = new Set();
    for (const item of items) {
      for (const key of Object.keys(item)) keys.add(key);
    }
    for (const key of keys) {
      const recognized = items
        .map((item) => normalizeRole(item[key]))
        .filter((v) => v === 'user' || v === 'assistant');
      if (recognized.length >= Math.ceil(items.length * 0.6)) {
        roleField = key;
        break;
      }
    }
  }
  let contentField = '';
  let bestLength = -1;
  for (const key of CONTENT_FIELDS) {
    const strings = items.map((item) => item[key]).filter((v) => typeof v === 'string' && v.trim());
    if (strings.length >= Math.ceil(items.length * 0.6)) {
      const total = strings.reduce((sum, value) => sum + value.length, 0);
      if (total > bestLength) {
        bestLength = total;
        contentField = key;
      }
    }
  }
  if (!roleField && !contentField) return null;
  const score = (roleField ? 3 : 0) + (contentField ? 2 : 0);
  return { score, roleField, contentField, itemCount: items.length };
}

function collectArrays(root, maxNodes = 4000) {
  const found = [];
  const queue = [{ value: root, path: '' }];
  let seen = 0;
  while (queue.length && seen < maxNodes) {
    const { value, path } = queue.shift();
    seen += 1;
    if (Array.isArray(value)) {
      found.push({ value, path });
      value.forEach((item, index) => {
        if (isObject(item)) queue.push({ value: item, path: `${path}[${index}]` });
      });
      continue;
    }
    if (!isObject(value)) continue;
    for (const [key, child] of Object.entries(value)) {
      queue.push({ value: child, path: path ? `${path}.${key}` : key });
    }
  }
  return found;
}

function normalizeArrayPath(path) {
  // data.biz_data.messages[0].search_results -> keep message-level path only
  return path.replace(/\[\d+\]/g, '');
}

function findReferenceField(messages, roleField) {
  const counts = new Map();
  for (const message of messages) {
    if (!isObject(message)) continue;
    if (roleField && normalizeRole(message[roleField]) !== 'assistant') continue;
    for (const [key, value] of Object.entries(message)) {
      if (!Array.isArray(value) || !value.length) continue;
      const items = value.filter(isObject);
      if (!items.length) continue;
      const urlHits = items.filter((item) =>
        REF_URL_FIELDS.some((field) => looksLikeUrl(item[field]))
        || Object.values(item).some((v) => looksLikeUrl(v)),
      ).length;
      if (urlHits >= Math.ceil(items.length * 0.6)) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  if (!counts.size) return '';
  const known = REF_ARRAY_FIELDS.find((field) => counts.has(field));
  if (known) return known;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Typed-fragment layouts (observed 2026-10): messages carry a `fragments[]`
// array of typed blocks (REQUEST / SEARCH / RESPONSE) instead of a flat
// `content` string + `search_results` array. Probe detects this layout by
// structure: an array-of-objects field on messages whose items have a
// type-ish field and a content-ish string.
function probeFragments(objectMessages) {
  const arrayKeys = new Set();
  for (const message of objectMessages) {
    for (const [key, value] of Object.entries(message)) {
      if (Array.isArray(value) && value.some(isObject)) arrayKeys.add(key);
    }
  }
  for (const key of arrayKeys) {
    const items = objectMessages
      .map((m) => m[key])
      .filter((v) => Array.isArray(v))
      .flat()
      .filter(isObject);
    if (items.length < 2) continue;
    const typeField = pickField(items, FRAGMENT_TYPE_FIELDS, (v) => typeof v === 'string' && v.trim());
    if (!typeField) continue;
    const contentField = pickField(items, CONTENT_FIELDS, (v) => typeof v === 'string' && v.trim());
    if (!contentField) continue;
    // Classify observed type values into request/response/search buckets.
    const typeValues = [...new Set(items.map((i) => String(i[typeField] || '').trim()).filter(Boolean))];
    const buckets = { request: [], response: [], search: [], other: [] };
    for (const value of typeValues) {
      const lower = value.toLowerCase();
      const bucket = Object.entries(FRAGMENT_TYPE_PATTERNS).find(([, re]) => re.test(lower))?.[0];
      (buckets[bucket || 'other']).push(value);
    }
    // References: an array-of-objects field inside fragments whose items carry URLs
    // (e.g. SEARCH fragment's `results`).
    const refField = findReferenceField(items, '');
    let refItemFields = {};
    if (refField) {
      const refItems = items.map((i) => i[refField]).filter((v) => Array.isArray(v)).flat().filter(isObject);
      refItemFields = detectReferenceItemFields(refItems);
    }
    return {
      field: key,
      type_field: typeField,
      content_field: contentField,
      type_buckets: buckets,
      reference_field: refField,
      reference_item_fields: refItemFields,
    };
  }
  return null;
}

function detectReferenceItemFields(items) {
  const fields = { url: '', title: '', snippet: '', number: '', date: '', site: '', domain: '' };
  const sample = items.filter(isObject);
  if (!sample.length) return fields;

  fields.url = pickField(sample, REF_URL_FIELDS, (v) => looksLikeUrl(v));
  if (!fields.url) {
    for (const key of Object.keys(sample[0])) {
      if (sample.some((item) => looksLikeUrl(item[key]))) {
        fields.url = key;
        break;
      }
    }
  }
  fields.title = pickField(sample, REF_TITLE_FIELDS, (v) => typeof v === 'string' && v.trim() && !looksLikeUrl(v));
  fields.snippet = pickField(sample, REF_SNIPPET_FIELDS, (v) => typeof v === 'string' && v.trim());
  fields.number = pickField(sample, REF_NUMBER_FIELDS, (v) => typeof v === 'number' && Number.isFinite(v));
  if (!fields.number) {
    // Adaptive fallback: unknown key name (idx/n/seq...) — scan by value pattern
    // combined with an index-like key hint.
    for (const key of Object.keys(sample[0])) {
      const numeric = sample.filter((item) => typeof item[key] === 'number' && Number.isFinite(item[key])).length;
      if (numeric >= Math.ceil(sample.length * 0.6) && /idx|index|num|order|seq|no$|cite|rank|position/i.test(key)) {
        fields.number = key;
        break;
      }
    }
  }
  fields.date = pickField(sample, REF_DATE_FIELDS, (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim()));
  fields.site = pickField(sample, REF_SITE_FIELDS, (v) => typeof v === 'string' && v.trim() && !looksLikeUrl(v));
  fields.domain = pickField(sample, REF_DOMAIN_FIELDS, (v) => typeof v === 'string' && v.trim() && !looksLikeUrl(v));
  return fields;
}

function formatDateValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function formatIsoEpoch(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function computeFingerprint(summary) {
  const canonical = JSON.stringify({
    messages_path: summary.messages_path,
    role_field: summary.role_field,
    content_field: summary.content_field,
    status_field: summary.status_field,
    incomplete_field: summary.incomplete_field,
    token_field: summary.token_field,
    reference_field: summary.reference_field,
    reference_item_fields: summary.reference_item_fields,
    fragments: summary.fragments
      ? {
        field: summary.fragments.field,
        type_field: summary.fragments.type_field,
        content_field: summary.fragments.content_field,
        reference_field: summary.fragments.reference_field,
      }
      : null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Probe a share payload and describe its structure without assuming field paths.
 * @param {*} payload parsed share JSON (full API envelope or inner object)
 * @returns probe summary: paths, detected fields, fingerprint, confidence, warnings
 */
export function probeShareStructure(payload) {
  const warnings = [];
  let messages = null;
  let messagesPath = '';
  let knownLayout = false;
  let roleField = '';
  let contentField = '';

  for (const candidatePath of KNOWN_MESSAGE_PATHS) {
    const value = dig(payload, candidatePath);
    if (Array.isArray(value) && value.some(isObject)) {
      const scored = scoreMessagesArray(value);
      if (scored) {
        messages = value;
        messagesPath = candidatePath;
        knownLayout = true;
        roleField = scored.roleField;
        contentField = scored.contentField;
        break;
      }
    }
  }

  if (!messages) {
    let best = null;
    for (const candidate of collectArrays(payload)) {
      const scored = scoreMessagesArray(candidate.value);
      if (scored && (!best || scored.score > best.scored.score
        || (scored.score === best.scored.score && scored.itemCount > best.scored.itemCount))) {
        best = { candidate, scored };
      }
    }
    if (best) {
      messages = best.candidate.value;
      messagesPath = normalizeArrayPath(best.candidate.path) || '(root array)';
      roleField = best.scored.roleField;
      contentField = best.scored.contentField;
    }
  }

  if (!messages) {
    return {
      ok: false,
      known_layout: false,
      fingerprint: '',
      confidence: 'none',
      messages_path: '',
      message_count: 0,
      role_field: '',
      content_field: '',
      status_field: '',
      incomplete_field: '',
      token_field: '',
      search_enabled_field: '',
      thinking_enabled_field: '',
      search_status_field: '',
      inserted_at_field: '',
      reference_field: '',
      reference_item_fields: {},
      conversation: {},
      warnings: ['no message array detected in payload'],
    };
  }

  const objectMessages = messages.filter(isObject);

  // Typed-fragment fallback: when message-level content or references are not
  // flat, probe for a fragments[] layout (e.g. REQUEST/SEARCH/RESPONSE blocks).
  const fragments = (!contentField || !referenceFieldExistsAtMessageLevel(objectMessages))
    ? probeFragments(objectMessages)
    : null;

  if (!contentField && !(fragments && fragments.content_field)) {
    warnings.push('content field not confidently detected; extraction may be empty');
  }
  if (!roleField) warnings.push('role field not detected; falling back to first=user, last=assistant');

  const statusField = pickField(objectMessages, STATUS_FIELDS, (v) => typeof v === 'string' && v.trim());
  const incompleteField = pickField(objectMessages, INCOMPLETE_FIELDS, (v) => v !== undefined);
  const tokenField = pickField(objectMessages, TOKEN_FIELDS, (v) => typeof v === 'number' && Number.isFinite(v));
  const searchEnabledField = pickField(objectMessages, SEARCH_ENABLED_FIELDS, (v) => typeof v === 'boolean');
  const thinkingEnabledField = pickField(objectMessages, THINKING_ENABLED_FIELDS, (v) => typeof v === 'boolean');
  const searchStatusField = pickField(objectMessages, SEARCH_STATUS_FIELDS, (v) => typeof v === 'string');
  const insertedAtField = pickField(objectMessages, INSERTED_AT_FIELDS, (v) => typeof v === 'number' && Number.isFinite(v));

  const referenceField = findReferenceField(objectMessages, roleField);
  let referenceItemFields = {};
  if (referenceField) {
    const refItems = objectMessages
      .map((m) => m[referenceField])
      .filter((v) => Array.isArray(v))
      .flat()
      .filter(isObject);
    referenceItemFields = detectReferenceItemFields(refItems);
    if (!referenceItemFields.url) warnings.push('reference array found but no url-like field detected');
  }
  // Fragment-layout references live inside typed blocks; promote them when the
  // message level has no usable reference array.
  let fragmentReferenceField = '';
  let fragmentReferenceItemFields = {};
  if (fragments && fragments.reference_field && (!referenceField || !referenceItemFields.url)) {
    fragmentReferenceField = fragments.reference_field;
    fragmentReferenceItemFields = fragments.reference_item_fields || {};
    if (fragmentReferenceItemFields.url && !referenceField) {
      referenceItemFields = fragmentReferenceItemFields;
    }
    if (!fragmentReferenceItemFields.url) warnings.push('fragment reference array found but no url-like field detected');
  }

  // Conversation-level metadata: parent object of the messages array when reachable.
  let conversation = {};
  if (messagesPath && messagesPath.includes('.')) {
    const parentPath = messagesPath.slice(0, messagesPath.lastIndexOf('.'));
    const parent = dig(payload, parentPath);
    if (isObject(parent)) {
      const titleField = CONVERSATION_TITLE_FIELDS.find((key) => typeof parent[key] === 'string' && parent[key].trim());
      const modelField = MODEL_TYPE_FIELDS.find((key) => typeof parent[key] === 'string' && parent[key].trim());
      conversation = {
        title: titleField ? String(parent[titleField] || '').trim() : '',
        model_type: modelField ? String(parent[modelField] || '').trim() : '',
      };
    }
  }
  if (!conversation.title) {
    const rootTitleField = CONVERSATION_TITLE_FIELDS.find((key) => isObject(payload) && typeof payload[key] === 'string' && payload[key].trim());
    if (rootTitleField) conversation.title = String(payload[rootTitleField]).trim();
  }

  const summary = {
    ok: true,
    known_layout: knownLayout,
    messages_path: messagesPath,
    message_count: messages.length,
    role_field: roleField,
    content_field: contentField,
    status_field: statusField,
    incomplete_field: incompleteField,
    token_field: tokenField,
    search_enabled_field: searchEnabledField,
    thinking_enabled_field: thinkingEnabledField,
    search_status_field: searchStatusField,
    inserted_at_field: insertedAtField,
    reference_field: referenceField,
    reference_item_fields: referenceItemFields,
    fragments,
    fragment_reference_field: fragmentReferenceField,
    conversation,
    warnings,
  };
  summary.fingerprint = computeFingerprint(summary);
  const effectiveContent = Boolean(contentField) || Boolean(fragments && fragments.content_field);
  const effectiveRefOk = referenceField
    ? Boolean(referenceItemFields.url)
    : (fragmentReferenceField ? Boolean(fragmentReferenceItemFields.url) : true);
  summary.confidence = summary.ok && roleField && effectiveContent && effectiveRefOk
    ? (knownLayout ? 'high' : 'medium')
    : 'low';
  return summary;
}

function referenceFieldExistsAtMessageLevel(objectMessages) {
  return Boolean(findReferenceField(objectMessages, ''));
}

function messageRole(message, probe) {
  if (probe.role_field) return normalizeRole(message[probe.role_field]);
  return '';
}

function messageContent(message, probe) {
  if (!probe.content_field) return '';
  const value = message[probe.content_field];
  return typeof value === 'string' ? value : '';
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Extract the unified sample schema from a payload using a probe summary.
 * Returns the same shape as the legacy normalizer plus `structure`.
 */
export function extractSharePayload(payload, probe, meta = {}) {
  if (!probe || !probe.ok) {
    return {
      ok: false,
      complete: false,
      question: '',
      answer_text: '',
      references: [],
      share_meta: {
        share_id: String(meta.share_id || ''),
        share_url: meta.share_id ? `https://chat.deepseek.com/share/${meta.share_id}` : '',
        title: '',
        model_type: '',
        inserted_at: null,
        inserted_at_iso: '',
        search_enabled: false,
        thinking_enabled: false,
        search_status: '',
        message_status: '',
        incomplete_message: null,
        complete: false,
        token_usage: 0,
        message_count: 0,
        source: 'share-api',
      },
      structure: probe || null,
    };
  }

  const messages = Array.isArray(dig(payload, probe.messages_path)) ? dig(payload, probe.messages_path) : [];
  const objectMessages = messages.filter(isObject);
  const roleOf = (message) => messageRole(message, probe);

  let userMessages;
  let assistantMessages;
  if (probe.role_field) {
    userMessages = objectMessages.filter((m) => roleOf(m) === 'user');
    assistantMessages = objectMessages.filter((m) => roleOf(m) === 'assistant');
  } else {
    userMessages = objectMessages.slice(0, Math.max(objectMessages.length - 1, 1));
    assistantMessages = objectMessages.slice(-1);
  }

  const lastUser = userMessages[userMessages.length - 1] || null;
  const lastAssistant = assistantMessages[assistantMessages.length - 1] || objectMessages[objectMessages.length - 1] || null;
  let answerText = cleanText(lastAssistant ? messageContent(lastAssistant, probe) : '');
  let question = cleanText((lastUser ? messageContent(lastUser, probe) : '') || meta.question || '');

  // Fragment-layout extraction: when message-level content is absent, read the
  // typed blocks (REQUEST -> question, RESPONSE -> answer; structural fallbacks
  // when type names are unknown).
  let fragmentSearchBlocks = [];
  if (probe.fragments) {
    const frag = probe.fragments;
    const blocks = [];
    for (const message of objectMessages) {
      const value = message[frag.field];
      if (!Array.isArray(value)) continue;
      for (const block of value) {
        if (isObject(block)) blocks.push(block);
      }
    }
    const blockType = (block) => String(block[frag.type_field] || '').trim();
    const blockContent = (block) => {
      const value = block[frag.content_field];
      return typeof value === 'string' ? value : '';
    };
    const classify = (block) => {
      const type = blockType(block).toLowerCase();
      return Object.entries(FRAGMENT_TYPE_PATTERNS).find(([, re]) => re.test(type))?.[0] || '';
    };
    if (!question) {
      const requestBlock = blocks.find((b) => classify(b) === 'request' && blockContent(b))
        || blocks.find((b) => blockContent(b));
      if (requestBlock) question = cleanText(blockContent(requestBlock));
    }
    if (!answerText) {
      const responseBlocks = blocks.filter((b) => classify(b) === 'response' && blockContent(b));
      const answerBlock = responseBlocks[responseBlocks.length - 1]
        || [...blocks].sort((a, b) => blockContent(b).length - blockContent(a).length)[0];
      if (answerBlock) answerText = cleanText(blockContent(answerBlock));
    }
    fragmentSearchBlocks = blocks.filter((b) => classify(b) === 'search'
      || (frag.reference_field && Array.isArray(b[frag.reference_field]) && b[frag.reference_field].length));
  }

  // References: last assistant message that carries an array under the detected field.
  let referenceSource = null;
  if (probe.reference_field) {
    for (let i = objectMessages.length - 1; i >= 0; i -= 1) {
      const value = objectMessages[i][probe.reference_field];
      if (Array.isArray(value)) {
        referenceSource = value;
        break;
      }
    }
  }
  if (!referenceSource && probe.fragments && probe.fragments.reference_field) {
    // Fragment layout: references live inside typed blocks (e.g. SEARCH.results).
    for (let i = fragmentSearchBlocks.length - 1; i >= 0; i -= 1) {
      const value = fragmentSearchBlocks[i][probe.fragments.reference_field];
      if (Array.isArray(value) && value.length) {
        referenceSource = value;
        break;
      }
    }
    if (!referenceSource) {
      // Structural fallback: any block array that holds URL-bearing objects.
      for (let i = fragmentSearchBlocks.length - 1; i >= 0; i -= 1) {
        for (const value of Object.values(fragmentSearchBlocks[i])) {
          if (Array.isArray(value) && value.some((item) => isObject(item) && Object.values(item).some((v) => looksLikeUrl(v)))) {
            referenceSource = value;
            break;
          }
        }
        if (referenceSource) break;
      }
    }
  }
  const fields = (referenceSource && probe.fragments && !probe.reference_field && probe.fragments.reference_item_fields.url)
    ? probe.fragments.reference_item_fields
    : (probe.reference_item_fields || {});
  const references = (referenceSource || [])
    .filter(isObject)
    .map((item) => {
      let url = '';
      if (fields.url && looksLikeUrl(item[fields.url])) url = String(item[fields.url]).trim();
      if (!url) {
        const fallback = Object.values(item).find((v) => looksLikeUrl(v));
        if (fallback) url = String(fallback).trim();
      }
      const domain = (fields.domain && String(item[fields.domain] || '').trim())
        || hostnameFromUrl(url);
      const site = fields.site ? String(item[fields.site] || '').trim() : '';
      const source = site || domain || '';
      const title = fields.title ? String(item[fields.title] || '').trim() : '';
      const summary = fields.snippet ? String(item[fields.snippet] || '').trim() : '';
      const numberRaw = fields.number ? item[fields.number] : null;
      const number = typeof numberRaw === 'number' && Number.isFinite(numberRaw) ? numberRaw : null;
      const originTag = (name) => `share-api-${String(name || '').replace(/_/g, '-')}`;
      return {
        number,
        source,
        source_origin: site && site !== domain ? originTag(fields.site) : 'share-api-url-hostname',
        domain,
        title,
        title_origin: title ? originTag(fields.title || 'title') : '',
        date: fields.date ? formatDateValue(item[fields.date]) : '',
        url,
        summary,
        summary_origin: summary ? originTag(fields.snippet || 'snippet') : '',
      };
    })
    .filter((ref) => ref.url);

  const statusRaw = (lastAssistant && probe.status_field) ? String(lastAssistant[probe.status_field] || '') : '';
  const statusUpper = statusRaw.trim().toUpperCase();
  const incompleteRaw = (lastAssistant && probe.incomplete_field)
    ? lastAssistant[probe.incomplete_field] ?? null
    : null;
  const hasStatus = Boolean(statusUpper);
  const complete = hasStatus
    ? (FINISHED_STATUSES.has(statusUpper) && (incompleteRaw == null || incompleteRaw === ''))
    : Boolean(answerText) && (incompleteRaw == null || incompleteRaw === '');

  let tokenUsage = 0;
  if (probe.token_field) {
    for (const message of objectMessages) {
      const value = message[probe.token_field];
      if (typeof value === 'number' && Number.isFinite(value)) tokenUsage += value;
    }
  }

  const insertedAt = (lastAssistant && probe.inserted_at_field && typeof lastAssistant[probe.inserted_at_field] === 'number')
    ? lastAssistant[probe.inserted_at_field]
    : null;

  const shareMeta = {
    share_id: String(meta.share_id || ''),
    share_url: meta.share_id ? `https://chat.deepseek.com/share/${meta.share_id}` : '',
    title: (probe.conversation && probe.conversation.title) || '',
    model_type: (probe.conversation && probe.conversation.model_type) || '',
    inserted_at: insertedAt,
    inserted_at_iso: insertedAt != null ? formatIsoEpoch(insertedAt) : '',
    search_enabled: Boolean(lastAssistant && probe.search_enabled_field && lastAssistant[probe.search_enabled_field]),
    thinking_enabled: Boolean(lastAssistant && probe.thinking_enabled_field && lastAssistant[probe.thinking_enabled_field]),
    search_status: (lastAssistant && probe.search_status_field) ? String(lastAssistant[probe.search_status_field] || '') : '',
    message_status: statusUpper,
    incomplete_message: incompleteRaw,
    complete,
    token_usage: tokenUsage,
    message_count: messages.length,
    source: 'share-api',
  };

  return {
    ok: Boolean(answerText) && complete,
    complete,
    question,
    answer_text: answerText,
    references,
    share_meta: shareMeta,
    structure: probe,
  };
}

/**
 * One-call probe + extract for a parsed share payload.
 */
export function normalizeShareStructure(payload, meta = {}) {
  const probe = probeShareStructure(payload);
  return extractSharePayload(payload, probe, meta);
}
