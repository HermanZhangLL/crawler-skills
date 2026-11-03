#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fetchShareContent, shareIdFromUrl, SHARE_PAGE_URL } from './lib/share-utils.mjs';
import { probeShareStructure, extractSharePayload } from './lib/share-structure.mjs';

function printHelp() {
  console.log(`Usage:
  node scripts/deepseek_share_probe.mjs --link <share-url|share-id> [options]
  node scripts/deepseek_share_probe.mjs --input <share.json> [options]

Probe the data structure of a DeepSeek share payload BEFORE deciding how to
extract and store it. Prints the discovered structure (message array path,
role/content/status fields, reference array and field aliases), a structure
fingerprint, a confidence level, and a unified-schema extraction preview.

This command never writes files; it is a read-only inspection tool.

Options:
  --link <value>       Public share URL or share id (fetched via share API).
  --input <file>       Local share JSON file (offline, no network).
  --json               Print machine-readable JSON only.
  -h, --help           Show help.
`);
}

function parseArgs(argv) {
  const args = { link: '', input: '', json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--link') args.link = argv[++i] || '';
    else if (arg === '--input') args.input = argv[++i] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function truncate(text, max = 240) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.link && !args.input)) {
    printHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }
  if (args.link && args.input) throw new Error('Use only one of --link or --input');

  let payload = null;
  let source = '';
  let shareId = '';
  if (args.input) {
    const file = path.resolve(args.input);
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    source = file;
  } else {
    shareId = shareIdFromUrl(args.link) || '';
    if (!shareId) throw new Error(`Not a valid share URL or id: ${args.link}`);
    payload = await fetchShareContent(shareId);
    source = `${SHARE_PAGE_URL}/${shareId}`;
  }

  const probe = probeShareStructure(payload);
  const extracted = extractSharePayload(payload, probe, { share_id: shareId });

  const report = {
    ok: probe.ok,
    source,
    share_id: shareId,
    structure: probe,
    extraction_preview: {
      ok: extracted.ok,
      complete: extracted.complete,
      question: truncate(extracted.question, 160),
      answer_preview: truncate(extracted.answer_text, 300),
      answer_length: extracted.answer_text.length,
      reference_count: extracted.references.length,
      references_preview: extracted.references.slice(0, 3).map((ref) => ({
        number: ref.number,
        source: ref.source,
        domain: ref.domain,
        title: truncate(ref.title, 80),
        url: ref.url,
        date: ref.date,
      })),
      share_meta: extracted.share_meta,
    },
    warnings: probe.warnings || [],
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!probe.ok) {
    console.error(`Structure probe failed: ${(probe.warnings || []).join('; ') || 'unknown payload layout'}`);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  const f = (probe.reference_field ? probe.reference_item_fields : probe.fragments?.reference_item_fields) || {};
  const effectiveRef = probe.reference_field
    || (probe.fragments?.reference_field ? `${probe.fragments.field}[].${probe.fragments.reference_field}` : '');
  console.log(`Structure probe: ${source}`);
  console.log(`  confidence        : ${probe.confidence}${probe.known_layout ? ' (known DeepSeek layout)' : ' (discovered layout)'}`);
  console.log(`  fingerprint       : ${probe.fingerprint}`);
  console.log(`  messages          : ${probe.messages_path} (${probe.message_count} messages)`);
  console.log(`  role/content field: ${probe.role_field || '(none)'} / ${probe.content_field || (probe.fragments ? `${probe.fragments.field}[].${probe.fragments.content_field} (fragment layout)` : '(none)')}`);
  if (probe.fragments) {
    const buckets = probe.fragments.type_buckets || {};
    const fmt = (list) => (list && list.length ? list.join('|') : '-');
    console.log(`  fragments         : ${probe.fragments.field}[] type=${probe.fragments.type_field} content=${probe.fragments.content_field}`);
    console.log(`  fragment types    : request=${fmt(buckets.request)} response=${fmt(buckets.response)} search=${fmt(buckets.search)} other=${fmt(buckets.other)}`);
  }
  console.log(`  status fields     : status=${probe.status_field || '-'} incomplete=${probe.incomplete_field || '-'} token=${probe.token_field || '-'}`);
  console.log(`  references        : ${effectiveRef || '(none detected)'}`);
  if (effectiveRef) {
    console.log(`  reference fields  : url=${f.url || '-'} title=${f.title || '-'} snippet=${f.snippet || '-'} number=${f.number || '-'} date=${f.date || '-'} site=${f.site || '-'} domain=${f.domain || '-'}`);
  }
  console.log(`  conversation      : title=${probe.conversation?.title || '-'} model_type=${probe.conversation?.model_type || '-'}`);
  if ((probe.warnings || []).length) {
    console.log(`  warnings          : ${probe.warnings.join('; ')}`);
  }
  console.log('');
  console.log('Unified schema preview:');
  console.log(`  ok/complete       : ${extracted.ok} / ${extracted.complete}`);
  console.log(`  question          : ${truncate(extracted.question, 160)}`);
  console.log(`  answer            : ${extracted.answer_text.length} chars`);
  console.log(`  references        : ${extracted.references.length}`);
  for (const ref of extracted.references.slice(0, 3)) {
    console.log(`    [${ref.number ?? '-'}] ${truncate(ref.title, 70)} -> ${ref.domain || ref.url}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
