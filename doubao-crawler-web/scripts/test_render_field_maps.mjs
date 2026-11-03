#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildFieldMapPayload, renderFieldMap } from './render_field_maps.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const fixturePath = path.join(skillRoot, 'fixtures', 'sample-doubao-thread-crawl.json');

function fixtureRecord() {
  const dataset = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  return dataset.samples[0].result;
}

test('buildFieldMapPayload extracts full structured data', () => {
  const payload = buildFieldMapPayload(fixtureRecord());
  assert.match(payload.question, /保定市区买小高层/);
  assert.equal(payload.refs.length, 17);
  assert.equal(payload.full.length, 17);
  assert.equal(payload.suggestQuestions.length, 3);
  assert.ok(payload.queries.length >= 3);
  assert.equal(payload.share.share_id, 'xF21xuMrpXdcdEQZb');
  assert.equal(payload.share.conversation_id, '51458713974493698');
  assert.equal(payload.raw.redacted, true);
  assert.ok(payload.entity.length > 0);
});

test('renderFieldMap writes self-contained HTML with payload', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-field-map-'));
  const outPath = path.join(outDir, 'q01-r01-data-map.html');
  const htmlPath = renderFieldMap(fixtureRecord(), outPath, { sampleId: 'q01-r01', runId: 'fixture' });
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /<title>保定市区买小高层/);
  assert.match(html, /id="tab-map"/);
  assert.match(html, /id="tab-refs"/);
  assert.match(html, /class="ref-row"/);
  assert.match(html, /id="ref-1"/);
  const marker = '<script type="application/json" id="payload">';
  const start = html.indexOf(marker) + marker.length;
  const end = html.indexOf('</script>', start);
  const payload = JSON.parse(html.slice(start, end));
  assert.equal(payload.refs.length, 17);
  assert.equal(payload.question, '保定市区买小高层，推荐个新交付或即将交付的小区');
});

test('renderFieldMap escapes script-breaking sequences in payload', () => {
  const record = fixtureRecord();
  record.answer = { text: '答案</script><script>alert(1)</script>', brief: '' };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-field-map-escape-'));
  const html = fs.readFileSync(renderFieldMap(record, path.join(outDir, 'escape.html')), 'utf8');
  const marker = '<script type="application/json" id="payload">';
  const start = html.indexOf(marker) + marker.length;
  const end = html.indexOf('</script>', start);
  const payloadText = html.slice(start, end);
  assert.ok(payloadText.includes('\\u003c/script\\u003e'));
  assert.ok(!payloadText.includes('</script>'));
  JSON.parse(payloadText);
});