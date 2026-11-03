#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

report_dir=$(mktemp -d)
trap 'rm -rf -- "$report_dir"' EXIT

node --check scripts/yuanbao_browser_crawl.mjs
node --check scripts/yuanbao_batch_crawl.mjs
node --check scripts/yuanbao_share_batch.mjs
node --check scripts/analyze_yuanbao_share.mjs
node --check scripts/render_yuanbao_field_maps.mjs
node --check scripts/preflight.mjs
node --check scripts/lib/opencli-command.mjs
node --check scripts/lib/yuanbao-field-map.mjs
node --check scripts/lib/yuanbao-share-structure.mjs
node --test scripts/test_yuanbao_browser_crawl.mjs
node --test scripts/test_batch_crawler_args.mjs
node --test scripts/test_yuanbao_share_structure.mjs

# python3 may be a Windows Store stub; fall back to python.
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys' >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "error: neither python3 nor python is available" >&2
  exit 1
fi

"$PYTHON" -m py_compile scripts/analyze_yuanbao_results.py scripts/test_entity_recognition.py
"$PYTHON" scripts/test_entity_recognition.py
"$PYTHON" scripts/analyze_yuanbao_results.py fixtures/sample-yuanbao-crawl.json \
  --target-entity '光引GEO' \
  --entity-type company \
  --brands '光引GEO,源易信息,PallasAI' \
  --out-dir "$report_dir"
node scripts/render_yuanbao_field_maps.mjs fixtures/sample-yuanbao-crawl.json --out-dir "$report_dir"
test -f "$report_dir/field-maps/q01-data-map.html"
test -f "$report_dir/field-maps/q02-data-map.html"
"$PYTHON" - "$report_dir" <<'PY'
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

field_maps = list((report_dir / "field-maps").glob("*-data-map.html"))
assert len(field_maps) >= 2, "per-question field maps are missing"
assert "字段地图" in field_maps[0].read_text(encoding="utf-8")
PY
