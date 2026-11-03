#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const defaultSingle = path.join(skillRoot, 'scripts', 'qianwen_single.mjs');
const MINUTE_MS = 60 * 1000;
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function parseArgs(argv) {
  const args = {
    repeat: 1,
    timeout: 600,
    profile: '',
    questions: '',
    outDir: '',
    targetEntity: '',
    entityType: '',
    singleScript: defaultSingle,
    resume: false,
    dryRun: false,
    planOrder: 'question',
    delayMinMs: 60 * 1000,
    delayMaxMs: 100 * 1000,
    pauseAfterFails: 3,
    pauseMinutes: 20,
    circuitBreaker: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const take = () => argv[++i];
    if (a === '--questions') args.questions = take();
    else if (a === '--repeat') args.repeat = Number(take());
    else if (a === '--profile') args.profile = take();
    else if (a === '--target-entity' || a === '--target') args.targetEntity = take();
    else if (a === '--entity-type') args.entityType = take();
    else if (a === '--out-dir') args.outDir = take();
    else if (a === '--single-script') args.singleScript = take();
    else if (a === '--timeout') args.timeout = Number(take());
    else if (a === '--resume') args.resume = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--plan-order') args.planOrder = String(take()).toLowerCase();
    else if (a === '--delay-ms') args.delayMinMs = args.delayMaxMs = Number(take());
    else if (a === '--delay-min-ms') args.delayMinMs = Number(take());
    else if (a === '--delay-max-ms') args.delayMaxMs = Number(take());
    else if (a === '--safe-random-delay') { args.delayMinMs = 5 * MINUTE_MS; args.delayMaxMs = 20 * MINUTE_MS; }
    else if (a === '--pause-after-fails') args.pauseAfterFails = Number(take());
    else if (a === '--pause-minutes') args.pauseMinutes = Number(take());
    else if (a === '--no-circuit-breaker') args.circuitBreaker = false;
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function appendLog(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
}

function runSingle(options, sample, outDir, timeoutMs) {
  const rawPath = path.join(outDir, 'raw', `${sample.sampleId}.json`);
  const logPath = path.join(outDir, 'logs', `${sample.sampleId}.log`);
  const childArgs = [options.singleScript, '--prompt', sample.question, '--id', sample.sampleId, '--profile', options.profile || '', '--timeout', String(options.timeout), '--out', rawPath];
  appendLog(logPath, `$ node ${childArgs.map((s) => JSON.stringify(s)).join(' ')}\n`);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, childArgs, { cwd: skillRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let settled = false;
    // The watchdog must be cleared on every exit path. Previously it was left
    // armed, so a finished child still kept the event loop alive for the full
    // (timeout + 120)s -- roughly 12 idle minutes per batch at the default 600s
    // timeout, which also stalled the wrapper loops that wait for node to exit.
    let watchdog = null;
    const settle = (payload) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      resolve(payload);
    };
    child.stdout.on('data', (c) => { buf += c; appendLog(logPath, c.toString()); });
    child.stderr.on('data', (c) => appendLog(logPath, c.toString()));
    child.on('error', (e) => settle({ ok: false, error: e.message }));
    child.on('close', (code) => {
      let result = null;
      // Prefer the raw file written by qianwen_single (authoritative), then fall
      // back to the last stdout JSON line. Stdout may end with blank/extra lines
      // after the JSON, which previously caused false "no_result" records.
      try { result = JSON.parse(fs.readFileSync(rawPath, 'utf8')); } catch { /* ignore */ }
      if (!result) { try { result = JSON.parse(buf.trim().split('\n').pop()); } catch { /* ignore */ } }
      settle({ ok: code === 0 && Boolean(result?.ok), result, rawPath });
    });
    watchdog = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    if (typeof watchdog.unref === 'function') watchdog.unref();
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.questions) {
    console.log(`Usage: node qianwen_batch_crawl.mjs --questions <file> --repeat 1 --profile <p> [--timeout 300] [--resume] [--dry-run] [--delay-min-ms 60000 --delay-max-ms 100000 | --safe-random-delay] [--out-dir <dir>]`);
    process.exit(options.help ? 0 : 1);
  }
  const raw = fs.readFileSync(options.questions, 'utf8').trim();
  let questions;
  try { questions = JSON.parse(raw); }
  catch { questions = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s, i) => ({ id: `q${String(i + 1).padStart(2, '0')}`, question: s })); }
  const plan = [];
  for (const q of questions) {
    const id = q.id || q.sample_id;
    for (let r = 1; r <= options.repeat; r += 1) plan.push({ id, question: q.question, sampleId: `${id}-r${String(r).padStart(2, '0')}` });
  }
  const outDir = path.resolve(options.outDir || path.join(skillRoot, 'runs', `qianwen-${Date.now()}`));
  const datasetPath = path.join(outDir, 'qianwen-crawl.json');
  // Always create outDir so the dataset (including the dry-run plan) can be written.
  fs.mkdirSync(outDir, { recursive: true });
  if (!options.dryRun) fs.mkdirSync(path.join(outDir, 'raw'), { recursive: true });
  if (!options.dryRun) fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
  const dataset = { schema_version: 'qianwen-crawler-web/v1', run: { started_at: new Date().toISOString(), profile: options.profile }, input: options, samples: [] };
  let consecutiveFails = 0;
  let cooldowns = 0;
  for (let i = 0; i < plan.length; i += 1) {
    const sample = plan[i];
    console.log(`[${i + 1}/${plan.length}] ${sample.sampleId}`);
    if (options.dryRun) { dataset.samples.push({ ...sample, status: 'planned' }); continue; }
    const rawPath = path.join(outDir, 'raw', `${sample.sampleId}.json`);
    let record = null;
    if (options.resume && fs.existsSync(rawPath)) {
      try { const old = JSON.parse(fs.readFileSync(rawPath, 'utf8')); if (old?.ok && old.question === sample.question) record = { reused: true, ...old }; } catch { /* ignore */ }
    }
    if (!record) {
      const out = await runSingle(options, sample, outDir, (options.timeout + 120) * 1000);
      record = out.result || { ok: false, error: out.error || 'no_result', question: sample.question };
    }
    dataset.samples.push({ sample_id: sample.sampleId, question_id: sample.id, question: sample.question, ok: Boolean(record.ok), ...record });
    fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf8');
    if (!record.ok && !record.reused) consecutiveFails += 1; else consecutiveFails = 0;
    if (options.circuitBreaker && options.pauseAfterFails > 0 && consecutiveFails >= options.pauseAfterFails && i < plan.length - 1) {
      cooldowns += 1;
      const pauseMs = Math.max(0, options.pauseMinutes) * MINUTE_MS;
      console.log(`[circuit-breaker] ${consecutiveFails} consecutive failures -- cooling down ${options.pauseMinutes} min before continuing`);
      appendLog(path.join(outDir, 'batch.log'), `${new Date().toISOString()} [circuit-breaker] ${consecutiveFails} consecutive failures; cooldown ${options.pauseMinutes} min\n`);
      consecutiveFails = 0;
      await new Promise((r) => setTimeout(r, pauseMs));
    }
    if (i < plan.length - 1 && !record.reused) {
      const delay = rand(options.delayMinMs, options.delayMaxMs);
      console.log(`[delay] waiting ${Math.round(delay / 1000)}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  dataset.run.finished_at = new Date().toISOString();
  dataset.totals = {
    planned: plan.length,
    ok: dataset.samples.filter((s) => s.ok).length,
    failed: dataset.samples.filter((s) => !s.ok && !s.reused).length,
    cooldowns,
  };
  // Dry-run also writes the plan dataset so callers can inspect it without touching the browser.
  fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, dry_run: options.dryRun, out_dir: outDir, samples: plan.length, totals: dataset.totals }, null, 2));
}

main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
