#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { probeYuanbaoShare, extractYuanbaoShare, normalizeYuanbaoShare } from './lib/yuanbao-share-structure.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const payloadPath = path.join(skillRoot, 'fixtures', 'sample-yuanbao-share-payload.json');
const rawPayload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

test('probe detects the known Yuanbao share layout with high confidence', () => {
  const probe = probeYuanbaoShare(rawPayload);
  assert.equal(probe.ok, true, `probe failed: ${(probe.warnings || []).join('; ')}`);
  assert.equal(probe.known_layout, true);
  assert.equal(probe.confidence, 'high');
  assert.equal(probe.root_path, 'props.pageProps.fullChatShareData');
  assert.equal(probe.speaker_field, 'speaker');
  assert.ok(probe.convs_path.endsWith('convs'));
  assert.ok(probe.question_field, 'question field detected');
  assert.ok(probe.speech_field, 'speech container detected');
  assert.ok(probe.blocks_field, 'content blocks detected');
  assert.ok(probe.doc_array_field, 'docs array detected');
  assert.equal(probe.reference_item_fields.url, 'url');
  assert.equal(probe.reference_item_fields.title, 'title');
  assert.match(probe.fingerprint, /^[0-9a-f]{16}$/);
  assert.ok(probe.message_count >= 2, `messages=${probe.message_count}`);
});

test('extractYuanbaoShare matches legacy extraction on the real payload', () => {
  const result = normalizeYuanbaoShare(rawPayload);
  assert.equal(result.ok, true, 'extraction must succeed');
  assert.equal(result.schema_version, 'yuanbao-crawler-share/v1');
  assert.ok(result.question.text.length > 0, 'question extracted');
  assert.ok(result.answer.text.length > 0, 'answer extracted');
  assert.equal(result.answer.char_count, result.answer.text.length);
  assert.ok(result.references.length > 0, `references=${result.references.length}`);
  const first = result.references[0];
  assert.ok(first.url.startsWith('http'), first.url);
  assert.ok(first.title.length > 0);
  assert.equal(typeof first.index, 'number');
  assert.ok(result.counts.messages >= 2);
  assert.equal(result.counts.references, result.references.length);
  // Structure fingerprint rides along with the extraction.
  assert.equal(result.structure.fingerprint.length, 16);
  assert.equal(result.structure.confidence, 'high');
});

test('structure-adaptive: renamed payload layout is still probed and extracted', () => {
  // Simulate a platform iteration: different root path, speaker field names,
  // speech container, block field, and reference field aliases.
  const mutated = {
    props: {
      pageProps: {
        shareId: 'mutatedShare',
        detail: {
          chat: {
            turns: [
              { who: 'human', prompt: '改版后的问题是什么', createTime: 1754000000 },
              {
                who: 'ai',
                replies: [
                  {
                    parts: [
                      {
                        kind: 'search',
                        sources: [
                          { link: 'https://example.org/a', headline: '标题A', idx: 1, doc_key: 'd1', quote: '摘要A' },
                          { link: 'https://example.org/b', headline: '标题B', idx: 2, doc_key: 'd2', quote: '摘要B' },
                        ],
                      },
                      { kind: 'answer', body: '这是改版后的回答正文，很长很长。' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };

  const probe = probeYuanbaoShare(mutated);
  assert.equal(probe.ok, true, `probe failed: ${(probe.warnings || []).join('; ')}`);
  assert.equal(probe.known_layout, false, 'must be discovered, not from known paths');
  assert.equal(probe.speaker_field, 'who');
  assert.ok(probe.convs_path.endsWith('turns'), `convs_path=${probe.convs_path}`);
  assert.equal(probe.question_field, 'prompt');
  assert.equal(probe.speech_field, 'replies');
  assert.equal(probe.blocks_field, 'parts');
  assert.equal(probe.doc_array_field, 'sources');
  assert.equal(probe.reference_item_fields.url, 'link');
  assert.equal(probe.reference_item_fields.title, 'headline');
  assert.equal(probe.reference_item_fields.index, 'idx');
  assert.notEqual(probe.fingerprint, probeYuanbaoShare(rawPayload).fingerprint);

  const result = extractYuanbaoShare(mutated, probe);
  assert.equal(result.ok, true);
  assert.equal(result.question.text, '改版后的问题是什么');
  assert.match(result.answer.text, /改版后的回答正文/);
  assert.equal(result.references.length, 2);
  assert.equal(result.references[0].url, 'https://example.org/a');
  assert.equal(result.references[0].title, '标题A');
  assert.equal(result.references[0].index, 1);
  assert.equal(result.references[0].doc_id, 'd1');
  assert.equal(result.share.share_id, 'mutatedShare');
  assert.equal(result.structure.confidence, 'medium');
});

test('probe fails gracefully on payloads without a chat structure', () => {
  const probe = probeYuanbaoShare({ props: { pageProps: { shareId: 'x', other: 1 } } });
  assert.equal(probe.ok, false);
  assert.equal(probe.confidence, 'none');
  assert.ok(probe.warnings.length >= 1);
  const result = extractYuanbaoShare({}, probe);
  assert.equal(result.ok, false);
  assert.ok(result.error);
});
