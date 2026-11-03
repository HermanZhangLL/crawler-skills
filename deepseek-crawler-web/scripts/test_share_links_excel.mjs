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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-links-excel-'));
  tempDirs.push(dir);
  return dir;
}

function sample(id, question, shareOk) {
  return {
    sample_id: id,
    question_id: id,
    question,
    repeat_index: 1,
    ok: true,
    status: 'done',
    result: {
      question,
      answer: { text: 'mock answer' },
      references: { items: [] },
      share: shareOk
        ? { requested: true, created: true, share_ok: true, share_id: id, url: `https://chat.deepseek.com/share/${id}` }
        : { requested: true, created: false, share_ok: false },
    },
  };
}

test('writeShareLinksExcel generates question->link workbook', () => {
  const dataset = {
    schema_version: 'deepseek-crawler-web/v1',
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
  const check = spawnSync('python', ['-c', "import openpyxl,sys; wb=openpyxl.load_workbook(sys.argv[1]); print(wb.sheetnames); print(wb['分享链接'].max_row)", result.path], { encoding: 'utf8' });
  if (check.status === 0) {
    assert.match(check.stdout, /分享链接/);
    assert.match(check.stdout, /按问题汇总/);
    assert.match(check.stdout, /3/); // header + 2 rows
  }
});

