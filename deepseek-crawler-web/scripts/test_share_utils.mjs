#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  normalizeShareContent,
  parseShareLinksInput,
  shareIdFromUrl,
} from './lib/share-utils.mjs';
import { exportDatasetStore } from './lib/store-writer.mjs';
import { collectFieldMapSamples, renderFieldMapHtml } from './lib/field-map-render.mjs';
import { toSimplified } from './lib/t2s.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const fixturePath = path.join(skillRoot, 'fixtures', 'sample-deepseek-share.json');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-share-test-'));
  tempDirs.push(dir);
  return dir;
}

function buildSample(shareContent, shareId) {
  const normalized = normalizeShareContent(shareContent, { share_id: shareId });
  const result = {
    schema_version: 'deepseek-crawler-raw/share-api-v1',
    ok: normalized.ok,
    transport: 'deepseek-share-api',
    collected_at: '2026-08-05T00:00:00.000Z',
    session: shareId,
    question: normalized.question,
    target: '',
    search: normalized.share_meta.search_enabled,
    answer: { text: normalized.answer_text, length: normalized.answer_text.length },
    references: { count: normalized.references.length, observed_count: normalized.references.length, items: normalized.references, verified: true, source: 'share-api' },
    share: { requested: true, created: true, share_ok: true, share_id: shareId, url: normalized.share_meta.share_url, content: shareContent },
    share_meta: normalized.share_meta,
    error: '',
  };
  return {
    sample_id: shareId,
    question_id: shareId,
    question: normalized.question,
    repeat_index: 1,
    ok: true,
    status: 'done',
    started_at: '2026-08-05T00:00:00.000Z',
    finished_at: '2026-08-05T00:00:00.000Z',
    duration_ms: 10,
    raw_path: `raw/${shareId}.json`,
    log_path: '',
    error: '',
    result,
  };
}

test('normalizeShareContent extracts question, answer, and references', () => {
  const share = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const normalized = normalizeShareContent(share, { share_id: '1zoj4pacya6ylyseci' });
  assert.equal(normalized.ok, true);
  assert.match(normalized.question, /深圳园/);
  assert.match(normalized.answer_text, /指定施工方/);
  assert.equal(normalized.references.length, 12);
  assert.equal(normalized.references[0].number, 1);
  assert.equal(normalized.references[0].source, '特区建工');
  assert.equal(normalized.references[0].domain, 'zcpt.szcg.cn');
  assert.equal(normalized.share_meta.model_type, 'default');
  assert.equal(normalized.share_meta.message_count, 2);
  assert.equal(normalized.share_meta.token_usage, 474);
  assert.equal(normalized.complete, true);
  assert.equal(normalized.share_meta.message_status, 'FINISHED');
});

test('shareIdFromUrl and parseShareLinksInput handle urls and dedupe', () => {
  assert.equal(shareIdFromUrl('https://chat.deepseek.com/share/abc123'), 'abc123');
  assert.equal(shareIdFromUrl('abc123'), 'abc123');
  const dir = tempDir();
  const file = path.join(dir, 'links.txt');
  fs.writeFileSync(file, [
    'https://chat.deepseek.com/share/abc123',
    'abc123',
    '# comment',
    'https://chat.deepseek.com/share/def456',
  ].join('\n'), 'utf8');
  const links = parseShareLinksInput(file);
  assert.deepEqual(links.map((l) => l.share_id).sort(), ['abc123', 'def456']);
});

test('exportDatasetStore writes CSV, SQLite, and field-map HTML', () => {
  const share = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const sample = buildSample(share, '1zoj4pacya6ylyseci');
  const dataset = {
    schema_version: 'deepseek-crawler-web/v1',
    run: { transport: 'deepseek-share-batch' },
    samples: [sample],
  };
  const outDir = tempDir();
  const store = exportDatasetStore(dataset, outDir, { sqlite: true });
  assert.ok(fs.existsSync(store.samples_csv));
  assert.match(fs.readFileSync(store.samples_csv, 'utf8'), /share_ok/);
  assert.ok(fs.existsSync(store.references_csv));
  assert.equal(store.sqlite, true);
  assert.ok(fs.existsSync(store.db_path));
  const html = renderFieldMapHtml(sample, dataset);
  assert.ok(html);
  assert.match(html, /id="tab-map"/);
  assert.match(html, /id="tab-answer"/);
  assert.match(html, /id="share-data-display"/);
  assert.match(html, /id="share-data-raw"/);
  assert.match(html, /id="refTable"/);
  assert.match(html, /深圳园消防排烟/);
  assert.doesNotMatch(html, /__SHARE_DATA_JSON_(DISPLAY|RAW)__|__SHARE_ID__/);
});

test('renderFieldMapHtml falls back when share.content is missing', () => {
  const share = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const sample = buildSample(share, 'fallback-sample');
  delete sample.result.share.content;
  const html = renderFieldMapHtml(sample, { samples: [sample] });
  assert.ok(html);
  assert.match(html, /id="tab-map"/);
  assert.match(html, /id="tab-answer"/);
  assert.match(html, /id="refTable"/);
  assert.match(html, /深圳园消防排烟/);
  assert.equal(collectFieldMapSamples({ samples: [sample] }).length, 1);
});

test('collectFieldMapSamples returns one entry per question', () => {
  const share = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const first = buildSample(share, 'share-1');
  first.question_id = 'q01';
  first.sample_id = 'share-1';
  const second = buildSample(share, 'share-2');
  second.question_id = 'q01';
  second.sample_id = 'share-2';
  const dataset = { samples: [first, second] };
  assert.equal(collectFieldMapSamples(dataset).length, 1);
  second.question = '另一个完全不同的问题';
  assert.equal(collectFieldMapSamples(dataset).length, 2);
});



test('field-map display converts traditional Chinese while raw JSON stays original', () => {
  const share = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const assistant = share.data.biz_data.messages.find((m) => m.role === 'ASSISTANT');
  assistant.content = (assistant.content || '') + '\n這裡推薦超人氣飯店';
  const firstRef = (assistant.search_results || [])[0];
  if (firstRef) firstRef.title = '超人氣保定 5 星級飯店推薦';
  const sample = buildSample(share, 'trad-sample');
  const html = renderFieldMapHtml(sample, { samples: [sample] });
  assert.ok(html);
  assert.match(html, /id="share-data-display"/);
  assert.match(html, /id="share-data-raw"/);
  const rawScript = (html.match(/<script type="application\/json" id="share-data-raw">([\s\S]*?)<\/script>/) || [])[1] || '';
  const displayScript = (html.match(/<script type="application\/json" id="share-data-display">([\s\S]*?)<\/script>/) || [])[1] || '';
  assert.ok(rawScript.includes('這裡推薦超人氣飯店'));
  assert.ok(displayScript.includes('这里推荐超人气饭店'));
  assert.ok(displayScript.includes('超人气保定 5 星级饭店推荐'));
  assert.ok(!displayScript.includes('這裡推薦超人氣飯店'));
});


test('toSimplified keeps proper-name phrases and converts common words', () => {
  assert.equal(toSimplified('乾隆皇帝 乾坤 乾杯 乾燥 這裡 飯店 臺灣'), '乾隆皇帝 乾坤 干杯 干燥 这里 饭店 台湾');
});
