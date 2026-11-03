#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crawlerScript = path.join(scriptDir, 'yuanbao_browser_crawl.mjs');
const tempDirs = [];

after(() => {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeFakeOpenCli(tempDir) {
  const scriptPath = path.join(tempDir, 'opencli.js');
  const executable = path.join(tempDir, 'opencli');
  const cmdPath = path.join(tempDir, 'opencli.cmd');
  fs.writeFileSync(scriptPath, `
const fs = require('node:fs');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_OPENCLI_LOG, JSON.stringify(args) + '\\n');

const browserIndex = args.indexOf('browser');
if (browserIndex >= 0) {
  const action = args[browserIndex + 2];
  if (action === 'open') {
    process.exit(0);
  }
  if (action === 'tab') {
    const sub = args[browserIndex + 3];
    if (sub === 'new') {
      process.stdout.write(JSON.stringify({ page: 'mock-page', url: args[browserIndex + 4] || '' }));
      process.exit(0);
    }
    if (sub === 'select' || sub === 'close') process.exit(0);
  }
  if (action === 'click') {
    process.exit(0);
  }
  if (action === 'bind') {
    if (process.env.FAKE_OPENCLI_CASE === 'bind-failure') {
      process.stderr.write('mock bind failed');
      process.exit(1);
    }
    process.exit(0);
  }
  if (action === 'unbind') {
    if (process.env.FAKE_OPENCLI_CASE === 'unbind-failure') {
      process.stderr.write('mock unbind failed');
      process.exit(1);
    }
    process.exit(0);
  }
  if (action === 'eval') {
    if (process.env.FAKE_OPENCLI_CASE === 'eval-failure') {
      process.stderr.write('mock eval failed');
      process.exit(1);
    }
    const evalArg = args[browserIndex + 3] || '';
    const markerStart = evalArg.indexOf("atob('");
    const markerEnd = markerStart >= 0 ? evalArg.indexOf("')", markerStart + 5) : -1;
    const markerMatch = markerStart >= 0 && markerEnd > markerStart ? { 1: evalArg.slice(markerStart + 6, markerEnd) } : null;
    const decoded = markerMatch ? Buffer.from(markerMatch[1], 'base64').toString('utf8') : evalArg;
    if (decoded.includes('yb-recent-conv-list__item')) {
      process.stdout.write(JSON.stringify([
        { title: 'Mock conversation', cid: '11111111-1111-4111-8111-111111111111', agentId: 'yb-agent' }
      ]));
      process.exit(0);
    }
    if (decoded.includes('last_user')) {
      process.stdout.write(JSON.stringify({
        href: 'https://yuanbao.tencent.com/chat/yb-agent/11111111-1111-4111-8111-111111111111',
        last_user: process.env.FAKE_EXPECTED_PROMPT,
        last_assistant: process.env.FAKE_ANSWER
      }));
      process.exit(0);
    }
    if (decoded.includes('conversations/v2/share')) {
      if (process.env.FAKE_OPENCLI_CASE === 'share-fail') {
        process.stdout.write(JSON.stringify({ ok: false, error: 'mock api fail', status: null }));
        process.exit(0);
      }
      process.stdout.write(JSON.stringify({ ok: true, status: 200, shareId: 'sampleShareId', conversationId: '11111111-1111-4111-8111-111111111111', agentId: 'yb-agent' }));
      process.exit(0);
    }
    if (decoded.includes('copyRef')) {
      process.stdout.write(JSON.stringify({ copyRef: '1', itemCount: 1, barVisible: true }));
      process.exit(0);
    }
    if (decoded.includes('window.__cap')) {
      process.stdout.write(JSON.stringify({ text: 'https://yb.tencent.com/s/mockShareId', exec: '' }));
      process.exit(0);
    }
    const wrongTab = process.env.FAKE_OPENCLI_CASE === 'wrong-tab';
    const wrongPrompt = process.env.FAKE_OPENCLI_CASE === 'wrong-prompt';
    const wrongAnswer = process.env.FAKE_OPENCLI_CASE === 'wrong-answer';
    const fingerprint = (value) => crypto.createHash('sha256').update(String(value).replace(/\\s+/g, ' ').trim(), 'utf8').digest('hex');
    process.stdout.write(JSON.stringify({
      href: wrongTab ? 'https://mail.example.test/inbox' : 'https://yuanbao.tencent.com/chat/yb-agent/11111111-1111-4111-8111-111111111111',
      title: wrongTab ? 'Inbox' : '腾讯元宝',
      prompt_matched: !wrongTab && !wrongPrompt,
      answer_matched: !wrongTab && !wrongPrompt && !wrongAnswer,
      matched_prompt: wrongTab ? '' : (wrongPrompt ? '旧提示词' : process.env.FAKE_EXPECTED_PROMPT),
      conversation_id: wrongTab ? '' : '11111111-1111-4111-8111-111111111111',
      answer_fingerprint: fingerprint(wrongAnswer ? 'Different answer' : process.env.FAKE_ANSWER),
      last_assistant_text: wrongAnswer ? 'Different answer' : (process.env.FAKE_ANSWER || 'Mock 腾讯元宝 answer'),
      read_count: 1,
      references: wrongTab || wrongPrompt || wrongAnswer ? [] : [{
        number: 1,
        url: 'https://example.com/source',
        domain: 'example.com',
        source: 'example.com',
        title: 'Example source',
        summary: 'Answer citation context'
      }]
    }));
    process.exit(0);
  }
}

if (args.includes('yuanbao') && args.includes('new')) {
  process.stdout.write(JSON.stringify([{ Status: 'Success', Action: 'Clicked New chat' }]));
  process.exit(0);
}

if (args.includes('yuanbao') && args.includes('ask')) {
  const promptIndex = args.indexOf('ask') + 1;
  const prompt = args[promptIndex] || '';
  process.stdout.write(JSON.stringify([
    { Role: 'User', Text: prompt },
    { Role: 'Assistant', Text: process.env.FAKE_ANSWER || 'Mock 腾讯元宝 answer' }
  ]));
  process.exit(0);
}

if (args.includes('yuanbao') && args.includes('status')) {
  process.stdout.write(JSON.stringify([{
    Status: 'Connected',
    Login: 'Yes',
    Model: 'MockModel',
    ModelId: 'mock-model-id',
    AgentId: 'yb-agent',
    SessionId: '11111111-1111-4111-8111-111111111111',
    Url: process.env.FAKE_STATUS_URL || 'https://yuanbao.tencent.com/chat/yb-agent/11111111-1111-4111-8111-111111111111'
  }]));
  process.exit(0);
}

process.stderr.write('unexpected fake opencli command: ' + args.join(' '));
process.exit(2);
`);
  fs.writeFileSync(executable, `#!/usr/bin/env node
require('./opencli.js');
`);
  fs.writeFileSync(cmdPath, `@ECHO OFF
node "%~dp0\\opencli.js" %*
`);
  fs.chmodSync(executable, 0o755);
  return tempDir;
}

function runCrawler(variant, options = {}) {
  const extraArgs = options.extraArgs || [];
  const createShare = Boolean(options.createShare);
  const fixture = options.fixture || '';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuanbao-crawler-test-'));
  tempDirs.push(tempDir);
  makeFakeOpenCli(tempDir);
  const outputPath = path.join(tempDir, 'raw.json');
  const logPath = path.join(tempDir, 'opencli.log');
  const prompt = '国内GEO服务商推荐，请联网搜索并保留参考来源。';
  const answer = '综合公开来源，[光引GEO](https://example.com/guangyin) 在可信评测和服务覆盖上更靠前，源易信息参与标准建设。';
  const args = [
    crawlerScript,
    '--session', 'test-session',
    '--prompt', prompt,
    '--timeout', '60',
    '--out', outputPath,
    ...(createShare ? [] : ['--no-create-share']),
    ...extraArgs,
  ];
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_OPENCLI_CASE: variant,
      FAKE_OPENCLI_LOG: logPath,
      FAKE_ANSWER: answer,
      FAKE_EXPECTED_PROMPT: prompt,
      ...(fixture ? { YUANBAO_SHARE_FIXTURE: path.resolve(fixture) } : {}),
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    },
    timeout: 120000,
  });
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch {
    raw = null;
  }
  return { result, raw, logPath };
}

test('success writes raw JSON with answer, conversation URL, and verified references', () => {
  const { result, raw } = runCrawler('success');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(raw.ok, true);
  assert.match(raw.answer.text, /光引GEO/);
  assert.match(raw.conversation.url, /yuanbao\.tencent\.com\/chat\/yb-agent\//);
  assert.equal(raw.conversation.model, 'MockModel');
  assert.equal(raw.references.verified, true);
  assert.ok(raw.references.count >= 1);
});

test('crawler starts a fresh conversation before asking', () => {
  const { logPath } = runCrawler('success');
  const calls = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const newIndex = calls.findIndex((args) => args.includes('yuanbao') && args.includes('new'));
  const askIndex = calls.findIndex((args) => args.includes('yuanbao') && args.includes('ask'));
  assert.ok(newIndex >= 0, 'yuanbao new should be called');
  assert.ok(askIndex > newIndex, 'yuanbao ask should come after yuanbao new');
});

test('eval failure falls back to answer-text references', () => {
  const { result, raw } = runCrawler('eval-failure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(raw.ok, true);
  assert.equal(raw.references.verified, false);
  assert.equal(raw.references.source, 'answer-text');
  assert.ok(raw.references.count >= 1);
  assert.match(raw.references.note, /answer text/);
});

test('wrong-tab eval is rejected without losing answer text references', () => {
  const { result, raw } = runCrawler('wrong-tab');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(raw.references.verified, false);
  assert.equal(raw.references.source, 'answer-text');
  assert.ok(raw.references.count >= 1);
});

test('bind failure is recorded without crashing the sample', () => {
  const { result, raw } = runCrawler('bind-failure');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(raw.ok, true);
  assert.equal(raw.references.verified, false);
  assert.ok(raw.references.note.includes('bind failed'));
});

test('missing prompt fails fast', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuanbao-crawler-test-'));
  tempDirs.push(tempDir);
  const outputPath = path.join(tempDir, 'raw.json');
  const result = spawnSync(process.execPath, [crawlerScript, '--out', outputPath], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing --prompt/);
});

test('share mode creates a public share link and merges full share data', () => {
  const fixture = path.join(scriptDir, '..', 'fixtures', 'sample-yuanbao-share.json');
  const { result, raw } = runCrawler('share-success', { createShare: true, fixture });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(raw.ok, true);
  assert.equal(raw.share.created, true);
  assert.equal(raw.share.url, 'https://yb.tencent.com/s/sampleShareId');
  assert.equal(raw.share.share_id, 'sampleShareId');
  assert.equal(raw.references.source, 'share-public');
  assert.equal(raw.references.verified, true);
  assert.ok(raw.references.items.length >= 2);
  assert.ok(raw.media.length >= 1);
  assert.match(raw.transport, /share/);
  assert.match(raw.conversation.url, /naQivTmsDa\/0PNw0000000000000000000000/);
  assert.match(raw.answer.text, /示例回答/);
});

test('share requested but failed marks the sample failed', () => {
  const { result, raw } = runCrawler('share-fail', { createShare: true });
  assert.notEqual(result.status, 0);
  assert.equal(raw.ok, false);
  assert.equal(raw.share.created, false);
  assert.ok(raw.share.error);
  assert.match(raw.transport, /opencli-yuanbao-adapter/);
});

test('timeout bounds are validated', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuanbao-crawler-test-'));
  tempDirs.push(tempDir);
  const result = spawnSync(process.execPath, [
    crawlerScript,
    '--prompt', '测试问题',
    '--out', path.join(tempDir, 'raw.json'),
    '--timeout', '10',
  ], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--timeout/);
});

