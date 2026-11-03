#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { opencliExec } from './lib/opencli-command.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function cli(args, timeoutMs = 60000) {
  const [cmd, base] = opencliExec();
  try {
    const out = execFileSync(cmd, [...base, ...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 });
    return { ok: true, output: String(out || '') };
  } catch (error) {
    return { ok: false, output: `${error.stdout || ''}${error.stderr || ''}`, message: error.message || '' };
  }
}

const checks = [];
checks.push(['node', fs.existsSync(path.join(skillRoot, 'scripts', 'qianwen_single.mjs')) && fs.existsSync(path.join(skillRoot, 'scripts', 'qianwen_batch_crawl.mjs')) ? 'pass' : 'fail', 'single+batch scripts present']);
checks.push(['opencli-resolver', (() => { try { const [c] = opencliExec(); return c ? 'pass' : 'fail'; } catch { return 'fail'; } })(), 'opencli command resolvable']);

const args = process.argv.slice(2);
let profile = '';
for (let i = 0; i < args.length; i += 1) if (args[i] === '--profile') profile = args[++i] || '';

if (profile) {
  const who = cli(['--profile', profile, 'qwen', 'status', '-f', 'json'], 45000);
  const loginOk = /"Login"\s*:\s*"Yes"/i.test(who.output) || /logged_in\s*:\s*true/i.test(who.output);
  checks.push(['qwen-status', loginOk ? 'pass' : 'warn', who.ok ? who.output.slice(0, 300) : 'qwen status unavailable; login/guest?']);
} else {
  checks.push(['qwen-status', 'skip', 'no --profile passed']);
}

let exit = 0;
console.log('Qianwen Crawler preflight');
for (const [k, s, d] of checks) { console.log(`[${String(s).toUpperCase()}] ${k}: ${d}`); if (s === 'fail') exit = 1; }
process.exit(exit);
