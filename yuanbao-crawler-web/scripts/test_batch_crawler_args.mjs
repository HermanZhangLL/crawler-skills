#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 });
    } catch {
      // best-effort cleanup on Windows
    }
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yb-batch-args-'));
  tempDirs.push(dir);
  return dir;
}

function makeFakeCrawler(dir) {
  const file = path.join(dir, 'fake-crawler.mjs');
  fs.writeFileSync(file, `
import fs from 'node:fs';
const log = process.env.FAKE_CRAWLER_LOG;
const args = process.argv.slice(2);
if (log) fs.appendFileSync(log, JSON.stringify(args) + '\\n');
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : 'raw.json';
fs.writeFileSync(out, JSON.stringify({
  ok: true,
  transport: 'opencli-yuanbao-adapter',
  answer: { text: 'mock answer' },
  references: { items: [] }
}));
`, 'utf8');
  return file;
}

function runBatch(fakeCrawler, dir, options = {}) {
  const questions = path.join(dir, 'questions.txt');
  const questionsText = options.questions ? options.questions.join('\n') : '测试问题\n';
  fs.writeFileSync(questions, questionsText, 'utf8');
  const logPath = path.join(dir, 'crawler-args.log');
  fs.writeFileSync(logPath, '', 'utf8');
  const args = [
    path.join(skillRoot, 'scripts', 'yuanbao_batch_crawl.mjs'),
    '--questions', questions,
    '--delay-ms', '0',
    '--crawler-script', fakeCrawler,
    '--out-dir', path.join(dir, 'run'),
  ];
  if (options.repeat !== undefined) args.push('--repeat', String(options.repeat));
  if (options.think) args.push('--think');
  if (options.model) args.push('--model', options.model);
  if (options.store === false) args.push('--no-store');
  if (options.targetEntity) args.push('--target-entity', options.targetEntity);
  if (options.entityType) args.push('--entity-type', options.entityType);
  if (options.resume) args.push('--resume');
  if (options.planOrder) args.push('--plan-order', options.planOrder);
  const result = spawnSync(process.execPath, args, {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, FAKE_CRAWLER_LOG: logPath },
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'yuanbao-crawl.json'), 'utf8'));
  return { calls, dataset };
}

test('batch orchestrator passes --think to the crawler when enabled', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { calls, dataset } = runBatch(fakeCrawler, dir, { think: true });
  assert.ok(calls.some((args) => args.includes('--think')));
  assert.equal(dataset.input.think, true);
});

test('batch orchestrator does not pass --think in quick mode', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { calls, dataset } = runBatch(fakeCrawler, dir, {});
  assert.ok(!calls.some((args) => args.includes('--think')));
  assert.equal(dataset.input.think, false);
});

test('round plan order interleaves all questions per round', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { dataset } = runBatch(fakeCrawler, dir, {
    repeat: 2,
    questions: ['问题一', '问题二'],
  });
  assert.equal(dataset.input.plan_order, 'round');
  assert.deepEqual(dataset.plan.map((p) => p.sample_id), ['q01-r01', 'q02-r01', 'q01-r02', 'q02-r02']);
});

test('question plan order finishes one question first', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { dataset } = runBatch(fakeCrawler, dir, {
    repeat: 2,
    planOrder: 'question',
    questions: ['问题一', '问题二'],
  });
  assert.deepEqual(dataset.plan.map((p) => p.sample_id), ['q01-r01', 'q01-r02', 'q02-r01', 'q02-r02']);
});

test('default repeat is 1 and store export runs after crawl', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { dataset } = runBatch(fakeCrawler, dir, {});
  assert.equal(dataset.input.global_repeat, 1);
  assert.equal(dataset.input.model, 'quick');
  assert.equal(dataset.input.store, true);
  assert.ok(fs.existsSync(path.join(dir, 'run', 'store', 'yuanbao-samples.csv')), 'samples CSV missing');
  assert.ok(fs.existsSync(path.join(dir, 'run', 'store', 'share-links.xlsx')), 'share-links.xlsx missing');
});

test('--model expert is passed to the crawler and recorded', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { calls, dataset } = runBatch(fakeCrawler, dir, { model: 'expert' });
  assert.ok(calls.some((args) => args.includes('--model') && args.includes('expert')));
  assert.equal(dataset.input.model, 'expert');
});

test('--no-store disables CSV/SQLite and share-link Excel export', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { dataset } = runBatch(fakeCrawler, dir, { store: false });
  assert.equal(dataset.input.store, false);
  assert.ok(!fs.existsSync(path.join(dir, 'run', 'store')));
});

test('missing entity type defaults to auto', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { dataset } = runBatch(fakeCrawler, dir, { targetEntity: '星潮里商业' });
  assert.equal(dataset.input.entity_type, 'auto');
});

test('resume reuses a valid raw sample without re-running the crawler', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const rawDir = path.join(dir, 'run', 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, 'q01-r01.json'), JSON.stringify({
    ok: true,
    question: '测试问题',
    answer: { text: 'existing answer' },
    references: { items: [] },
    transport: 'opencli-yuanbao-adapter',
  }), 'utf8');
  const { calls, dataset } = runBatch(fakeCrawler, dir, { resume: true });
  assert.equal(calls.length, 0, 'valid sample should be reused');
  assert.equal(dataset.samples[0].reused, true);
  assert.equal(dataset.samples[0].ok, true);
});
