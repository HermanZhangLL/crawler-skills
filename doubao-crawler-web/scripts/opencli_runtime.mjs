#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let cached = null;

export function resolveOpenCli() {
  if (cached) return cached;
  const envJs = process.env.DOUBAO_OPENCLI_JS;
  if (envJs) {
    cached = { command: process.execPath, args: [envJs] };
    return cached;
  }
  if (process.platform !== 'win32') {
    cached = { command: 'opencli', args: [] };
    return cached;
  }
  try {
    execFileSync('opencli', ['--version'], { stdio: 'ignore', timeout: 5000 });
    cached = { command: 'opencli', args: [] };
    return cached;
  } catch {
    // fall through to npm .cmd shim resolution
  }
  try {
    const whereOutput = execFileSync('where.exe', ['opencli'], { encoding: 'utf8', timeout: 5000 });
    const candidates = String(whereOutput || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      if (!/\.(cmd|bat)$/i.test(candidate)) continue;
      const content = fs.readFileSync(candidate, 'utf8');
      const match = content.match(/"%dp0%\\([^"]+\.js)"/i);
      if (!match) continue;
      const jsPath = path.resolve(path.dirname(candidate), match[1]);
      if (fs.existsSync(jsPath)) {
        cached = { command: process.execPath, args: [jsPath] };
        return cached;
      }
    }
  } catch {
    // fall through
  }
  cached = { command: 'opencli', args: [] };
  return cached;
}

export function runOpenCli(args, options = {}) {
  const runtime = resolveOpenCli();
  const fullArgs = [...runtime.args];
  if (options.profile) fullArgs.push('--profile', options.profile);
  fullArgs.push(...args);
  return execFileSync(runtime.command, fullArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 360000,
    maxBuffer: 20 * 1024 * 1024,
  });
}
