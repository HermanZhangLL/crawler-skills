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

node --check scripts/preflight.mjs
node --check scripts/qianwen_single.mjs
node --check scripts/qianwen_batch_crawl.mjs
node --check scripts/qianwen_move_to_group.mjs
node --check scripts/qianwen_enumerate_group.mjs
node --check scripts/qianwen_validate_links.mjs
node --check scripts/lib/opencli-command.mjs
"$PYTHON" -m py_compile scripts/qianwen_build_links_table.py

# Dry-run: batch orchestrator must write a valid plan without touching the browser.
tmpdir=$(mktemp -d)
trap 'rm -rf -- "$tmpdir"' EXIT
cat > "$tmpdir/questions.json" <<'JSON'
[
  {"question": "测试问题一", "index": 1, "levelName": "L1", "intent": "intent_a"},
  {"question": "测试问题二", "index": 2, "levelName": "L1", "intent": "intent_b"}
]
JSON
node scripts/qianwen_batch_crawl.mjs \
  --questions "$tmpdir/questions.json" \
  --repeat 1 \
  --dry-run \
  --out-dir "$tmpdir/run" >/dev/null
test -f "$tmpdir/run/qianwen-crawl.json" || { echo "dry-run dataset missing" >&2; exit 1; }
"$PYTHON" - "$tmpdir/run/qianwen-crawl.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data.get("schema_version", "") == "qianwen-crawler-web/v1", data.get("schema_version")
assert len(data.get("samples", [])) == 2, len(data.get("samples", []))
assert all(s.get("status") == "planned" for s in data["samples"]), data["samples"]
print("dry-run plan OK: schema=%s samples=%d" % (data["schema_version"], len(data["samples"])))
PY

echo "qianwen-crawler-web tests passed"
