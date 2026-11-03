#!/usr/bin/env node
/* Move collected Qianwen conversations into a 千问分组 (folder).
 * Order guarantee: sessions already have chat_url/session captured (raw JSON);
 * this stage only organizes them into the group via web drag-and-drop.
 * Usage:
 *   node scripts/qianwen_move_to_group.mjs --run-dir <dir> --group "<分组名>" --profile <p> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { opencliExec } from './lib/opencli-command.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function parseArgs(argv) {
  const a = { runDir: '', group: '', profile: '', dryRun: false, session: 'qw-move', maxScroll: 15 };
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === '--run-dir') a.runDir = argv[++i] || '';
    else if (x === '--group') a.group = argv[++i] || '';
    else if (x === '--profile') a.profile = argv[++i] || '';
    else if (x === '--session') a.session = argv[++i] || '';
    else if (x === '--max-scroll') a.maxScroll = Number(argv[++i] || 15);
    else if (x === '--dry-run') a.dryRun = true;
    else if (x === '-h' || x === '--help') a.help = true;
    else throw new Error('Unknown argument: ' + x);
  }
  return a;
}
function cli(args, timeoutMs = 60000) {
  const [cmd, base] = opencliExec();
  try {
    return String(execFileSync(cmd, [...base, ...(args.profile ? ['--profile', args.profile] : []), ...args.args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }));
  } catch (e) {
    return String((e.stdout || '') + (e.stderr || '') + (e.message || ''));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.runDir || !o.group) {
    console.log('Usage: node qianwen_move_to_group.mjs --run-dir <dir> --group "<group>" --profile <p> [--dry-run]');
    process.exit(o.help ? 0 : 1);
  }
  const rawDir = path.join(o.runDir, 'raw');
  const files = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).filter((f) => f.endsWith('.json')) : [];
  const sids = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8'));
      if (r.ok && (r.session_id || r.chat_url)) {
        let sid = r.session_id || '';
        if (!sid && r.chat_url) { const m = String(r.chat_url).match(/\/chat\/([0-9a-zA-Z]+)/); if (m) sid = m[1]; }
        sids.push({ file: f, sid, url: r.chat_url || '' });
      }
    } catch { /* ignore */ }
  }
  console.log('会话总数:', sids.length);
  if (o.dryRun) { console.log(sids.map((s) => s.sid).join('\n')); return; }

  cli({ profile: o.profile, args: ['browser', o.session, 'open', 'https://www.qianwen.com/', '--window', 'background'] });
  await sleep(6000);
  const markGroup = `(() => {
    const els = Array.from(document.querySelectorAll('div')).filter((el) => {
      const c = (el.className || '').toString();
      return (el.innerText || '').trim() === ${JSON.stringify(o.group)} && c.includes('cursor-pointer') && c.includes('h-9');
    });
    if (els[0]) { els[0].id = 'qwgroup'; return 'marked'; }
    return 'no_group';
  })()`;
  console.log('group:', cli({ profile: o.profile, args: ['browser', o.session, 'eval', markGroup, '--window', 'background'] }).trim());
  await sleep(1000);

  let okCount = 0;
  const skipped = [];
  for (const item of sids) {
    if (!item.sid) { skipped.push(item.file + ':no-sid'); continue; }
    const findRow = `(() => {
      const rows = Array.from(document.querySelectorAll('div[data-session-id]'));
      const row = rows.find((r) => r.getAttribute('data-session-id') === ${JSON.stringify(item.sid)});
      if (row) { row.id = 'qwrow'; return 'found'; }
      return 'missing';
    })()`;
    const st = cli({ profile: o.profile, args: ['browser', o.session, 'eval', findRow, '--window', 'background'] }).trim();
    if (st.includes('missing')) {
      // Scroll the conversation list to load more rows
      for (let i = 0; i < o.maxScroll; i += 1) {
        cli({ profile: o.profile, args: ['browser', o.session, 'eval', `(() => { const scope = document.querySelector('aside') || document.body; const els=Array.from(scope.querySelectorAll('*')).filter((e)=>e.scrollHeight>e.clientHeight+100); for (const e of els) e.scrollTop=e.scrollHeight; return 'sc'; })()`, '--window', 'background'] });
        await sleep(500);
        const st2 = cli({ profile: o.profile, args: ['browser', o.session, 'eval', findRow, '--window', 'background'] }).trim();
        if (st2.includes('found')) break;
      }
    }
    const stFinal = cli({ profile: o.profile, args: ['browser', o.session, 'eval', findRow, '--window', 'background'] }).trim();
    if (!stFinal.includes('found')) { skipped.push(item.file); continue; }
    cli({ profile: o.profile, args: ['browser', o.session, 'drag', '#qwrow', '#qwgroup', '--window', 'background'] });
    await sleep(1500);
    okCount += 1;
    console.log('moved:', item.sid, item.file);
  }
  console.log(JSON.stringify({ total: sids.length, moved: okCount, skipped }, null, 2));
}
main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
