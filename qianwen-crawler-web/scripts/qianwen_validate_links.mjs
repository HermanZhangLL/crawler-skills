#!/usr/bin/env node
/* Validate that each Qianwen conversation URL is a real session that contains
 * the expected question. Qianwen has no public share API, so neither a raw
 * chat_url captured after the fact nor a group row may be trusted without this
 * check. A session that is gone silently redirects to https://www.qianwen.com/chat,
 * which is exactly what a naive "capture the URL" step produces for refused or
 * unsaved answers.
 *
 * Two input modes:
 *   --questions questions.json --raw-dir runs/main/raw   (validate captured raw)
 *   --table links.csv                                    (validate a built link table)
 *
 * A page that has not finished loading still looks like a miss, so every
 * failure is retried (`--retries`, default 2) before the link is condemned.
 *
 * Usage:
 *   node scripts/qianwen_validate_links.mjs \
 *     --table 和光书苑_千问_问题链接汇总.csv \
 *     --out validate.json [--profile <p>] [--sleep 5000] [--retries 2]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { opencliExec } from './lib/opencli-command.mjs';

function parseArgs(argv) {
  const a = { profile: '', sleep: 5000, out: '', questions: '', rawDir: '', table: '', retries: 2 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--questions') a.questions = argv[++i];
    else if (k === '--raw-dir') a.rawDir = argv[++i];
    else if (k === '--table') a.table = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--profile') a.profile = argv[++i];
    else if (k === '--sleep') a.sleep = Number(argv[++i]);
    else if (k === '--retries') a.retries = Number(argv[++i]);
    else if (k === '-h' || k === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!a.help && !a.out) throw new Error('--out is required');
  if (!a.help && !a.table && (!a.questions || !a.rawDir)) throw new Error('either --table, or --questions with --raw-dir, is required');
  return a;
}

function cli(args, profile, timeoutMs = 90000) {
  const [cmd, base] = opencliExec();
  const full = [...base];
  if (profile) full.push('--profile', profile);
  full.push(...args);
  try { return String(execFileSync(cmd, full, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 40 * 1024 * 1024 })); }
  catch (e) { return String((e.stdout || '') + (e.stderr || '') + (e.message || '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/[\s\u3000]+/g, '');

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node scripts/qianwen_validate_links.mjs --table <csv> --out <file> [--profile <p>] [--sleep 5000] [--retries 2]');
  console.log('       node scripts/qianwen_validate_links.mjs --questions <file> --raw-dir <dir> --out <file> [--profile <p>]');
  process.exit(0);
}

function splitCsvLine(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

function tableEntries(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0]);
  const iId = header.indexOf('问题编号');
  const iQ = header.indexOf('问题');
  const iUrl = header.indexOf('千问会话链接');
  if (iId < 0 || iQ < 0 || iUrl < 0) throw new Error(`CSV header missing 问题编号/问题/千问会话链接: ${lines[0]}`);
  return lines.slice(1).map((line) => {
    const c = splitCsvLine(line);
    const url = (c[iUrl] || '').trim();
    return { id: (c[iId] || '').trim(), question: (c[iQ] || '').trim(), url, sid: (url.match(/\/chat\/([0-9a-zA-Z]+)/) || [])[1] || '' };
  }).filter((e) => e.id);
}

const entries = args.table
  ? tableEntries(args.table)
  : JSON.parse(fs.readFileSync(args.questions, 'utf8')).map((q) => {
    const rawPath = path.join(args.rawDir, `${q.id}-r01.json`);
    let r = {};
    try { r = JSON.parse(fs.readFileSync(rawPath, 'utf8')); } catch { r = {}; }
    const url = r.chat_url || '';
    return {
      id: q.id,
      question: q.question,
      url,
      sid: r.session_id || (String(url).match(/\/chat\/([0-9a-zA-Z]{16,})/) || [])[1] || '',
      missingRaw: !r.ok,
    };
  });

const session = 'qw-validate';
const out = [];
for (const q of entries) {
  const entry = { id: q.id, question: q.question, raw: !q.missingRaw, sid: q.sid, link: q.url, ok: false, note: '' };
  if (!q.sid) {
    entry.note = q.missingRaw ? 'no_raw' : (q.url ? 'no_session_id' : 'no_link');
    out.push(entry);
    // Always print one line per link: silent rows look like a hung run.
    console.log(entry.id, '-', `FAIL:${entry.note}`);
    continue;
  }
  const sid = q.sid;
  const attempts = Math.max(1, args.retries);
  for (let attempt = 1; attempt <= attempts && !entry.ok; attempt += 1) {
    entry.attempts = attempt;
    cli(['browser', session, 'open', `https://www.qianwen.com/chat/${sid}`, '--window', 'background'], args.profile);
    await sleep(attempt === 1 ? args.sleep : Math.round(args.sleep * 1.6));
    let text = '';
    let href = '';
    try { text = norm(cli(['browser', session, 'eval', "(() => (document.body.innerText || ''))()", '--window', 'background'], args.profile)); } catch { /* ignore */ }
    try { href = cli(['browser', session, 'eval', '(() => location.href)()', '--window', 'background'], args.profile).trim().replace(/^"|"$/g, ''); } catch { /* ignore */ }
    entry.href = href;
    entry.ok = text.includes(norm(q.question));
    if (entry.ok) entry.note = '';
    else if (/\/chat\/?$/.test(href)) entry.note = 'redirected_to_new_chat';
    else entry.note = text.length ? 'question_not_found' : 'empty_page';
  }
  out.push(entry);
  console.log(entry.id, entry.sid.slice(0, 8), entry.ok ? `OK(a${entry.attempts})` : `FAIL:${entry.note}(a${entry.attempts})`);
}
fs.writeFileSync(args.out, JSON.stringify(out, null, 1), 'utf8');
const valid = out.filter((x) => x.ok).length;
console.log(JSON.stringify({
  total: out.length, valid, invalid: out.length - valid,
  invalid_ids: out.filter((x) => !x.ok).map((x) => `${x.id}:${x.note}`),
  out: args.out,
}, null, 2));
