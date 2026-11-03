#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractShareData, parseThreadRecord } from './parse_doubao_thread.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const fixturePath = path.join(skillRoot, 'fixtures', 'thread-snapshot-sample.json');

test('thread snapshot parses full structured fields', async () => {
  const record = await parseThreadRecord(fixturePath, { fromFile: true });
  assert.equal(record.ok, true);
  assert.equal(record.transport, 'doubao-thread-http');
  assert.match(record.question, /保定市区买小高层/);
  assert.equal(record.suggest_questions.length, 3);
  assert.equal(record.references.count, 17);
  assert.equal(record.references.items.length, 17);
  assert.equal(record.references.full.length, 17);
  assert.ok(record.answer.brief.length > 100);
  assert.ok(record.timing.asked_at);
  assert.ok(!record.timing.asked_at.startsWith('1970'));
  assert.ok(record.timing.completed_at);
  assert.ok(record.timing.share_time);
  assert.equal(record.completion.finished, true);
  assert.ok(record.completion.signals.length >= 3);
  assert.equal(record.page.share_id, 'xF21xuMrpXdcdEQZb');
  assert.equal(record.page.conversation_id, '51458713974493698');
  assert.equal(record.pending_thread_capture, false);
  assert.equal(record.redacted, true);
});

test('references are deduplicated by doc_id', async () => {
  const record = await parseThreadRecord(fixturePath, { fromFile: true });
  const docIds = record.references.full.map((card) => card.doc_id);
  assert.equal(new Set(docIds).size, docIds.length);
});

test('sensitive identity fields are redacted', async () => {
  const record = await parseThreadRecord(fixturePath, { fromFile: true });
  const text = JSON.stringify(record);
  assert.doesNotMatch(text, /Herman6056/);
  assert.doesNotMatch(text, /MS4wLjABAAAA/);
  assert.match(text, /\[REDACTED\]/);
  assert.equal(record.message_list[0].sec_sender, '[REDACTED]');
});

test('extractShareData classifies missing marker as ui_changed', () => {
  assert.throws(() => extractShareData('<html><body>no marker</body></html>'), /ui_changed/);
});

test('invalid from-file input produces a classified failure record', async () => {
  const missing = path.join(fixturePath, 'does-not-exist.json');
  const record = await parseThreadRecord(missing, { fromFile: true });
  assert.equal(record.ok, false);
  assert.ok(['network', 'ui_changed', 'thread_not_found', 'unknown'].includes(record.failure_reason));
  assert.equal(record.redacted, true);
});
