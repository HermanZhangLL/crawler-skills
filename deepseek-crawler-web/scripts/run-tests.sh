#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

deepseek_report_dir=$(mktemp -d)
trap 'rm -rf -- "$deepseek_report_dir"' EXIT

# python3 may be a Windows Store stub; fall back to python (same as preflight.mjs).
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "error: neither python3 nor python is available" >&2
  exit 1
fi

node --check scripts/geo-deepseek-browser-direct.mjs
node --check scripts/deepseek_batch_crawl.mjs
node --check scripts/preflight.mjs
node --test scripts/test_geo_deepseek_browser_direct.mjs
node --check scripts/deepseek_share_batch.mjs
node --check scripts/deepseek_repair_shares.mjs
node --check scripts/setup_deepseek_bridge.mjs
node --check scripts/lib/opencli-command.mjs
node --check scripts/lib/share-links-excel.mjs
node --check scripts/deepseek_export_store.mjs
node --check scripts/deepseek_share_probe.mjs
node --check scripts/lib/share-utils.mjs
node --check scripts/lib/share-structure.mjs
node --check scripts/lib/store-writer.mjs
node --check scripts/lib/field-map-render.mjs
node --test scripts/test_share_utils.mjs
node --test scripts/test_share_structure.mjs
node --test scripts/test_batch_crawler_args.mjs
node --test scripts/test_share_links_excel.mjs
"$PYTHON" -m py_compile scripts/analyze_deepseek_results.py scripts/test_entity_recognition.py
"$PYTHON" scripts/test_entity_recognition.py
"$PYTHON" scripts/analyze_deepseek_results.py fixtures/sample-deepseek-crawl.json \
  --target-entity '光引GEO' \
  --entity-type company \
  --brands '光引GEO,源易信息,PallasAI' \
  --out-dir "$deepseek_report_dir"
"$PYTHON" - "$deepseek_report_dir" <<'PY'
import json
import sys
from pathlib import Path

report_dir = Path(sys.argv[1])
summary = json.loads((report_dir / "summary.json").read_text(encoding="utf-8"))
reference_rows = summary["sources"]["reference_rows"]
assert reference_rows, "structured reference rows are missing"
assert {"source_origin", "title_origin", "summary_origin"}.issubset(reference_rows[0])
assert "provenance_counts" in summary["sources"]
assert "excluded_url_derived" in summary["titles"]

structured_markdown = (report_dir / "structured-data.md").read_text(encoding="utf-8")
assert "## 信源字段来源" in structured_markdown
assert "## 信源明细" in structured_markdown
assert "title_origin" in structured_markdown
PY


