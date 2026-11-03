import fs from 'node:fs';
import path from 'node:path';
import { normalizeShareStructure } from './share-structure.mjs';

export const SHARE_CONTENT_URL = 'https://chat.deepseek.com/api/v0/share/content';
export const SHARE_PAGE_URL = 'https://chat.deepseek.com/share';

export function shareIdFromUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/\/share\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return text && /^[A-Za-z0-9_-]{4,}$/.test(text) ? text : null;
}

export function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function conversationIdFromUrl(value) {
  const text = String(value || '');
  const match = text.match(/\/a\/chat\/s\/([a-f0-9-]{36})(?:\/|$)/i) || text.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/|$)/i);
  return match ? match[1].toLowerCase() : '';
}

export async function fetchHistoryMessages(conversationId, token) {
  const url = `https://chat.deepseek.com/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(conversationId)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`History HTTP ${response.status} for ${conversationId}`);
  const json = await response.json();
  if (json.code !== 0 || json.data?.biz_code !== 0) {
    throw new Error(`History failed for ${conversationId}: code=${json.code} biz_code=${json.data?.biz_code}`);
  }
  return (json.data.biz_data && json.data.biz_data.chat_messages) || [];
}

export async function createShare(conversationId, messageIds, token) {
  const response = await fetch('https://chat.deepseek.com/api/v0/share/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ chat_session_id: conversationId, message_ids: messageIds }),
  });
  if (!response.ok) throw new Error(`Share create HTTP ${response.status} for ${conversationId}`);
  const json = await response.json();
  if (json.code !== 0 || json.data?.biz_code !== 0) {
    throw new Error(`Share create failed for ${conversationId}: code=${json.code} biz_code=${json.data?.biz_code}`);
  }
  return json.data.biz_data.share_id;
}

export async function fetchShareContent(shareId, options = {}) {
  const url = `${SHARE_CONTENT_URL}?share_id=${encodeURIComponent(shareId)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'deepseek-crawler-web-share/0.1',
      Accept: 'application/json',
      Referer: `${SHARE_PAGE_URL}/${encodeURIComponent(shareId)}`,
      ...(options.headers || {}),
    },
    ...(options.fetchOptions || {}),
  });
  if (!response.ok) {
    throw new Error(`Share content HTTP ${response.status} for ${shareId}`);
  }
  const json = await response.json();
  const code = json && json.code;
  const bizCode = json && json.data && json.data.biz_code;
  if (code !== 0 || bizCode !== 0) {
    throw new Error(`Share content failed for ${shareId}: code=${code} biz_code=${bizCode}`);
  }
  return json;
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizeShareContent(shareContent, meta = {}) {
  // Structure-adaptive entry: probe the payload layout first, then extract
  // according to the discovered fields (see share-structure.mjs). The known
  // DeepSeek envelope is only the high-priority candidate, not a hardcode.
  return normalizeShareStructure(shareContent, meta);
}

export function parseShareLinksInput(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const trimmed = raw.trim();
  let values;
  if (trimmed.startsWith('[')) {
    values = JSON.parse(trimmed);
  } else {
    values = trimmed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  }
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value && typeof value === 'object') {
      const id = shareIdFromUrl(value.url || value.link || value.share_id || value.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, share_id: id, source: value });
      }
    } else {
      const id = shareIdFromUrl(value);
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, share_id: id, source: value });
      }
    }
  }
  return out;
}

