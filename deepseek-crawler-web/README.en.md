# DeepSeek Crawler Web

Default documentation is Simplified Chinese: [README.md](README.md) · Changelog: [CHANGELOG.md](CHANGELOG.md)

`deepseek-crawler-web` is a **DeepSeek web AI-search repeated sampling and GEO probability analysis skill**. It automates an already logged-in DeepSeek web session through the OpenCLI Browser Bridge: ask → create a public share link → structure-adaptive extraction of the link payload → unified storage → probability analysis reports.

It is not a generic website crawler and does not call the DeepSeek API.

## Core Pipeline

```text
1. Automate the app     OpenCLI drives the logged-in DeepSeek web session
                        (background window by default, never steals focus)
                        deepseek ask --new --keep-tab --site-session persistent --window background
                        DOM fingerprint check: page origin + prompt + answer SHA-256
2. Collect links        Auto-create a public share (share/create) to obtain a structured share link
3. Fetch link data      Structure-adaptive: first analyze the payload structure (message array,
                        role/content fields, reference array and its field aliases), then extract
                        according to the probe result into a unified schema. A structure
                        fingerprint is stored with every sample so platform drift stays auditable —
                        no hardcoded field paths.
4. Unified storage     deepseek-crawl.json + raw/*.json evidence + CSV/SQLite tables +
                        question→share-link Excel + field-map HTML
5. Analyze & report     Hybrid NER entity recognition + optional AI semantic review +
                        Markdown / Excel / HTML reports
```

## Technical Route

- **Web session, not API**: reuses your logged-in DeepSeek web session, capturing what users actually see — distribution differs from API-channel results.
- **OpenCLI deepseek adapter**: native `deepseek ask/status/whoami/history/login` subcommands with `--model instant|expert|vision`, `--think`, `--search`, `--window background`, `--site-session persistent`, `--keep-tab`.
- **Direct share API**: after each answer, `share/create → share/content` returns the full structured payload (answer text, references, sources, token usage, search toggles) without depending on browser tab binding.
- **Structure-adaptive link extraction**: products like DeepSeek and Doubao keep iterating their answer payload structure, so field paths are never hardcoded. The extractor first probes the structure (where the message array lives, what the role/content fields are called, which aliases the reference url/title/snippet/index/date fields use), then extracts accordingly; the known DeepSeek layout is only a high-priority candidate and a fallback. A structure fingerprint is saved with each sample.
- **Background execution**: the capture window defaults to `background`, so long batches never interrupt your browsing; switch with `--window-mode foreground` when you want to watch.
- **Evidence first**: every sample keeps the raw answer, reference titles, URLs, raw JSON, and execution logs; all probability metrics are repeated-sample estimates.

## Prerequisites

| Dependency | Version | Purpose | Check |
|---|---|---|---|
| Node.js | **21+** (18+ for offline analysis only) | Run capture and orchestration scripts | `node --version` |
| Python | **3.10+** | Aggregation analysis and report rendering | `python3 --version` |
| OpenCLI CLI | **1.8.4+** (verified 1.8.7) | Browser automation and deepseek adapter | `opencli --version` |
| OpenCLI deepseek adapter | bundled with OpenCLI; install the plugin if `opencli deepseek` is missing | `deepseek ask/status/whoami/history` | `opencli deepseek --help` |
| OpenCLI Browser Bridge | Chrome/Edge extension installed and connected | Drive the browser | `opencli doctor` |
| DeepSeek account | logged in on the web | Ask and share | `opencli deepseek whoami -f json` |
| bash | any (Git Bash / WSL on Windows) | Run `run-tests.sh` | `bash --version` |
| OPENAI_API_KEY | optional | AI semantic review during analysis; falls back to local rules without it | — |

Pre-flight checks:

```bash
node scripts/preflight.mjs --profile <opencli-profile>        # before a real crawl
node scripts/preflight.mjs --analysis-only                    # offline analysis only
```

If no profile is connected, run `node scripts/setup_deepseek_bridge.mjs` from the skill directory (it only opens `https://chat.deepseek.com/`).

## Presets and Trade-offs

Defaults optimize for **reliable collection and trustworthy data**; speed yields to stability. Adjust per the table below when you need throughput.

| Preset | Default | Trade-off | How to change |
|---|---|---|---|
| Repeats per question | `5` | More repeats = stabler probabilities, linear time cost | `--repeat <n>` (1-50) |
| Interval between samples | random `60-100 s` | Lower throttling risk; shorten for quick tests, lengthen for long runs | `--delay-min/max-minutes`; `--safe-random-delay` = 5-20 min |
| Per-question timeout | `600 s` |联网 answers often return near the 600s cap — slow, not stuck | `--timeout 30-1200` |
| Fast completion check | off | On: ~30-60s per question (ask waits only 30s, then polls the history API), at the cost of relying on the history endpoint | `--fast-ask` or `DEEPSEEK_FAST_ASK=1` |
| Plan order | `round` | One sample per question each round — even time distribution, robust to platform jitter | `--plan-order question` |
| Share links | on | Most reliable path to structured references; off means DOM-only extraction (unreliable) | `--no-create-share` |
| Window mode | `background` | Never steals focus during batches | `--window-mode foreground` |
| Model mode | `instant` | `expert` is slower/steadier; `vision` reads images | `--model instant\|expert\|vision`; `--think` for deep thinking |
| Output dir naming | `YYYYMMDD_<entity>_deepseek_web` | appends `_fast` / `_think` per mode | `--out-dir` is authoritative |
| Store / field maps | off | Extra export time | `--store`, `--html-maps` |
| AI semantic review | `auto` | uses the key when present, falls back to local rules | `--semantic-review required` for formal delivery |
| Share batch concurrency | `4` | pure API pulls; can be raised | `--concurrency 1-20` |
| Repair history scan | `200` | backfills shares without re-asking | `--history-limit <n>` |

## Quick Start

### 1. Create `questions.txt` (one question per line)

```text
新能源汽车推荐
豪华新能源SUV品牌推荐
哪个新能源电车品牌更靠谱
推荐一款靠谱的新能源汽车品牌
```

### 2. Pre-flight

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

### 3. Stage 1 — batch sampling

```bash
node scripts/deepseek_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "蔚来" \
  --target-aliases "蔚来ES8,蔚来ES6,蔚来EC6,NIO" \
  --entity-type product \
  --safe-random-delay \
  --out-dir runs/nio-nev
```

Add `--dry-run` to write the plan without opening DeepSeek. Outputs: `deepseek-crawl.json`, `raw/*.json` (each carries `share`, `share_meta`, and the `structure` fingerprint), `logs/*.log`.

### 4. Stage 2 — analysis and report

```bash
python3 scripts/analyze_deepseek_results.py \
  runs/nio-nev/deepseek-crawl.json \
  --target-entity "蔚来" \
  --target-aliases "蔚来ES8,蔚来ES6,蔚来EC6,NIO" \
  --entity-type product \
  --brands-file brands.txt \
  --semantic-review auto \
  --out-dir runs/nio-nev/report
```

`brands.txt` calibrates competitor scope (`entity|aliasA|aliasB`). Standard reports require `--target-entity` and `--entity-type` (`person`, `company`, `product`).

Outputs: `summary.json`, `structured-data.md`, `structured-data.xlsx`, `report.html`, plus `semantic-review-cache.json` when produced.

## Share-Link Data Collection (Structure-Adaptive)

**A — collected automatically**: `--create-share` is on by default; every answer creates a share and pulls the structured payload.

**B — you already have share links**:

```bash
node scripts/deepseek_share_batch.mjs \
  --links share_links.txt \
  --target-entity "新东方" \
  --entity-type company \
  --store --html-maps \
  --out-dir runs/deepseek-shares
```

**C — probe the link data structure first** (platform redesign, mismatched fields, or just inspecting):

```bash
node scripts/deepseek_share_probe.mjs --link "https://chat.deepseek.com/share/<id>"
node scripts/deepseek_share_probe.mjs --input saved-share.json     # offline
```

The probe reports the message-array path, role/content/status fields, reference-array location, per-field alias hits, structure fingerprint and confidence, plus a unified-schema preview. The `structure` block is persisted with every sample for cross-version drift audits.

**D — backfill missing shares** (no re-asking; matches existing conversations by question/answer):

```bash
node scripts/deepseek_repair_shares.mjs \
  --dataset runs/my-deepseek-run/deepseek-crawl.json \
  --profile <opencli-profile> --store --html-maps
```

Share-sample boundaries: no exact model version, no true generation time, no search sub-query text; `inserted_at` is closer to share-export time. Prefer live web samples for formal probability reports.

## Offline Verification

```bash
bash scripts/run-tests.sh
```

Covers syntax checks for every script, argument parsing and DOM-fingerprint regressions, share parsing and structure-probe tests, traditional→simplified conversion tests, entity-recognition regressions, and an end-to-end fixture analysis assertion.

## Boundaries

- Does not handle login, CAPTCHA, Cloudflare, bot checks, account risk controls, or platform-limit bypasses.
- Probability metrics are repeated-sample estimates, not market share or official platform rankings.
- Competitor recognition prefers user-supplied alias tables; review auto-detected candidates and use `--semantic-review required` for formal delivery.
- AI semantic review is an optional enhancement; it never overrides hard rules, answer-body evidence, or raw-log audit.
- Real capture drives a browser against the DeepSeek website — follow the site's rules and your account limits.

## Package Layout

```text
SKILL.md                        routing trigger and workflow skeleton
README.md / README.en.md        this document / English mirror
CHANGELOG.md                    version history
manifest.json                   metadata (version, dependencies, output contract)
agents/interface.yaml           interface declaration
evals/                          trigger cases and expected artifacts
references/
  user-setup-and-usage.md       install prerequisites and user manual
  deepseek-crawl-workflow.md    capture config, delays, resume, repair rules
  report-contract.md            JSON contract and metric definitions
scripts/
  preflight.mjs                 dependency and login checks
  setup_deepseek_bridge.mjs     DeepSeek-only Browser Bridge helper
  geo-deepseek-browser-direct.mjs   single-question ask + reference evidence entry
  deepseek_batch_crawl.mjs      repeated sampling orchestrator
  deepseek_share_batch.mjs      share-link batch aggregation
  deepseek_share_probe.mjs      share payload structure probe (structure-adaptive)
  deepseek_repair_shares.mjs    missing-share backfill
  deepseek_export_store.mjs     CSV/SQLite/field-map export
  analyze_deepseek_results.py   aggregation analysis and HTML rendering
  lib/share-structure.mjs       structure probing and adaptive extraction
  lib/share-utils.mjs etc.      share parsing, table writing, HTML rendering helpers
  test_*.mjs / test_*.py        regression tests
  run-tests.sh                  offline verification entry
templates/                      pre-collection questionnaire and brief templates
fixtures/                       offline test sample data
```

## See Also

- [references/user-setup-and-usage.md](references/user-setup-and-usage.md) — install, troubleshooting, evidence and privacy
- [references/deepseek-crawl-workflow.md](references/deepseek-crawl-workflow.md) — capture rules, delays, resume, hybrid share mode
- [references/report-contract.md](references/report-contract.md) — data JSON contract and metric definitions
