#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { opencliExec } from './lib/opencli-command.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { profile: '', prompt: '', timeout: 600, out: '', new: true, id: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--prompt') args.prompt = argv[++i] || '';
    else if (a === '--profile') args.profile = argv[++i] || '';
    else if (a === '--timeout') args.timeout = Number(argv[++i] || 600);
    else if (a === '--out') args.out = argv[++i] || '';
    else if (a === '--id' || a === '--sample-id') args.id = argv[++i] || '';
    else if (a === '--no-new') args.new = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function cli(args, timeoutMs = 600000) {
  const [cmd, baseArgs] = opencliExec();
  const full = [...baseArgs];
  if (args.profile) full.push('--profile', args.profile);
  full.push(...args.args);
  try {
    const out = execFileSync(cmd, full, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 40 * 1024 * 1024 });
    return { ok: true, output: String(out || '') };
  } catch (error) {
    return { ok: false, output: `${error.stdout || ''}${error.stderr || ''}`, message: error.message || '' };
  }
}

function extractJson(text) {
  const raw = String(text || '').trim();
  for (const ch of ['[', '{']) {
    const s = raw.indexOf(ch);
    if (s >= 0) {
      try { return JSON.parse(raw.slice(s)); } catch { /* keep looking */ }
    }
  }
  return null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node qianwen_single.mjs --prompt <text> --profile <p> [--timeout 300] [--out file.json]');
    process.exit(0);
  }
  if (!options.prompt) throw new Error('Missing --prompt');
  const startedAt = new Date();
  const askArgs = ['qwen', 'ask', options.prompt, '--new', String(options.new), '--timeout', String(options.timeout), '--format', 'json'];
  const res = cli({ profile: options.profile, args: askArgs }, (options.timeout + 60) * 1000);
  const parsed = extractJson(res.output);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const assistant = rows.find((r) => String(r?.Role || r?.role || '').toLowerCase().includes('assistant'))
    || rows[rows.length - 1] || {};
  const answer = String(assistant?.Text ?? assistant?.text ?? '').trim();
  const record = {
    ok: Boolean(answer) && res.ok,
    engine: 'qianwen',
    transport: 'opencli-qwen-adapter',
    sample_id: options.id || '',
    question_id: options.id ? options.id.replace(/-r\d+$/, '') : '',
    question: options.prompt,
    options: { profile: options.profile, timeout: options.timeout, new_chat: options.new },
    timing: { asked_at: startedAt.toISOString(), finished_at: new Date().toISOString() },
    answer: { text: answer },
    error: answer ? '' : (res.output || res.message || 'empty_answer').slice(0, 500),
    raw: res.output.slice(0, 2000),
  };
  // Best-effort: capture current chat URL/session after asking.
  const status = cli({ profile: options.profile, args: ['qwen', 'status', '-f', 'json'] }, 30000);
  const st = extractJson(status.output);
  const row0 = Array.isArray(st) ? st[0] : st;
  record.session_id = String(row0?.SessionId ?? row0?.session_id ?? row0?.sessionId ?? '');
  record.chat_url = String(row0?.Url ?? '');
  // Qianwen status sometimes omits SessionId; derive it from the chat URL so
  // downstream grouping/link tables always have a stable conversation key.
  if (!record.session_id && record.chat_url) {
    const m = record.chat_url.match(/\/chat\/([0-9a-zA-Z]+)/);
    if (m) record.session_id = m[1];
  }
  if (!record.chat_url && record.session_id) {
    record.chat_url = `https://www.qianwen.com/chat/${record.session_id}`;
  }
  record.model = String(row0?.Model ?? '');
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(record, null, 2), 'utf8');
  }
  console.log(JSON.stringify(record, null, 2));
}

main();
