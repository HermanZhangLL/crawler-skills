import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(file, columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvCell(row[col])).join(','));
  }
  fs.writeFileSync(file, `\uFEFF${lines.join('\r\n')}\n`, 'utf8');
}

export function sampleRow(sample, dataset) {
  const result = sample.result || {};
  const answer = String((result.answer || {}).text || '');
  const refs = Array.isArray((result.references || {}).items) ? result.references.items : [];
  const domains = new Set(refs.map((r) => String(r.domain || '')).filter(Boolean));
  const share = result.share || {};
  const chat = share.chat || result.conversation || {};
  const shareOk = share.created;
  return {
    sample_id: String(sample.sample_id || ''),
    question_id: String(sample.question_id || ''),
    question: String(sample.question || result.question || ''),
    repeat_index: sample.repeat_index ?? '',
    ok: sample.ok ? 1 : 0,
    status: String(sample.status || ''),
    transport: String(result.transport || dataset.run?.transport || ''),
    collected_at: String(result.collected_at || sample.finished_at || ''),
    share_id: String(share.share_id || ''),
    share_url: String(share.url || ''),
    share_ok: shareOk == null ? '' : (shareOk ? 1 : 0),
    model_type: String(chat.chat_model_id || chat.model || result.model || ''),
    search_enabled: result.search == null ? '' : (result.search ? 1 : 0),
    thinking_enabled: result.think == null ? '' : (result.think ? 1 : 0),
    search_status: String(result.search_status || ''),
    token_usage: '',
    answer_chars: answer.length,
    answer_text: answer,
    reference_count: refs.length,
    unique_domains: domains.size,
  };
}

export function referenceRow(sample, ref) {
  return {
    sample_id: String(sample.sample_id || ''),
    number: ref.number ?? '',
    source: String(ref.source || ''),
    domain: String(ref.domain || ''),
    title: String(ref.title || ''),
    date: String(ref.date || ''),
    url: String(ref.url || ''),
    summary: String(ref.summary || ''),
  };
}

export function exportDatasetStore(dataset, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const samples = Array.isArray(dataset.samples) ? dataset.samples : [];
  const sampleColumns = [
    'sample_id', 'question_id', 'question', 'repeat_index', 'ok', 'status', 'transport',
    'collected_at', 'share_id', 'share_url', 'share_ok', 'model_type', 'search_enabled', 'thinking_enabled',
    'search_status', 'token_usage', 'answer_chars', 'answer_text', 'reference_count', 'unique_domains',
  ];
  const referenceColumns = ['sample_id', 'number', 'source', 'domain', 'title', 'date', 'url', 'summary'];
  const sampleRows = [];
  const referenceRows = [];
  for (const sample of samples) {
    sampleRows.push(sampleRow(sample, dataset));
    const refs = Array.isArray(sample.result?.references?.items) ? sample.result.references.items : [];
    for (const ref of refs) referenceRows.push(referenceRow(sample, ref));
  }
  const samplesCsv = path.join(outDir, 'yuanbao-samples.csv');
  const referencesCsv = path.join(outDir, 'yuanbao-references.csv');
  writeCsv(samplesCsv, sampleColumns, sampleRows);
  writeCsv(referencesCsv, referenceColumns, referenceRows);

  const result = {
    samples_csv: samplesCsv,
    references_csv: referencesCsv,
    db_path: '',
    sqlite: false,
  };

  if (options.sqlite !== false) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const dbPath = path.join(outDir, 'yuanbao-samples.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS samples (
          sample_id TEXT PRIMARY KEY,
          question_id TEXT, question TEXT, repeat_index INTEGER, ok INTEGER, status TEXT,
          transport TEXT, collected_at TEXT, share_id TEXT, share_url TEXT, share_ok INTEGER, model_type TEXT,
          search_enabled INTEGER, thinking_enabled INTEGER, search_status TEXT, token_usage INTEGER,
          answer_chars INTEGER, answer_text TEXT, reference_count INTEGER, unique_domains INTEGER
        );
        CREATE TABLE IF NOT EXISTS "references" (
          sample_id TEXT, number INTEGER, source TEXT, domain TEXT, title TEXT, date TEXT, url TEXT, summary TEXT
        );
      `);
      const insertSample = db.prepare(`
        INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      const insertReference = db.prepare(`
        INSERT OR REPLACE INTO "references" VALUES (?,?,?,?,?,?,?,?)
      `);
      for (const row of sampleRows) {
        insertSample.run(
          row.sample_id, row.question_id, row.question, row.repeat_index, row.ok, row.status,
          row.transport, row.collected_at, row.share_id, row.share_url, row.share_ok, row.model_type,
          row.search_enabled, row.thinking_enabled, row.search_status, row.token_usage,
          row.answer_chars, row.answer_text, row.reference_count, row.unique_domains,
        );
      }
      for (const row of referenceRows) {
        insertReference.run(
          row.sample_id, row.number, row.source, row.domain, row.title, row.date, row.url, row.summary,
        );
      }
      db.close();
      result.db_path = dbPath;
      result.sqlite = true;
    } catch (error) {
      result.sqlite_error = error.message;
    }
  }
  return result;
}
