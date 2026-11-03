#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# python3 may be a Windows Store stub; fall back to python (same as other crawler skills).
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "error: neither python3 nor python is available" >&2
  exit 1
fi

node --check scripts/doubao_batch_crawl.mjs
node --check scripts/doubao_browser_crawl.mjs
node --check scripts/parse_doubao_thread.mjs
node --check scripts/render_field_maps.mjs
node --check scripts/lib/share-links-excel.mjs
node --test scripts/test_doubao_browser_crawl.mjs
node --test scripts/test_parse_doubao_thread.mjs
node --test scripts/test_render_field_maps.mjs
node --test scripts/test_share_links_excel.mjs
"$PYTHON" -m py_compile \
  scripts/analyze_doubao_results.py \
  scripts/analyze_geo_baseline.py \
  scripts/doubao_mobile_crawl.py \
  scripts/doubao_share_links_excel.py \
  scripts/redact_run.py \
  scripts/test_entity_recognition.py \
  scripts/test_mobile_extraction.py \
  scripts/test_analysis_fields.py \
  scripts/test_redact_run.py \
  scripts/test_geo_baseline.py
"$PYTHON" scripts/test_entity_recognition.py
"$PYTHON" scripts/test_mobile_extraction.py
"$PYTHON" scripts/test_analysis_fields.py
"$PYTHON" scripts/test_redact_run.py
"$PYTHON" scripts/test_geo_baseline.py
"$PYTHON" scripts/analyze_doubao_results.py fixtures/sample-doubao-crawl.json \
  --target-entity "光引GEO" \
  --entity-type company \
  --brands "光引GEO,源易信息,PallasAI" \
  --out-dir /tmp/doubao-crawler-web-single-report
"$PYTHON" scripts/analyze_doubao_results.py fixtures/sample-doubao-mobile-crawl.json \
  --target-entity "光引GEO" \
  --entity-type company \
  --brands "光引GEO,源易信息,PallasAI" \
  --out-dir /tmp/doubao-web-mobile-crawler-report
"$PYTHON" scripts/analyze_doubao_results.py fixtures/sample-doubao-thread-crawl.json \
  --out-dir /tmp/doubao-web-thread-crawler-report
"$PYTHON" scripts/analyze_geo_baseline.py fixtures/sample-doubao-thread-crawl.json \
  --target-entity "东湖尚品·云境苑" --entity-type product \
  --out-dir /tmp/doubao-web-geo-baseline-report
