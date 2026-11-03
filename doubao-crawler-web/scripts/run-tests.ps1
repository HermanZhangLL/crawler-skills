# Windows native test entry for doubao-crawler-web.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

node --check scripts/doubao_batch_crawl.mjs
node --check scripts/doubao_browser_crawl.mjs
node --check scripts/parse_doubao_thread.mjs
node --check scripts/render_field_maps.mjs
node --check scripts/lib/share-links-excel.mjs
node --test scripts/test_doubao_browser_crawl.mjs
node --test scripts/test_parse_doubao_thread.mjs
node --test scripts/test_render_field_maps.mjs
node --test scripts/test_share_links_excel.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$python = 'python3'
if (Get-Command $python -ErrorAction SilentlyContinue) {
  & $python --version *> $null
  if ($LASTEXITCODE -ne 0) { $python = 'python' }
} else {
  $python = 'python'
}

& $python -m py_compile `
  scripts/analyze_doubao_results.py `
  scripts/analyze_geo_baseline.py `
  scripts/doubao_mobile_crawl.py `
  scripts/doubao_share_links_excel.py `
  scripts/redact_run.py `
  scripts/test_entity_recognition.py `
  scripts/test_mobile_extraction.py `
  scripts/test_analysis_fields.py `
  scripts/test_redact_run.py `
  scripts/test_geo_baseline.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $python scripts/test_entity_recognition.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/test_mobile_extraction.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/test_analysis_fields.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/test_redact_run.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/test_geo_baseline.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$report = Join-Path $env:TEMP 'doubao-crawler-web-single-report'
& $python scripts/analyze_doubao_results.py fixtures/sample-doubao-crawl.json `
  --target-entity "光引GEO" --entity-type company --brands "光引GEO,源易信息,PallasAI" `
  --out-dir $report
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/analyze_doubao_results.py fixtures/sample-doubao-mobile-crawl.json `
  --target-entity "光引GEO" --entity-type company --brands "光引GEO,源易信息,PallasAI" `
  --out-dir "$report-mobile"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/analyze_doubao_results.py fixtures/sample-doubao-thread-crawl.json `
  --out-dir "$report-thread"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $python scripts/analyze_geo_baseline.py fixtures/sample-doubao-thread-crawl.json `
  --target-entity "东湖尚品·云境苑" --entity-type product `
  --out-dir (Join-Path $env:TEMP 'doubao-web-geo-baseline-report')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'run-tests.ps1: PASS'
