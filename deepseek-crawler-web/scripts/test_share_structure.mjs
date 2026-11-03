#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { probeShareStructure, extractSharePayload, normalizeShareStructure } from './lib/share-structure.mjs';
import { normalizeShareContent } from './lib/share-utils.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const fixturePath = path.join(skillRoot, 'fixtures', 'sample-deepseek-share.json');
const share = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('probeShareStructure detects the known DeepSeek layout with high confidence', () => {
  const probe = probeShareStructure(share);
  assert.equal(probe.ok, true);
  assert.equal(probe.known_layout, true);
  assert.equal(probe.confidence, 'high');
  assert.equal(probe.messages_path, 'data.biz_data.messages');
  assert.equal(probe.role_field, 'role');
  assert.equal(probe.content_field, 'content');
  assert.equal(probe.status_field, 'status');
  assert.equal(probe.reference_field, 'search_results');
  assert.equal(probe.reference_item_fields.url, 'url');
  assert.equal(probe.reference_item_fields.title, 'title');
  assert.equal(probe.reference_item_fields.snippet, 'snippet');
  assert.equal(probe.reference_item_fields.number, 'cite_index');
  assert.equal(probe.reference_item_fields.site, 'site_name');
  assert.match(probe.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(probe.message_count, 2);
});

test('extractSharePayload matches legacy extraction on the fixture', () => {
  const normalized = normalizeShareContent(share, { share_id: '1zoj4pacya6ylyseci' });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.complete, true);
  assert.match(normalized.question, /深圳园/);
  assert.match(normalized.answer_text, /指定施工方/);
  assert.equal(normalized.references.length, 12);
  assert.equal(normalized.references[0].number, 1);
  assert.equal(normalized.references[0].source, '特区建工');
  assert.equal(normalized.references[0].domain, 'zcpt.szcg.cn');
  assert.equal(normalized.references[0].source_origin, 'share-api-site-name');
  assert.equal(normalized.references[0].title_origin, 'share-api-title');
  assert.equal(normalized.references[0].summary_origin, 'share-api-snippet');
  assert.equal(normalized.share_meta.model_type, 'default');
  assert.equal(normalized.share_meta.message_count, 2);
  assert.equal(normalized.share_meta.token_usage, 474);
  assert.equal(normalized.share_meta.message_status, 'FINISHED');
  assert.equal(normalized.share_meta.complete, true);
  // Structure fingerprint rides along with the extraction.
  assert.equal(normalized.structure.fingerprint.length, 16);
  assert.equal(normalized.structure.reference_field, 'search_results');
});

test('structure-adaptive: renamed message and reference fields are still extracted', () => {
  // Simulate a platform iteration: different envelope, role values, field names.
  const mutated = {
    payload_version: 3,
    conversation: {
      title: '改版后的分享',
      model_mode: 'pro',
      turns: [
        { speaker: 'human', body: '问题是什么', status_text: 'done', tokens: 30 },
        {
          speaker: 'assistant',
          body: '这是改版后的回答正文，包含[cite]引用。',
          status_text: 'done',
          tokens: 120,
          citations: [
            {
              link: 'https://example.org/a',
              headline: '标题A',
              excerpt: '摘要A',
              idx: 1,
              published: 1720800000,
              site: '示例站',
              host: 'example.org',
            },
            {
              link: 'https://example.org/b',
              headline: '标题B',
              excerpt: '摘要B',
              idx: 2,
              published: '2024-07-13',
              site: '示例站',
              host: 'example.org',
            },
          ],
        },
      ],
    },
  };

  const probe = probeShareStructure(mutated);
  assert.equal(probe.ok, true, `probe failed: ${(probe.warnings || []).join('; ')}`);
  assert.equal(probe.known_layout, false, 'must be discovered, not from the known-path list');
  assert.equal(probe.confidence, 'medium');
  assert.equal(probe.role_field, 'speaker');
  assert.equal(probe.content_field, 'body');
  assert.equal(probe.reference_field, 'citations');
  assert.equal(probe.reference_item_fields.url, 'link');
  assert.equal(probe.reference_item_fields.title, 'headline');
  assert.equal(probe.reference_item_fields.snippet, 'excerpt');
  assert.equal(probe.reference_item_fields.number, 'idx');
  assert.equal(probe.conversation.title, '改版后的分享');

  const extracted = extractSharePayload(mutated, probe, {});
  assert.equal(extracted.ok, true);
  assert.equal(extracted.complete, true);
  assert.equal(extracted.question, '问题是什么');
  assert.match(extracted.answer_text, /改版后的回答正文/);
  assert.equal(extracted.references.length, 2);
  assert.equal(extracted.references[0].url, 'https://example.org/a');
  assert.equal(extracted.references[0].title, '标题A');
  assert.equal(extracted.references[0].summary, '摘要A');
  assert.equal(extracted.references[0].number, 1);
  assert.equal(extracted.references[0].date, '2024-07-12'); // 1720800000s = 2024-07-12T16:00Z (UTC, same as legacy toISOString)
  assert.equal(extracted.references[1].date, '2024-07-13');
  assert.equal(extracted.references[0].source, '示例站');
  assert.equal(extracted.share_meta.token_usage, 150);
  assert.equal(extracted.share_meta.message_count, 2);
  assert.equal(extracted.share_meta.title, '改版后的分享');
  assert.equal(extracted.share_meta.model_type, 'pro');
  // Fingerprint must differ from the known layout — drift is observable.
  const knownFingerprint = probeShareStructure(share).fingerprint;
  assert.notEqual(probe.fingerprint, knownFingerprint);
});

test('structure-adaptive: payload without any message array fails gracefully', () => {
  const probe = probeShareStructure({ code: 0, data: { biz_code: 0, biz_data: { title: 'x' } } });
  assert.equal(probe.ok, false);
  assert.equal(probe.confidence, 'none');
  assert.ok(probe.warnings.length >= 1);
  const extracted = extractSharePayload({}, probe, { share_id: 'abc' });
  assert.equal(extracted.ok, false);
  assert.equal(extracted.complete, false);
  assert.equal(extracted.references.length, 0);
  assert.equal(extracted.share_meta.share_id, 'abc');
});

test('normalizeShareContent keeps the legacy contract and adds structure', () => {
  const result = normalizeShareStructure(share, { share_id: 'x' });
  for (const key of ['ok', 'complete', 'question', 'answer_text', 'references', 'share_meta', 'structure']) {
    assert.ok(key in result, `missing key: ${key}`);
  }
  // Source-origin labels stay compatible with report-contract.md.
  for (const ref of result.references) {
    assert.match(ref.source_origin, /^share-api-/);
    assert.match(ref.title_origin, /^share-api-/);
    assert.match(ref.summary_origin, /^share-api-/);
  }
});

test('fragment layout (observed 2026-10 platform iteration) is probed and extracted', () => {
  // Real captured payload: content moved from message.content to
  // messages[].fragments[] typed blocks (REQUEST/SEARCH/RESPONSE) and
  // search_results moved into the SEARCH block's `results` array.
  const fragmentsPath = path.join(skillRoot, 'fixtures', 'sample-deepseek-share-fragments.json');
  const live = JSON.parse(fs.readFileSync(fragmentsPath, 'utf8'));
  const probe = probeShareStructure(live);
  assert.equal(probe.ok, true, `probe failed: ${(probe.warnings || []).join('; ')}`);
  assert.equal(probe.role_field, 'role');
  assert.ok(probe.fragments, 'fragments layout must be detected');
  assert.equal(probe.fragments.field, 'fragments');
  assert.equal(probe.fragments.type_field, 'type');
  assert.equal(probe.fragments.content_field, 'content');
  assert.equal(probe.fragments.reference_field, 'results');
  assert.ok(probe.fragments.type_buckets.request.includes('REQUEST'));
  assert.ok(probe.fragments.type_buckets.response.includes('RESPONSE'));
  assert.ok(probe.fragments.type_buckets.search.includes('SEARCH'));
  assert.notEqual(probe.fingerprint, probeShareStructure(share).fingerprint);
  assert.ok(['high', 'medium'].includes(probe.confidence), `confidence=${probe.confidence}`);

  const extracted = extractSharePayload(live, probe, { share_id: '1zoj4pacya6ylyseci' });
  assert.equal(extracted.ok, true, 'fragment extraction must produce a valid sample');
  assert.equal(extracted.complete, true);
  assert.match(extracted.question, /深圳园/);
  assert.match(extracted.answer_text, /指定施工方/);
  assert.ok(extracted.references.length >= 10, `refs=${extracted.references.length}`);
  const first = extracted.references[0];
  assert.ok(first.url.startsWith('https://'), first.url);
  assert.ok(first.title.length > 0);
  assert.equal(typeof first.number, 'number');
  assert.ok(first.date.length === 10, `date=${first.date}`);
  assert.ok(first.source.length > 0);
  assert.equal(extracted.share_meta.message_count, 2);
  assert.equal(extracted.share_meta.message_status, 'FINISHED');
  assert.ok(extracted.share_meta.token_usage > 0);
  // Unified schema is identical across layouts — same keys as legacy extraction.
  assert.deepEqual(
    Object.keys(extracted).sort(),
    Object.keys(normalizeShareStructure(share, {})).sort(),
  );
});
