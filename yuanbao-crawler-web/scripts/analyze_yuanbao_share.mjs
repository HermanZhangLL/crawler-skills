#!/usr/bin/env node
// Experimental public share-link analyzer for Tencent Yuanbao.
// Usage:
//   node analyze_yuanbao_share.mjs --link <yb.tencent.com/s/<shareId>> --out <json>
// It fetches the public share page (no login), extracts the Next.js __NEXT_DATA__
// payload, probes its structure (see lib/yuanbao-share-structure.mjs), and
// normalizes the question, answer text, references, media, and metadata according
// to the discovered layout — field paths are not hardcoded as the only option.
import fs from 'node:fs';
import path from 'node:path';
import { probeYuanbaoShare, extractYuanbaoShare } from './lib/yuanbao-share-structure.mjs';

const SHARE_URL_RE = /yb\.tencent\.com\/s\/([A-Za-z0-9_-]+)/i;

function parseArgs(argv) {
  const args = { link: '', out: '', html: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--link') args.link = argv[++i] || '';
    else if (arg === '--out') args.out = argv[++i] || '';
    else if (arg === '--html') args.html = argv[++i] || '';
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function extractNextData(html) {
  const match = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NEXT_DATA__ script tag was not found in the share page');
  return JSON.parse(match[1]);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  node analyze_yuanbao_share.mjs --link <url> --out <file>

Options:
  --link <url>   Public Yuanbao share URL, for example https://yb.tencent.com/s/fAgkFxe4dQLG.
  --html <file>  Optional local HTML file of the share page (skips network fetch).
  --out <file>   Output JSON path.
`);
    return;
  }
  if (!args.link) throw new Error('Missing --link <url>');
  if (!args.out) throw new Error('Missing --out <file>');
  const match = String(args.link).match(SHARE_URL_RE);
  if (!match) throw new Error('link must be a yb.tencent.com/s/<shareId> URL');

  let html = '';
  if (args.html) {
    html = fs.readFileSync(args.html, 'utf8');
  } else {
    const response = await fetch(args.link, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
    });
    if (!response.ok) throw new Error(`share page returned HTTP ${response.status}`);
    html = await response.text();
  }
  const payload = extractNextData(html);
  const probe = probeYuanbaoShare(payload);
  if (!probe.ok) {
    throw new Error(`share payload structure probe failed: ${(probe.warnings || []).join('; ') || 'unknown layout'}`);
  }
  const normalized = extractYuanbaoShare(payload, probe);
  if (!normalized.ok) {
    throw new Error('share payload extraction produced no question or answer text');
  }
  normalized.collected_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(normalized, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    out: path.resolve(args.out),
    counts: normalized.counts,
    structure: {
      fingerprint: probe.fingerprint,
      confidence: probe.confidence,
      known_layout: probe.known_layout,
      root_path: probe.root_path,
      warnings: probe.warnings,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
