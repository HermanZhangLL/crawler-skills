import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toSimplified } from './t2s.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatePath = path.join(__dirname, 'field-map-template.html');
let templateCache = null;

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function safeFieldMapName(key) {
  const cleaned = cleanText(key || 'sample').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, '_').slice(0, 80);
  return cleaned || 'sample';
}

export function collectFieldMapSamples(dataset) {
  const out = new Map();
  for (const sample of dataset.samples || []) {
    if (!sample.result || !sample.result.answer?.text) continue;
    const question = cleanText(sample.question || sample.result.question || '');
    const key = question && question !== sample.sample_id ? question : (sample.question_id || sample.sample_id);
    if (!out.has(key)) out.set(key, sample);
  }
  return Array.from(out.entries());
}

function fallbackShareContent(sample) {
  const result = sample.result || {};
  const refs = Array.isArray(result.references?.items) ? result.references.items : [];
  const question = String(sample.question || result.question || '');
  const answer = String(result.answer?.text || '');
  const collected = result.collected_at ? Date.parse(result.collected_at) / 1000 : null;
  return {
    data: {
      biz_data: {
        title: question,
        model_type: 'default',
        messages: [
          {
            message_id: 1,
            parent_id: null,
            model: '',
            role: 'USER',
            status: 'FINISHED',
            incomplete_message: null,
            accumulated_token_usage: 0,
            inserted_at: collected,
            search_enabled: true,
            thinking_enabled: false,
            content: question,
            search_status: null,
            search_results: null,
          },
          {
            message_id: 2,
            parent_id: 1,
            model: '',
            role: 'ASSISTANT',
            status: 'FINISHED',
            incomplete_message: null,
            accumulated_token_usage: 0,
            inserted_at: collected,
            search_enabled: true,
            thinking_enabled: false,
            content: answer,
            search_status: refs.length ? 'FINISHED' : '',
            search_results: refs.map((r, index) => ({
              cite_index: r.number ?? index + 1,
              url: r.url || '',
              title: r.title || '',
              snippet: r.summary || '',
              published_at: r.date ? Date.parse(r.date) / 1000 : null,
              site_name: r.source || null,
              domain: r.domain || '',
              query_indexes: [0],
            })),
          },
        ],
      },
    },
  };
}

export function renderFieldMapHtml(sample, dataset = {}, options = {}) {
  const result = sample.result || {};
  const shareContent = result.share?.content || (result.data?.biz_data ? result : fallbackShareContent(sample));
  if (!shareContent) return null;
  if (!templateCache) templateCache = fs.readFileSync(templatePath, 'utf8');
  const shareId = String(result.share?.share_id || result.share_meta?.share_id || '');
  const title = esc(options.title || `DeepSeek 数据字段地图 · ${sample.question_id || sample.sample_id || 'sample'}`);
  const displayContent = toSimplified(shareContent);
  let html = templateCache
    .replace('__PAGE_TITLE__', title)
    .replace('__SHARE_DATA_JSON_DISPLAY__', JSON.stringify(displayContent))
    .replace('__SHARE_DATA_JSON_RAW__', JSON.stringify(shareContent))
    .replace('__SHARE_ID__', JSON.stringify(shareId));
  return html;
}
