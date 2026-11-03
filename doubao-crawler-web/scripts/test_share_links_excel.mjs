#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { writeShareLinksExcel } from './lib/share-links-excel.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    } catch {
      // best-effort cleanup
    }
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-links-excel-'));
  tempDirs.push(dir);
  return dir;
}

function sample(id, question, ok) {
  return {
    sample_id: id,
    question_id: id,
    question,
    repeat_index: 1,
    ok,
    status: ok ? 'done' : 'failed',
    result: {
      question,
      answer: { text: 'mock answer' },
      references: { items: [] },
      transport: ok ? 'opencli-browser-ui+thread' : 'opencli-browser-ui',
      timing: { asked_at: '2026-08-06T10:00:00+08:00', share_time: '2026-08-06T10:00:10+08:00' },
      page: ok
        ? { thread_url: `https://www.doubao.com/thread/${id}`, share_id: id, title: `分享-${question}` }
        : { conversation_id: '123' },
    },
  };
}

test('writeShareLinksExcel generates question->link workbook', () => {
  const dataset = {
    schema_version: 'doubao-crawler-web/v1',
    samples: [
      sample('share-a', '问题一', true),
      sample('share-b', '问题二', true),
      sample('no-share', '问题三', false),
    ],
  };
  const outDir = tempDir();
  const result = writeShareLinksExcel(dataset, outDir);
  assert.equal(result.ok, true, result.error || '');
  assert.ok(fs.existsSync(result.path));
  assert.ok(fs.statSync(result.path).size > 0);
  const check = spawnSync('python', ['-c', "import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); print(wb.sheetnames); print(wb['分享链接'].max_row); print(wb['按问题汇总'].max_row)", result.path], { encoding: 'utf8' });
  if (check.status === 0) {
    assert.match(check.stdout, /分享链接/);
    assert.match(check.stdout, /按问题汇总/);
    assert.match(check.stdout, /3/); // header + 2 share rows
    assert.match(check.stdout, /3/); // header + 2 question rows
  }
});
