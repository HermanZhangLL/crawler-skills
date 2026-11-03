#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeThreadEnrichment, normalizeDoubaoMode, parseSuggestQuestionsFromBrowserText } from './doubao_browser_crawl.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const crawlerScript = path.join(scriptDir, 'doubao_browser_crawl.mjs');
const batchScript = path.join(scriptDir, 'doubao_batch_crawl.mjs');
const analyzerScript = path.join(scriptDir, 'analyze_doubao_results.py');
const skillRoot = path.resolve(scriptDir, '..');
const threadFixture = path.join(skillRoot, 'fixtures', 'thread-snapshot-sample.json');

function pythonCommand() {
  if (process.platform !== 'win32') return 'python3';
  try {
    require('node:child_process').spawnSync('python3', ['--version'], { stdio: 'ignore' });
    return 'python3';
  } catch {
    return 'python';
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || path.dirname(scriptDir),
    encoding: 'utf8',
    env: options.env || process.env,
    timeout: options.timeout || 60000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function makeFakeOpenCli() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-opencli-'));
  const jsPath = path.join(dir, 'opencli.js');
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(jsPath, `const args = process.argv.slice(2);
const command = args[1];
const variant = process.env.FAKE_DOUBAO_CASE;
const prompt = command === 'ask' ? args[2] : '';
const stateFile = ${JSON.stringify(stateFile)};
function readState() {
  try { return JSON.parse(require('node:fs').readFileSync(stateFile, 'utf8')); } catch { return {}; }
}
function writeState(state) {
  try { require('node:fs').writeFileSync(stateFile, JSON.stringify(state)); } catch {}
}
if (args[0] === 'browser') {
  const sub = args[2];
  if (sub === 'extract') {
    process.stdout.write(JSON.stringify({
      url: 'https://www.doubao.com/chat/123456',
      title: '测试',
      total_chars: 60,
      content: '新对话\\nAI 生成可能有误 注意核实\\n测试问题\\n' + '回答正文（浏览器模式）'.repeat(40) + '\\n相关视频\\n视频标题示例\\n问题一？\\n问题二？\\n在此处拖放文件\\n文件数量：最多 50 个',
    }));
  } else if (sub === 'state') {
    process.stdout.write('URL: https://www.doubao.com/chat/123456\\n[1]<textarea placeholder=发消息或按住空格说话... />\\n[2]<button id=flow-end-msg-send aria-disabled=false />');
  } else if (sub === 'eval') {
    if (args.join(' ').includes('mode-select-action-btn')) {
      process.stdout.write(readState().selected || process.env.FAKE_DOUBAO_MODE_INITIAL || '快速');
    } else {
      process.stdout.write(JSON.stringify({ w: 1280, h: 720 }));
    }
  } else if (sub === 'find') {
    if (args.join(' ').includes('mode-select-action-btn')) {
      process.stdout.write(JSON.stringify({ entries: [{ ref: 101 }] }));
    } else if (args.includes('--role') && args.includes('menuitem')) {
      const textIndex = args.indexOf('--text');
      const matchText = textIndex >= 0 ? args[textIndex + 1] : '';
      writeState({ selected: matchText || '快速' });
      process.stdout.write(JSON.stringify({ entries: [{ ref: 202 }] }));
    } else {
      process.stdout.write(JSON.stringify({ entries: [] }));
    }
  } else {
    process.stdout.write(JSON.stringify({ ok: true }));
  }
  return;
}
let rows;
if (command === 'send') {
  rows = [{ Status: 'Submitted', SubmittedBy: 'agent', InjectedText: prompt || 'test' }];
} else if (command === 'ask' && variant === 'timeout') {
  rows = [
    { Role: 'User', Text: prompt },
    { Role: 'System', Text: 'No response within 300s. Doubao may still be generating.' },
  ];
} else if (command === 'read' && (variant === 'timeout' || variant === 'incomplete')) {
  rows = [{ Role: 'System', Text: 'No visible Doubao messages were found.' }];
} else if (variant === 'captcha') {
  rows = [
    { Role: 'User', Text: prompt || '什么是 CAPTCHA？' },
    { Role: 'Assistant', Text: 'CAPTCHA 是一种区分人与机器的验证机制。' },
  ];
} else if (command === 'ask' && variant === 'page-chrome-1') {
  rows = [{ Role: 'Assistant', Text: '快速视频生成深入研究图像生成帮我写作音乐生成更多' }];
} else if (command === 'ask' && variant === 'page-chrome-2') {
  rows = [{ Role: 'Assistant', Text: 'AI创作云盘更多历史对话' }];
} else if (command === 'read' && variant.startsWith('page-chrome')) {
  rows = [{ Role: 'Assistant', Text: '好的。' }];
} else {
  rows = [{ Role: 'Assistant', Text: '正常回答' }];
}
process.stdout.write(JSON.stringify(rows));
`);
  return { dir, jsPath };
}

function crawlWithFakeOpenCli(variant, prompt) {
  const fake = makeFakeOpenCli();
  const fakeBin = fake.dir;
  const result = run(process.execPath, [
    crawlerScript,
    '--prompt',
    prompt,
    '--no-new',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
    '--completion-mode',
    'ask',
    '--no-thread-capture',
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: variant,
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  return JSON.parse(result.stdout);
}

test('timeout rows never turn the user prompt into a successful answer', () => {
  const record = crawlWithFakeOpenCli('timeout', '出国留学公司推荐');
  assert.equal(record.ok, false);
  assert.equal(record.failure_reason, 'answer_incomplete');
  assert.equal(record.answer.text, '');
});

test('assistant answers may discuss CAPTCHA without becoming failures', () => {
  const record = crawlWithFakeOpenCli('captcha', '什么是 CAPTCHA？');
  assert.equal(record.ok, true);
  assert.equal(record.answer.text, 'CAPTCHA 是一种区分人与机器的验证机制。');
});

test('stable readback is used as the completed answer', () => {
  const record = crawlWithFakeOpenCli('', '测试问题');
  assert.equal(record.ok, true);
  assert.equal(record.answer.text, '正常回答');
  assert.equal(record.completion.finished, true);
  assert.ok(record.timing.asked_at);
  assert.ok(record.timing.completed_at);
});

test('browser completion mode collects answer text', () => {
  const fake = makeFakeOpenCli();
  const result = run(process.execPath, [
    crawlerScript,
    '--prompt',
    '测试问题',
    '--completion-mode',
    'browser',
    '--browser-session',
    'doubao-crawl',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
    '--no-thread-capture',
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fake.dir}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const record = JSON.parse(result.stdout);
  assert.equal(record.ok, true);
  assert.equal(record.transport, 'opencli-browser-ui');
  assert.match(record.answer.text, /回答正文（浏览器模式）/);
  assert.equal(record.suggest_questions.length, 2);
  assert.equal(record.suggest_questions[0].content, '问题一？');
  assert.equal(record.page.conversation_id, '123456');
  assert.equal(record.pending_thread_capture, false);
  assert.equal(record.options.doubao_mode, 'quick');
  assert.ok(record.timing.asked_at);
  assert.ok(record.timing.completed_at);
});

test('browser sample fails when the public thread share cannot be captured', () => {
  const fake = makeFakeOpenCli();
  const result = run(process.execPath, [
    crawlerScript,
    '--prompt',
    '测试问题',
    '--completion-mode',
    'browser',
    '--browser-session',
    'doubao-crawl',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fake.dir}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const record = JSON.parse(result.stdout);
  assert.equal(record.ok, false);
  assert.equal(record.failure_reason, 'thread_link_failed');
  assert.equal(record.pending_thread_capture, true);
  assert.equal(record.thread_capture.attempted, true);
  assert.equal(record.thread_capture.link_found, false);
});

test('normalizeDoubaoMode accepts Chinese aliases', () => {
  assert.equal(normalizeDoubaoMode('快速'), 'quick');
  assert.equal(normalizeDoubaoMode('专家模式'), 'expert');
  assert.equal(normalizeDoubaoMode('工作任务 Turbo'), 'work_turbo');
  assert.equal(normalizeDoubaoMode('工作任务Pro'), 'work_pro');
  assert.equal(normalizeDoubaoMode('work-pro'), 'work_pro');
  assert.equal(normalizeDoubaoMode('unknown-mode'), '');
});

test('browser mode selection selects expert and records it', () => {
  const fake = makeFakeOpenCli();
  const result = run(process.execPath, [
    crawlerScript,
    '--prompt',
    '测试问题',
    '--completion-mode',
    'browser',
    '--browser-session',
    'doubao-crawl',
    '--doubao-mode',
    '专家',
    '--no-thread-capture',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      FAKE_DOUBAO_MODE_INITIAL: '快速',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fake.dir}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const record = JSON.parse(result.stdout);
  assert.equal(record.ok, true);
  assert.equal(record.options.doubao_mode, 'expert');
  assert.ok(record.raw.opencli_browser_trace.some((item) => String(item).includes('doubao_mode=expert')));
});

test('browser mode selection switches between work modes', () => {
  const fake = makeFakeOpenCli();
  fs.writeFileSync(path.join(fake.dir, 'state.json'), JSON.stringify({ selected: '工作任务 Pro升级执行 agent 任务 - 2.1 Pro' }));
  const result = run(process.execPath, [
    crawlerScript,
    '--prompt',
    '测试问题',
    '--completion-mode',
    'browser',
    '--browser-session',
    'doubao-crawl',
    '--doubao-mode',
    'work_turbo',
    '--no-thread-capture',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      FAKE_DOUBAO_MODE_INITIAL: '快速',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fake.dir}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const record = JSON.parse(result.stdout);
  assert.equal(record.ok, true);
  assert.equal(record.options.doubao_mode, 'work_turbo');
  assert.ok(record.raw.opencli_browser_trace.some((item) => String(item).includes('doubao_mode=work_turbo')));
});
test('batch records global and per-question doubao modes', () => {
  const fake = makeFakeOpenCli();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-mode-batch-'));
  const questions = path.join(tempDir, 'questions.json');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, `${JSON.stringify([
    { id: 'q01', question: '测试问题', repeat: 1 },
    { id: 'q02', question: '专家问题', repeat: 1, mode: '专家' },
  ], null, 2)}\n`);
  run(process.execPath, [
    batchScript,
    '--questions',
    questions,
    '--repeat',
    '1',
    '--doubao-mode',
    '工作任务 Pro',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
    '--delay-ms',
    '0',
    '--out-dir',
    outDir,
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      FAKE_DOUBAO_MODE_INITIAL: '快速',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fake.dir}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const dataset = JSON.parse(fs.readFileSync(path.join(outDir, 'doubao-crawl.json'), 'utf8'));
  assert.equal(dataset.input.doubao_mode, 'work_pro');
  const linkLines = fs.readFileSync(path.join(outDir, 'question-links.csv'), 'utf8').trim().split(/\r?\n/);
  assert.match(linkLines[0], /backend,doubao_mode,conversation_id/);
  assert.equal(linkLines[1].split(',')[6], 'work_pro');
  assert.equal(linkLines[2].split(',')[6], 'expert');
  const fullLines = fs.readFileSync(path.join(outDir, 'full-sample-data.csv'), 'utf8').trim().split(/\r?\n/);
  assert.match(fullLines[0], /backend,doubao_mode,thread_url/);
});
test('browser suggest questions are parsed from visible text', () => {
  const text = '相关视频\n视频标题示例\n问题一？\n问题二？\n问题三？';
  const parsed = parseSuggestQuestionsFromBrowserText(text);
  assert.deepEqual(parsed, ['问题一？', '问题二？', '问题三？']);
});

test('thread enrichment merges structured fields into a browser record', () => {
  const browserRecord = {
    ok: true,
    transport: 'opencli-browser-ui',
    answer: { text: '浏览器回答', brief: '' },
    references: { items: [] },
    references_full: [],
    suggest_questions: [],
    search_blocks: [],
    timing: { asked_at: '2026-08-04T10:00:00+08:00' },
    page: { conversation_id: '123' },
    pending_thread_capture: true,
  };
  const threadRecord = {
    ok: true,
    transport: 'doubao-thread-http',
    answer: { text: 'thread完整回答', brief: '摘要' },
    references: { items: [{ url: 'https://x.com/1' }], full: [{ doc_id: 'd1' }] },
    suggest_questions: [{ suggest_type: 1, content: '追问一？' }],
    search_blocks: [{ queries: ['关键词'] }],
    message_list: [{ message_id: 'm1' }],
    share_info: { share_id: 's1' },
    timing: { share_time: '2026-08-04T11:00:00+08:00', question_message_time: '2026-08-04T10:00:00+08:00' },
    page: { share_id: 's1', thread_url: 'https://www.doubao.com/thread/s1' },
    completion: { finished: true, signals: [] },
  };
  const merged = mergeThreadEnrichment(browserRecord, threadRecord);
  assert.equal(merged.answer.brief, '摘要');
  assert.equal(merged.references_full.length, 1);
  assert.equal(merged.suggest_questions.length, 1);
  assert.equal(merged.search_blocks.length, 1);
  assert.equal(merged.message_list.length, 1);
  assert.equal(merged.share_info.share_id, 's1');
  assert.equal(merged.page.thread_url, 'https://www.doubao.com/thread/s1');
  assert.equal(merged.pending_thread_capture, false);
  assert.match(merged.transport, /\+thread$/);
});

test('thread enrichment fills thread_url from thread page url', () => {
  const browserRecord = {
    ok: true,
    transport: 'opencli-browser-ui',
    answer: { text: '浏览器回答', brief: '' },
    references: { items: [] },
    references_full: [],
    suggest_questions: [],
    search_blocks: [],
    timing: { asked_at: '2026-08-04T10:00:00+08:00' },
    page: { conversation_id: '123' },
    pending_thread_capture: true,
  };
  const threadRecord = {
    ok: true,
    transport: 'doubao-thread-http',
    answer: { text: 'thread完整回答', brief: '摘要' },
    references: { items: [], full: [] },
    suggest_questions: [],
    search_blocks: [],
    timing: { share_time: '2026-08-04T11:00:00+08:00' },
    page: { url: 'https://www.doubao.com/thread/s2', share_id: 's2' },
    completion: { finished: true, signals: [] },
  };
  const merged = mergeThreadEnrichment(browserRecord, threadRecord);
  assert.equal(merged.page.thread_url, 'https://www.doubao.com/thread/s2');
  assert.equal(merged.page.share_id, 's2');
});

test('thread file mode parses the structured snapshot', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-thread-mode-'));
  const out = path.join(tempDir, 'sample.json');
  const result = run(process.execPath, [
    crawlerScript,
    '--thread-file',
    threadFixture,
    '--out',
    out,
  ]);
  const record = JSON.parse(result.stdout);
  assert.equal(record.ok, true);
  assert.equal(record.transport, 'doubao-thread-http');
  assert.equal(record.suggest_questions.length, 3);
  assert.equal(record.references.count, 17);
  assert.equal(record.redacted, true);
  const written = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(written.question, record.question);
});

test('batch output records when new conversations are disabled', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-no-new-'));
  const questions = path.join(tempDir, 'questions.txt');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, '测试问题\n');
  run(process.execPath, [
    batchScript,
    '--questions',
    questions,
    '--repeat',
    '1',
    '--dry-run',
    '--no-new',
    '--out-dir',
    outDir,
  ]);
  const dataset = JSON.parse(fs.readFileSync(path.join(outDir, 'doubao-crawl.json'), 'utf8'));
  assert.equal(dataset.input.new_conversation, false);
});

test('batch writes question-links.csv with timing', () => {
  const fake = makeFakeOpenCli();
  const fakeBin = fake.dir;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-question-links-'));
  const questions = path.join(tempDir, 'questions.txt');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, '测试问题\n');
  run(process.execPath, [
    batchScript,
    '--questions',
    questions,
    '--repeat',
    '1',
    '--poll-interval-seconds',
    '0',
    '--completion-timeout',
    '5',
    '--delay-ms',
    '0',
    '--out-dir',
    outDir,
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const csvPath = path.join(outDir, 'question-links.csv');
  assert.ok(fs.existsSync(csvPath));
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /run_id,sample_id,question_id,question,repeat_index,backend,doubao_mode,conversation_id,thread_url,share_id,asked_at,completed_at,fetched_at,ok,status,raw_path/);
  assert.match(lines[1], /^run,q01-r01,q01,/);
  const dataset = JSON.parse(fs.readFileSync(path.join(outDir, 'doubao-crawl.json'), 'utf8'));
  assert.ok(dataset.totals.timing_coverage >= 1);
});

test('reports label web runs that reuse conversation context', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-shared-context-'));
  const datasetPath = path.join(tempDir, 'doubao-crawl.json');
  const reportDir = path.join(tempDir, 'report');
  fs.writeFileSync(datasetPath, `${JSON.stringify({
    schema_version: 'doubao-crawler-web/v1',
    run: {
      engine: 'doubao',
      transport: 'opencli-doubao-adapter',
    },
    input: {
      new_conversation: false,
      delay_strategy: { mode: 'fixed', delay_ms: 0 },
    },
    plan: [{
      sample_id: 'q01-r01',
      question_id: 'q01',
      question: '测试问题',
      repeat_index: 1,
    }],
    samples: [{
      sample_id: 'q01-r01',
      question_id: 'q01',
      question: '测试问题',
      repeat_index: 1,
      ok: true,
      result: {
        ok: true,
        question: '测试问题',
        answer: { text: '正常回答。' },
        references: { items: [] },
        transport: 'opencli-doubao-adapter',
      },
    }],
  }, null, 2)}\n`);
  run(pythonCommand(), [analyzerScript, datasetPath, '--out-dir', reportDir]);
  const summary = JSON.parse(fs.readFileSync(path.join(reportDir, 'summary.json'), 'utf8'));
  const html = fs.readFileSync(path.join(reportDir, 'report.html'), 'utf8');
  assert.equal(summary.input.new_conversation, false);
  assert.match(html, /样本可能共享同一对话上下文/);
  assert.match(html, /Samples may share the same conversation context/);
});

test('default completion mode is browser', () => {
  const crawlerHelp = run(process.execPath, [crawlerScript, '--help']).stdout;
  assert.match(crawlerHelp, /--completion-mode <mode>\s+ask, send, or browser\. Default: browser\./);
  const batchHelp = run(process.execPath, [batchScript, '--help']).stdout;
  assert.match(batchHelp, /--completion-mode <mode>\s+ask, send, or browser\. Default: browser\./);
});

test('batch writes one field map HTML per question across repeats', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-field-map-dedup-'));
  const questions = path.join(tempDir, 'questions.txt');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, '测试问题\n');
  const rawDir = path.join(outDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  for (let i = 1; i <= 3; i += 1) {
    const sampleId = `q01-r${String(i).padStart(2, '0')}`;
    fs.writeFileSync(path.join(rawDir, `${sampleId}.json`), `${JSON.stringify({
      ok: true,
      transport: 'doubao-thread-http',
      question: '测试问题',
      answer: { text: i === 1 ? '第一轮回答正文' : `第${i}轮回答正文`, brief: '摘要' },
      references: { items: [{ url: 'https://example.com/a' }], count: 1 },
      references_full: [{ doc_id: 'd1', title: '文档', url: 'https://example.com/a' }],
      suggest_questions: [{ content: '追问一？' }],
      search_blocks: [{ queries: ['关键词'] }],
      timing: { asked_at: '2026-08-04T10:00:00+08:00', completed_at: '2026-08-04T10:00:30+08:00', share_time: '2026-08-04T10:00:31+08:00' },
      page: { thread_url: 'https://www.doubao.com/thread/xF21xuMrpXdcdEQZb', share_id: 'xF21xuMrpXdcdEQZb' },
      share_info: { share_id: 'xF21xuMrpXdcdEQZb', share_name: '测试分享' },
      completion: { finished: true },
      redacted: true,
    }, null, 2)}\n`);
  }
  run(process.execPath, [
    batchScript,
    '--questions', questions,
    '--repeat', '3',
    '--resume',
    '--no-new',
    '--poll-interval-seconds', '0',
    '--completion-timeout', '5',
    '--delay-ms', '0',
    '--out-dir', outDir,
  ]);
  const fieldMapsDir = path.join(outDir, 'field-maps');
  const maps = fs.readdirSync(fieldMapsDir).filter((name) => name.endsWith('.html'));
  assert.deepEqual(maps, ['q01-data-map.html']);
  const html = fs.readFileSync(path.join(fieldMapsDir, 'q01-data-map.html'), 'utf8');
  assert.match(html, /第一轮回答正文/);
  const csvLines = fs.readFileSync(path.join(outDir, 'full-sample-data.csv'), 'utf8').trim().split(/\r?\n/);
  assert.equal(csvLines.length, 4);
});

test('batch defaults to repeat=1 and random 60-100s delay', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-defaults-'));
  const questions = path.join(tempDir, 'questions.txt');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, '问题一\n问题二\n');
  run(process.execPath, [batchScript, '--questions', questions, '--dry-run', '--out-dir', outDir]);
  const dataset = JSON.parse(fs.readFileSync(path.join(outDir, 'doubao-crawl.json'), 'utf8'));
  assert.equal(dataset.input.global_repeat, 1);
  assert.equal(dataset.plan.length, 2);
  assert.equal(dataset.input.delay_strategy.mode, 'random');
  assert.equal(dataset.input.delay_strategy.min_ms, 60000);
  assert.equal(dataset.input.delay_strategy.max_ms, 100000);
  assert.equal(dataset.input.create_share, true);
  assert.equal(dataset.input.share_links_excel, true);
});

test('batch plan-order controls question vs round ordering', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-plan-order-'));
  const questions = path.join(tempDir, 'questions.json');
  fs.writeFileSync(questions, `${JSON.stringify([
    { id: 'q01', question: '问题一', repeat: 2 },
    { id: 'q02', question: '问题二', repeat: 2 },
  ], null, 2)}\n`);
  const roundDir = path.join(tempDir, 'round');
  run(process.execPath, [batchScript, '--questions', questions, '--dry-run', '--out-dir', roundDir]);
  const roundDataset = JSON.parse(fs.readFileSync(path.join(roundDir, 'doubao-crawl.json'), 'utf8'));
  assert.deepEqual(roundDataset.plan.map((item) => item.sample_id), ['q01-r01', 'q02-r01', 'q01-r02', 'q02-r02']);
  const questionDir = path.join(tempDir, 'question');
  run(process.execPath, [batchScript, '--questions', questions, '--plan-order', 'question', '--dry-run', '--out-dir', questionDir]);
  const questionDataset = JSON.parse(fs.readFileSync(path.join(questionDir, 'doubao-crawl.json'), 'utf8'));
  assert.deepEqual(questionDataset.plan.map((item) => item.sample_id), ['q01-r01', 'q01-r02', 'q02-r01', 'q02-r02']);
});

test('batch versions output dir instead of overwriting an existing run', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-versioned-'));
  const questions = path.join(tempDir, 'questions.txt');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, '测试问题\n');
  run(process.execPath, [batchScript, '--questions', questions, '--dry-run', '--out-dir', outDir]);
  const first = JSON.parse(fs.readFileSync(path.join(outDir, 'doubao-crawl.json'), 'utf8'));
  run(process.execPath, [batchScript, '--questions', questions, '--dry-run', '--out-dir', outDir]);
  const secondPath = `${outDir}-v2`;
  const second = JSON.parse(fs.readFileSync(path.join(secondPath, 'doubao-crawl.json'), 'utf8'));
  assert.equal(first.run.dir, path.resolve(outDir));
  assert.equal(second.run.dir, path.resolve(secondPath));
  assert.equal(second.input.out_dir, path.resolve(secondPath));
});

test('batch resume reruns samples without a valid thread share under repair-shares', () => {
  const fake = makeFakeOpenCli();
  const fakeBin = fake.dir;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-repair-shares-'));
  const questions = path.join(tempDir, 'questions.txt');
  const outDir = path.join(tempDir, 'run');
  fs.writeFileSync(questions, '测试问题\n');
  const rawDir = path.join(outDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  fs.writeFileSync(path.join(rawDir, 'q01-r01.json'), `${JSON.stringify({
    ok: true,
    question: '测试问题',
    answer: { text: '旧答案正文' },
    references: { items: [] },
    transport: 'opencli-browser-ui',
  }, null, 2)}\n`);
  run(process.execPath, [
    batchScript,
    '--questions', questions,
    '--repeat', '1',
    '--resume',
    '--repair-shares',
    '--poll-interval-seconds', '0',
    '--completion-timeout', '5',
    '--delay-ms', '0',
    '--out-dir', outDir,
  ], {
    env: {
      ...process.env,
      FAKE_DOUBAO_CASE: '',
      DOUBAO_OPENCLI_JS: fake.jsPath,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
    },
  });
  const dataset = JSON.parse(fs.readFileSync(path.join(outDir, 'doubao-crawl.json'), 'utf8'));
  assert.equal(dataset.samples.length, 1);
  assert.equal(dataset.samples[0].ok, false);
  assert.equal(dataset.samples[0].result.failure_reason, 'thread_link_failed');
  assert.equal(dataset.samples[0].result.pending_thread_capture, true);
});
