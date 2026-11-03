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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-batch-args-'));
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
fs.writeFileSync(out, JSON.stringify({ ok: true, answer: { text: 'mock answer' }, references: { items: [] } }));
`, 'utf8');
  return file;
}

function runBatch(fakeCrawler, dir, options = {}) {
  const args0 = [];
  if (options.model) args0.push('--model', options.model);
  const questions = path.join(dir, 'questions.txt');
  const questionsText = options.questions ? options.questions.join('\n') : '测试问题\n';
  fs.writeFileSync(questions, questionsText, 'utf8');
  const logPath = path.join(dir, 'crawler-args.log');
  fs.writeFileSync(logPath, '', 'utf8');
  const args = [
    path.join(skillRoot, 'scripts', 'deepseek_batch_crawl.mjs'),
    '--questions', questions,
    '--repeat', String(options.repeat || 1),
    '--delay-ms', '0',
    '--no-create-share',
    '--crawler-script', fakeCrawler,
    '--out-dir', path.join(dir, 'run'),
  ];
  if (options.think) args.push('--think');
  if (args0.length) args.push(...args0);
  if (options.resume) args.push('--resume');
  if (options.repairShares) args.push('--repair-shares');
  const result = spawnSync(process.execPath, args, {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, FAKE_CRAWLER_LOG: logPath },
    timeout: 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'deepseek-crawl.json'), 'utf8'));
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

test('batch passes --model expert to the crawler', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { calls, dataset } = runBatch(fakeCrawler, dir, { model: 'expert' });
  assert.ok(calls.some((args) => args.includes('--model') && args.includes('expert')));
  assert.equal(dataset.input.model, 'expert');
});

test('batch defaults to instant model', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const { calls, dataset } = runBatch(fakeCrawler, dir, {});
  assert.ok(calls.some((args) => args.includes('--model') && args.includes('instant')));
  assert.equal(dataset.input.model, 'instant');
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

test('repair-shares reruns samples that lack a public share id', () => {
  const dir = tempDir();
  const fakeCrawler = makeFakeCrawler(dir);
  const rawDir = path.join(dir, 'run', 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, 'q01-r01.json'), JSON.stringify({
    ok: true,
    question: '测试问题',
    answer: { text: 'existing answer' },
    references: { items: [] },
  }), 'utf8');

  const first = runBatch(fakeCrawler, dir, { resume: true });
  assert.equal(first.calls.length, 0, 'valid sample should be reused without repair-shares');

  const second = runBatch(fakeCrawler, dir, { resume: true, repairShares: true });
  assert.equal(second.calls.length, 1, 'repair-shares should rerun the sample');
  assert.equal(second.calls[0].includes('--repair-shares'), false);
  assert.ok(second.calls[0].includes('--no-create-share'));
});
