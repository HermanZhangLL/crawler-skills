#!/usr/bin/env node
/* Enumerate the conversations inside a Qianwen group page (best effort:
 * the front end virtualises the list, so scroll repeatedly until it stops
 * growing and keep the longest text seen for each session id).
 *
 * Usage:
 *   node scripts/qianwen_enumerate_group.mjs --group-url <url> --out group.json [--profile <p>]
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { opencliExec } from './lib/opencli-command.mjs';

function parseArgs(argv) {
  const a = { groupUrl: '', out: '', profile: '', session: 'qw-enum', maxRounds: 120, idleLimit: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--group-url') a.groupUrl = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--profile') a.profile = argv[++i];
    else if (k === '--session') a.session = argv[++i];
    else if (k === '--max-rounds') a.maxRounds = Number(argv[++i]);
    else if (k === '-h' || k === '--help') a.help = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!a.help && (!a.groupUrl || !a.out)) throw new Error('--group-url and --out are required');
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

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: node scripts/qianwen_enumerate_group.mjs --group-url <url> --out <file> [--profile <p>]');
  process.exit(0);
}
cli(['browser', args.session, 'open', args.groupUrl, '--window', 'background'], args.profile);
await sleep(7000);

const collectJs = `(() => {
  const rows = Array.from(document.querySelectorAll('div[data-session-id]')).map((r) => ({
    sid: r.getAttribute('data-session-id'),
    text: (r.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1500),
  }));
  return JSON.stringify(rows);
})()`;
const scrollJs = `(() => {
  const els = Array.from(document.querySelectorAll('*')).filter((e) => e.scrollHeight > e.clientHeight + 80);
  for (const e of els) e.scrollTop = e.scrollHeight;
  const more = Array.from(document.querySelectorAll('button,div,span')).filter((el) => /加载更多|展开更多|查看更多/.test((el.innerText || '').trim()) && el.offsetParent);
  for (const m of more.slice(0, 3)) { try { m.click(); } catch {} }
  window.dispatchEvent(new WheelEvent('wheel', { deltaY: 3000, bubbles: true }));
  return 'sc';
})()`;

const seen = new Map();
let idle = 0;
for (let i = 0; i < args.maxRounds && idle < args.idleLimit; i += 1) {
  let rows = [];
  try { rows = JSON.parse(cli(['browser', args.session, 'eval', collectJs, '--window', 'background'], args.profile).trim()); } catch { rows = []; }
  const before = seen.size;
  for (const r of rows) {
    if (!r.sid) continue;
    const prev = seen.get(r.sid);
    if (!prev || (r.text || '').length > prev.length) seen.set(r.sid, r.text || '');
  }
  const grew = seen.size > before;
  cli(['browser', args.session, 'eval', scrollJs, '--window', 'background'], args.profile);
  await sleep(650);
  if (!grew) idle += 1; else idle = 0;
}
const list = [...seen.entries()].map(([sid, text]) => ({ sid, text }));
fs.writeFileSync(args.out, JSON.stringify(list, null, 1), 'utf8');
console.log(JSON.stringify({ groupUrl: args.groupUrl, count: list.length, out: args.out }, null, 2));
