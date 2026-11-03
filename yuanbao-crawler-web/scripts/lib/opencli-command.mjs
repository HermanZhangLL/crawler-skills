import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let cached = null;
let cachedEntry = null;

function quoteWin(value) {
  const text = String(value ?? '');
  if (!/[\s"&|<>^()]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function resolveWindowsEntry(cmdPath) {
  try {
    const content = fs.readFileSync(cmdPath, 'utf8');
    const match = content.match(/"(?:%~dp0|%dp0%)[\\/]([^"]+?\.js)"/i);
    if (match) {
      const entry = path.resolve(path.dirname(cmdPath), match[1]);
      if (fs.existsSync(entry)) return entry;
    }
  } catch {
    // fall through
  }
  return null;
}

export function opencliCommand() {
  if (cached) return cached;
  if (process.platform !== 'win32') {
    cached = 'opencli';
    return cached;
  }
  try {
    const result = spawnSync('where.exe', ['opencli'], { encoding: 'utf8' });
    if (result.status === 0) {
      const lines = String(result.stdout || '').trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const pick = lines.find((line) => /\.(cmd|exe|bat)$/i.test(line))
        || lines.find((line) => /\.ps1$/i.test(line))
        || lines[0];
      if (pick) {
        cached = pick;
        return cached;
      }
    }
    const cmdResult = spawnSync('where.exe', ['opencli.cmd'], { encoding: 'utf8' });
    if (cmdResult.status === 0) {
      const line = String(cmdResult.stdout || '').trim().split(/\r?\n/)[0];
      if (line) {
        cached = line;
        return cached;
      }
    }
  } catch {
    // fall through to default
  }
  cached = 'opencli';
  return cached;
}

export function opencliExec(args = []) {
  const command = opencliCommand();
  if (process.platform !== 'win32') return [command, args];
  if (!cachedEntry) cachedEntry = resolveWindowsEntry(command);
  if (cachedEntry) return [process.execPath, [cachedEntry, ...args]];
  const shell = process.env.ComSpec || 'cmd.exe';
  const suffix = args.length ? ' ' + args.map(quoteWin).join(' ') : '';
  return [shell, ['/d', '/c', `opencli${suffix}`]];
}
