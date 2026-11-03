#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportDatasetStore } from './lib/store-writer.mjs';
import { writeShareLinksExcel } from './lib/share-links-excel.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('export store writes CSV, SQLite, and question->share-link Excel', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(skillRoot, 'fixtures', 'sample-yuanbao-crawl.json'), 'utf8'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuanbao-store-test-'));
  tempDirs.push(outDir);
  const store = exportDatasetStore(dataset, outDir);
  assert.ok(fs.existsSync(store.samples_csv), 'samples CSV missing');
  assert.ok(fs.existsSync(store.references_csv), 'references CSV missing');
  assert.equal(store.sqlite, true, 'sqlite should be exported');
  assert.ok(fs.existsSync(store.db_path), 'sqlite db missing');
  const excel = writeShareLinksExcel(dataset, outDir);
  assert.equal(excel.ok, true, excel.error);
  assert.ok(fs.existsSync(excel.path), 'share-links.xlsx missing');
});
