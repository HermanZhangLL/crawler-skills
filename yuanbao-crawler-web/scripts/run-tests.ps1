$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$reportDir = Join-Path ([System.IO.Path]::GetTempPath()) ("yuanbao-report-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null

try {
  node --check "scripts\yuanbao_browser_crawl.mjs"
  node --check "scripts\yuanbao_batch_crawl.mjs"
  node --check "scripts\yuanbao_share_batch.mjs"
  node --check "scripts\analyze_yuanbao_share.mjs"
  node --check "scripts\render_yuanbao_field_maps.mjs"
  node --check "scripts\preflight.mjs"
  node --check "scripts\lib\opencli-command.mjs"
  node --check "scripts\lib\yuanbao-field-map.mjs"
  node --test "scripts\test_yuanbao_browser_crawl.mjs"
  node --test "scripts\test_batch_crawler_args.mjs"
  node --test "scripts\test_yuanbao_export_store.mjs"
  python -m py_compile "scripts\analyze_yuanbao_results.py" "scripts\test_entity_recognition.py"
  python "scripts\test_entity_recognition.py"
  node "scripts\render_yuanbao_field_maps.mjs" "fixtures\sample-yuanbao-crawl.json" --out-dir $reportDir
  if (-not (Test-Path -LiteralPath (Join-Path $reportDir "field-maps\q01-data-map.html"))) { throw "field map q01 missing" }
  if (-not (Test-Path -LiteralPath (Join-Path $reportDir "field-maps\q02-data-map.html"))) { throw "field map q02 missing" }
  python "scripts\analyze_yuanbao_results.py" "fixtures\sample-yuanbao-crawl.json" `
    --target-entity "光引GEO" `
    --entity-type company `
    --brands "光引GEO,源易信息,PallasAI" `
    --out-dir $reportDir
  $checkScript = @"
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
assert "## " in structured_markdown
assert "title_origin" in structured_markdown

field_maps = list((report_dir / "field-maps").glob("*-data-map.html"))
assert len(field_maps) >= 2, "per-question field maps are missing"
assert "字段地图" in field_maps[0].read_text(encoding="utf-8")
"@
  $checkPath = Join-Path $reportDir "check-report.py"
  Set-Content -LiteralPath $checkPath -Value $checkScript -Encoding UTF8
  python $checkPath $reportDir
} finally {
  if (Test-Path -LiteralPath $reportDir) {
    [System.IO.Directory]::Delete($reportDir, $true)
  }
}
