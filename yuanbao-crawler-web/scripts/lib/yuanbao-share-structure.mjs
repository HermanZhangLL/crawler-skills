import crypto from 'node:crypto';

// Structure-adaptive probe + extraction for Tencent Yuanbao public share payloads.
// The share page embeds a Next.js __NEXT_DATA__ JSON whose chat payload path and
// field names iterate over time (observed: props.pageProps.fullChatShareData with
// chat.convs[].speechesV2[].content[] blocks). Field paths are never hardcoded as
// the only option: the probe first tries known paths as high-priority candidates,
// then scans the payload for structurally matching objects. A fingerprint of the
// discovered layout is stored with every extraction so drift stays auditable.

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

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function iso(epoch) {
  const value = Number(epoch);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function looksLikeUrl(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
}

const KNOWN_ROOT_PATHS = [
  'props.pageProps.fullChatShareData',
  'props.pageProps.shareData',
  'pageProps.fullChatShareData',
  'fullChatShareData',
];

const SPEAKER_FIELDS = ['speaker', 'role', 'sender', 'author', 'who'];
const HUMAN_VALUES = new Set(['human', 'user', 'person', '我', '用户']);
const AI_VALUES = new Set(['ai', 'assistant', 'bot', 'model', 'agent', '元宝', '助手']);
const CONVS_FIELDS = ['convs', 'messages', 'conversation', 'turns', 'items'];
const CONTENT_FIELDS = ['content', 'blocks', 'parts', 'segments', 'items'];
const TEXT_BLOCK_FIELDS = ['msg', 'text', 'content', 'message', 'body', 'answer', 'value'];
const DOC_ARRAY_FIELDS = ['docs', 'documents', 'references', 'sources', 'citations', 'searchResults'];
const MEDIA_ARRAY_FIELDS = ['multimedias', 'medias', 'mediaList', 'images'];
const BLOCK_TYPE_FIELDS = ['type', 'kind', 'blockType', 'contentType'];

function normalizeSpeaker(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';
  if (HUMAN_VALUES.has(text)) return 'human';
  if (AI_VALUES.has(text)) return 'ai';
  if (/user|human|我|用户/.test(text)) return 'human';
  if (/ai|assist|bot|model|agent|助手/.test(text)) return 'ai';
  return text;
}

// ---- probe -----------------------------------------------------------------

function findRoot(payload) {
  for (const path of KNOWN_ROOT_PATHS) {
    const value = dig(payload, path);
    if (isObject(value) && (isObject(value.chat) || Array.isArray(value.convs) || isObject(value.id))) {
      return { root: value, path, known_layout: true };
    }
  }
  // Structural scan: BFS for an object holding a convs-like array of speaker objects.
  const queue = [{ value: payload, path: '' }];
  let seen = 0;
  while (queue.length && seen < 3000) {
    const { value, path } = queue.shift();
    seen += 1;
    if (!isObject(value)) continue;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (Array.isArray(child)) {
        const objects = child.filter(isObject);
        if (objects.length >= 1) {
          const hasSpeaker = objects.some((item) =>
            SPEAKER_FIELDS.some((field) => normalizeSpeaker(item[field])));
          const hasSpeech = objects.some((item) =>
            ['speech', 'displayPrompt', 'speechesV2', 'speeches', 'content'].some((field) => field in item));
          if (hasSpeaker || hasSpeech) {
            return { root: value, path: childPath.replace(/\.[^.]+$/, ''), known_layout: false, convs_key: key };
          }
        }
      } else if (isObject(child)) {
        queue.push({ value: child, path: childPath });
      }
    }
  }
  return { root: null, path: '', known_layout: false };
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

/**
 * Probe a parsed __NEXT_DATA__ payload and describe its structure.
 * @returns probe summary: root path, discovered fields, fingerprint, confidence, warnings
 */
export function probeYuanbaoShare(payload) {
  const warnings = [];
  const found = findRoot(payload);
  if (!found.root) {
    return {
      ok: false,
      confidence: 'none',
      fingerprint: '',
      root_path: '',
      warnings: ['no chat payload with a speaker-like conversation array detected'],
    };
  }
  const root = found.root;
  const warningsOut = warnings;

  // Conversations array: prefer chat.convs, then any convs-like key on the root.
  let convs = null;
  let convsPath = '';
  if (isObject(root.chat) && Array.isArray(root.chat.convs)) {
    convs = root.chat.convs;
    convsPath = found.path ? `${found.path}.chat.convs` : 'chat.convs';
  } else {
    for (const key of CONVS_FIELDS) {
      if (Array.isArray(root[key]) && root[key].some(isObject)) {
        convs = root[key];
        convsPath = found.path ? `${found.path}.${key}` : key;
        break;
      }
    }
    if (!convs) {
      for (const [key, value] of Object.entries(root)) {
        if (Array.isArray(value) && value.some(isObject)
          && value.some((item) => SPEAKER_FIELDS.some((f) => normalizeSpeaker(item[f])))) {
          convs = value;
          convsPath = found.path ? `${found.path}.${key}` : key;
          break;
        }
      }
    }
  }
  if (!Array.isArray(convs) || !convs.some(isObject)) {
    return {
      ok: false,
      confidence: 'none',
      fingerprint: '',
      root_path: found.path,
      warnings: ['chat payload found but no conversation array inside it'],
    };
  }
  const convItems = convs.filter(isObject);

  const speakerField = pickField(convItems, SPEAKER_FIELDS, (v) => Boolean(normalizeSpeaker(v)));
  const hasHuman = convItems.some((c) => normalizeSpeaker(speakerField ? c[speakerField] : '') === 'human');
  const hasAi = convItems.some((c) => normalizeSpeaker(speakerField ? c[speakerField] : '') === 'ai');
  if (!speakerField) warningsOut.push('speaker field not detected; falling back to first=human, last=ai');

  // Question field on the human conversation.
  const humanConv = (speakerField && convItems.find((c) => normalizeSpeaker(c[speakerField]) === 'human')) || convItems[0] || null;
  const questionField = humanConv
    ? pickField([humanConv], ['speech', 'displayPrompt', 'prompt', 'question', 'text'], (v) => typeof v === 'string' && v.trim())
    : '';
  if (humanConv && !questionField) warningsOut.push('question text field not detected on human turn');

  // Assistant content: speechesV2[0].content style — detect the speech container and block array.
  const aiConv = (speakerField && convItems.find((c) => normalizeSpeaker(c[speakerField]) === 'ai')) || convItems[convItems.length - 1] || null;
  let speechField = '';
  let speechIndex = 0;
  let blocksField = '';
  let blocks = [];
  if (aiConv) {
    for (const key of ['speechesV2', 'speeches', 'speechList', 'replies', 'responses']) {
      const value = aiConv[key];
      if (Array.isArray(value) && value.length && isObject(value[0])) {
        speechField = key;
        const first = value[0];
        for (const field of CONTENT_FIELDS) {
          if (Array.isArray(first[field]) && first[field].some(isObject)) {
            blocksField = field;
            blocks = first[field];
            break;
          }
        }
        if (!blocksField && Array.isArray(first.content) === false && typeof first.content === 'string') {
          blocks = [{ type: 'text', msg: first.content }];
          blocksField = '(inline-text)';
        }
        break;
      }
    }
    if (!speechField) {
      // Maybe the ai conv itself carries the block array directly.
      for (const field of CONTENT_FIELDS) {
        const value = aiConv[field];
        if (Array.isArray(value) && value.some(isObject)) {
          speechField = '(direct)';
          blocksField = field;
          blocks = value;
          break;
        }
      }
      if (!speechField && typeof aiConv.content === 'string' && aiConv.content.trim()) {
        speechField = '(inline-text)';
        blocks = [{ type: 'text', msg: aiConv.content }];
        blocksField = '(inline-text)';
      }
    }
  }
  if (!blocks.length) warningsOut.push('assistant content blocks not detected; answer will be empty');

  const blockItems = blocks.filter(isObject);
  const blockTypeField = blockItems.length
    ? pickField(blockItems, BLOCK_TYPE_FIELDS, (v) => typeof v === 'string' && v.trim())
    : '';

  // Classify block roles by structure: docs array -> search, multimedias -> media, msg/text -> text.
  let textField = blockItems.length
    ? pickField(blockItems, TEXT_BLOCK_FIELDS, (v) => typeof v === 'string')
    : '';
  if (!textField && blockItems.length) {
    // Adaptive fallback: longest string-valued field across blocks that is not
    // the type field (handles renamed body fields); arrays/objects are skipped
    // so docs/media containers never win.
    const skip = new Set([blockTypeField].filter(Boolean));
    const scores = new Map();
    for (const block of blockItems) {
      for (const [key, value] of Object.entries(block)) {
        if (skip.has(key) || Array.isArray(value) || (value != null && typeof value === 'object')) continue;
        if (typeof value === 'string' && value.trim()) {
          scores.set(key, (scores.get(key) || 0) + value.length);
        }
      }
    }
    if (scores.size) {
      textField = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  const docArrayField = blockItems.length
    ? pickField(blockItems, DOC_ARRAY_FIELDS, (v) => Array.isArray(v) && v.some(isObject))
    : '';
  const mediaArrayField = blockItems.length
    ? pickField(blockItems, MEDIA_ARRAY_FIELDS, (v) => Array.isArray(v) && v.some(isObject))
    : '';

  // Reference item field aliases inside docs[].
  let refFields = {};
  if (docArrayField) {
    const docs = blockItems
      .map((b) => b[docArrayField])
      .filter((v) => Array.isArray(v))
      .flat()
      .filter(isObject);
    if (docs.length) {
      refFields = {
        url: pickField(docs, ['url', 'link', 'href'], (v) => looksLikeUrl(v)) || (docs.some((d) => Object.values(d).some(looksLikeUrl)) ? '(any-url)' : ''),
        title: pickField(docs, ['title', 'name', 'headline'], (v) => typeof v === 'string' && v.trim()),
        index: pickField(docs, ['index', 'idx', 'order', 'seq', 'citeIndex'], (v) => typeof v === 'number' || typeof v === 'string'),
        doc_id: pickField(docs, ['docId', 'doc_id', 'doc_key', 'docKey', 'id', 'key'], (v) => typeof v === 'string' && v.trim()),
        source_type: pickField(docs, ['sourceType', 'source_type', 'type'], (v) => typeof v === 'string'),
        source_name: pickField(docs, ['sourceName', 'source_name', 'siteName'], (v) => typeof v === 'string'),
        web_site_name: pickField(docs, ['web_site_name', 'websiteName', 'site'], (v) => typeof v === 'string'),
        quote: pickField(docs, ['quote', 'snippet', 'summary'], (v) => typeof v === 'string'),
      };
      if (!refFields.url) warningsOut.push('docs array found but no url-like field detected');
    }
  }

  // Share metadata: shareId may live on pageProps or any ancestor of the root
  // path — walk up until found.
  let pageProps = null;
  let pagePropsPath = '';
  let shareIdField = '';
  const ancestorPaths = [];
  const basePath = found.path ? found.path.replace(/\.[^.]+$/, '') : '';
  if (basePath) {
    let cursor = basePath;
    while (cursor) {
      ancestorPaths.push(cursor);
      const dot = cursor.lastIndexOf('.');
      cursor = dot >= 0 ? cursor.slice(0, dot) : '';
    }
  }
  ancestorPaths.push('props.pageProps', 'pageProps');
  for (const candidate of ancestorPaths) {
    const node = dig(payload, candidate);
    if (!isObject(node)) continue;
    const field = pickField([node], ['shareId', 'share_id', 'shareID'], (v) => typeof v === 'string' && v.trim());
    if (field) {
      pageProps = node;
      pagePropsPath = candidate;
      shareIdField = field;
      break;
    }
  }

  const summary = {
    ok: true,
    known_layout: found.known_layout,
    root_path: found.path,
    convs_path: convsPath,
    message_count: convItems.length,
    speaker_field: speakerField,
    human_detected: hasHuman || Boolean(speakerField),
    ai_detected: hasAi || Boolean(speakerField),
    question_field: questionField,
    speech_field: speechField,
    blocks_field: blocksField,
    block_type_field: blockTypeField,
    text_block_field: textField,
    doc_array_field: docArrayField,
    media_array_field: mediaArrayField,
    reference_item_fields: refFields,
    page_props_path: isObject(pageProps) ? pagePropsPath : '',
    share_id_field: shareIdField,
    warnings: warningsOut,
  };
  summary.fingerprint = computeFingerprint(summary);
  summary.confidence = summary.ok
    ? (found.known_layout && speakerField && questionField && blocks.length && (docArrayField ? refFields.url : true)
      ? 'high'
      : (speakerField || blocks.length) ? 'medium' : 'low')
    : 'none';
  return summary;
}

function computeFingerprint(summary) {
  const canonical = JSON.stringify({
    root_path: summary.root_path,
    convs_path: summary.convs_path,
    speaker_field: summary.speaker_field,
    question_field: summary.question_field,
    speech_field: summary.speech_field,
    blocks_field: summary.blocks_field,
    block_type_field: summary.block_type_field,
    text_block_field: summary.text_block_field,
    doc_array_field: summary.doc_array_field,
    media_array_field: summary.media_array_field,
    reference_item_fields: summary.reference_item_fields,
    share_id_field: summary.share_id_field,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

// ---- extraction ------------------------------------------------------------

function extractDocs(block, probe) {
  const field = probe.doc_array_field;
  if (!field) return [];
  const docs = Array.isArray(block[field]) ? block[field].filter(isObject) : [];
  const f = probe.reference_item_fields || {};
  const refFrom = (doc, key) => (f[key] && f[key] !== '(any-url)' ? doc[f[key]] : undefined);
  const urlOf = (doc) => {
    if (f.url && f.url !== '(any-url)' && looksLikeUrl(doc[f.url])) return String(doc[f.url]).trim();
    const any = Object.values(doc).find((v) => looksLikeUrl(v));
    return any ? String(any).trim() : '';
  };
  return docs.map((doc) => {
    const rawIndex = refFrom(doc, 'index');
    const index = rawIndex == null || rawIndex === '' ? null : (Number.isFinite(Number(rawIndex)) ? Number(rawIndex) : null);
    return {
      index,
      doc_id: clean(refFrom(doc, 'doc_id')),
      title: clean(refFrom(doc, 'title')),
      url: urlOf(doc),
      source_type: clean(refFrom(doc, 'source_type')),
      source_name: clean(refFrom(doc, 'source_name')),
      web_site_name: clean(refFrom(doc, 'web_site_name')),
      quote: clean(refFrom(doc, 'quote')),
    };
  }).filter((ref) => ref.url || ref.title);
}

function extractMedia(block, probe) {
  const field = probe.media_array_field;
  if (!field) return [];
  const items = Array.isArray(block[field]) ? block[field].filter(isObject) : [];
  return items.map((item) => ({
    display: String(item.display || item.name || '').trim(),
    description: clean(item.description || item.desc || ''),
    jump_url: String(item.jumpUrl || item.jump_url || '').trim(),
    url: String(item.url || item.link || '').trim(),
  })).filter((m) => m.url || m.display);
}

/**
 * Extract the unified share schema from a payload using a probe summary.
 * Returns the same shape as the legacy normalizer plus `structure`.
 */
export function extractYuanbaoShare(payload, probe) {
  if (!probe || !probe.ok) {
    return {
      ok: false,
      error: (probe && probe.warnings && probe.warnings[0]) || 'share payload structure could not be probed',
      structure: probe || null,
    };
  }
  const found = findRoot(payload);
  const root = found.root;
  const convs = dig(payload, probe.convs_path) || [];
  const convItems = Array.isArray(convs) ? convs.filter(isObject) : [];

  const roleOf = (conv) => (probe.speaker_field ? normalizeSpeaker(conv[probe.speaker_field]) : '');
  const humanConv = (probe.speaker_field && convItems.find((c) => roleOf(c) === 'human')) || convItems[0] || null;
  const aiConv = (probe.speaker_field && convItems.find((c) => roleOf(c) === 'ai')) || convItems[convItems.length - 1] || null;

  const question = humanConv && probe.question_field ? clean(humanConv[probe.question_field]) : '';

  // Blocks: speech container or direct block array on the ai conversation.
  let blocks = [];
  if (aiConv && probe.speech_field && probe.speech_field !== '(direct)' && probe.speech_field !== '(inline-text)') {
    const speeches = Array.isArray(aiConv[probe.speech_field]) ? aiConv[probe.speech_field] : [];
    const firstSpeech = speeches.find(isObject) || null;
    if (firstSpeech && probe.blocks_field && probe.blocks_field !== '(inline-text)') {
      blocks = Array.isArray(firstSpeech[probe.blocks_field]) ? firstSpeech[probe.blocks_field] : [];
    } else if (firstSpeech && typeof firstSpeech.content === 'string') {
      blocks = [{ type: 'text', msg: firstSpeech.content }];
    }
  } else if (aiConv && probe.speech_field === '(direct)' && probe.blocks_field) {
    blocks = Array.isArray(aiConv[probe.blocks_field]) ? aiConv[probe.blocks_field] : [];
  } else if (aiConv && probe.speech_field === '(inline-text)' && typeof aiConv.content === 'string') {
    blocks = [{ type: 'text', msg: aiConv.content }];
  }
  const blockItems = blocks.filter(isObject);

  // Answer: text blocks joined (structural classification first, type-name fallback).
  const isTextBlock = (block) => {
    if (probe.text_block_field && typeof block[probe.text_block_field] === 'string') {
      if (probe.doc_array_field && Array.isArray(block[probe.doc_array_field])) return false;
      if (probe.media_array_field && Array.isArray(block[probe.media_array_field])) return false;
      return true;
    }
    return false;
  };
  const answer = blockItems
    .filter(isTextBlock)
    .map((block) => String(block[probe.text_block_field] || ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // References and media: walk blocks structurally (docs array / media array present).
  const references = [];
  const media = [];
  for (const block of blockItems) {
    references.push(...extractDocs(block, probe));
    media.push(...extractMedia(block, probe));
  }
  references.sort((a, b) => (a.index || 0) - (b.index || 0));

  // Share metadata: pageProps shareId + root-level share/chat fields.
  const pageProps = probe.page_props_path ? dig(payload, probe.page_props_path) : null;
  const shareId = (pageProps && probe.share_id_field) ? String(pageProps[probe.share_id_field] || '').trim() : '';
  const chat = (root && isObject(root.chat)) ? root.chat : {};
  const domains = [...new Set(references.map((ref) => {
    try { return new URL(ref.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }).filter(Boolean))];
  const sourceTypes = {};
  for (const ref of references) {
    const key = ref.source_type || 'unknown';
    sourceTypes[key] = (sourceTypes[key] || 0) + 1;
  }

  return {
    ok: Boolean(question || answer),
    schema_version: 'yuanbao-crawler-share/v1',
    share: {
      url: shareId ? `https://yb.tencent.com/s/${shareId}` : '',
      share_id: shareId,
      internal_id: clean(root && root.id),
      title: clean(chat.title || (root && root.title)),
      share_time_iso: iso(root && root.shareTime),
      expire_time_iso: iso(root && root.expireTime),
      platform: clean(root && root.platform),
      user_name: clean((chat.userInfo && chat.userInfo.name) || (root && root.userName)),
      user_avatar: String((chat.userInfo && chat.userInfo.imageUrl) || '').trim(),
    },
    chat: {
      id: clean(chat.id),
      agent_id: clean(chat.agentId || (root && root.agentId)),
      chat_model_id: clean(chat.chatModelId),
      model_id: clean(chat.modelId || (aiConv && aiConv.modelId)),
      internet_search: clean((humanConv && humanConv.internetSearch) || (aiConv && aiConv.internetSearch)),
      internet_flag: (humanConv && humanConv.internetFlag) ?? (aiConv && aiConv.internetFlag) ?? null,
      created_at_iso: iso(humanConv && humanConv.createTime),
      first_replied_at_iso: iso(chat.firstRepliedAt),
      last_replied_at_iso: iso(chat.lastRepliedAt),
    },
    question: { text: question },
    answer: { text: answer, char_count: answer.length },
    references,
    media,
    counts: {
      messages: convItems.length,
      references: references.length,
      media: media.length,
      unique_domains: domains.length,
      domains,
      source_types: sourceTypes,
    },
    structure: probe,
  };
}

/** One-call probe + extract for a parsed __NEXT_DATA__ payload. */
export function normalizeYuanbaoShare(payload) {
  const probe = probeYuanbaoShare(payload);
  return extractYuanbaoShare(payload, probe);
}
