---
name: deepseek-crawler-web
description: "Use when a user provides DeepSeek web AI-search keywords, repeat count, target entity, and entity type, then needs repeated fresh-window crawls aggregated into JSON plus a Kami HTML GEO report. Not for generic website crawling, DeepSeek API chat, SEO writing, or one-off answer generation."
---

# DeepSeek Crawler Web

## Inputs

Standard inputs: keywords/questions, repeat count, target entity, entity type (`人/person`, `公司/company`, `产品/product`), browser profile, and optional output directory. Competitors must match the target type. Reports default to Simplified Chinese with an English summary toggle.

Browser window mode is configurable so crawl automation does not steal focus from the user's daily browsing: default is `background` (set `DEEPSEEK_WINDOW_MODE=foreground`, or pass `--window-mode foreground|background` on the batch, single crawler, or share-repair script to override).

For fast collection, pass `--fast-ask` (or set `DEEPSEEK_FAST_ASK=1`): the crawler asks with a short timeout, then polls the DeepSeek history API until the assistant answer finishes before creating the public share, avoiding the OpenCLI adapter's long text-stability wait (typical per-question ~30-60s instead of up to 600s).

Share-payload extraction is structure-adaptive: after a share link is obtained, the payload structure is probed first (message array path, role/content/status fields, reference array and its url/title/snippet/index/date/site field aliases), then fields are extracted per the probe into the unified schema. Every sample stores a `structure` fingerprint so platform schema drift stays auditable; field paths are never hardcoded. Use `node scripts/deepseek_share_probe.mjs --link <url>` (or `--input <file>`) to inspect a payload's structure offline before deciding how to store it.

## Pre-collection Confirmation

Before starting a real run, ask the user for these inputs and fall back to defaults when they do not answer:

1. 问题/关键词集：无默认，必填；缺失时先请用户提供 `questions.txt` 或 JSON 数组。
2. 每个问题提问次数：默认 `5`。
3. 目标实体、实体类型和竞品/别名表：无默认；实体类型为 `人/person`、`公司/company`、`产品/product`，别名表格式 `实体|别名A|别名B`。
4. 每个问题之间的采集间隔：默认随机 `60-100 秒`；可选 `--safe-random-delay`（5-20 分钟）或自定义。
5. 模式：快速模式 `instant`（默认）、专家模式 `expert`、Vision 模式 `vision`；深度思考用 `--think` 开启。
6. 是否生成字段地图 HTML：默认不生成（`--html-maps`）；同一问题无论重复提问多少次，只生成一份，取该问题第一个有效样本。
7. 本次测评的文件夹命名和存储位置：默认用 `YYYYMMDD_<实体>_deepseek_web` 命名（快速模式追加 `_fast`，深度思考追加 `_think`），默认存放到用户指定的测评归档目录；最终以 `--out-dir` 为准。

同时确认是否启用 `--create-share`（会生成公开分享链接）、`--store`（CSV/SQLite 数据表）。问题模板见 `templates/pre-collection-questionnaire.md`。

## Workflow

1. Read `references/user-setup-and-usage.md` for install, prerequisites, and user-facing steps.
2. Read `references/deepseek-crawl-workflow.md` for crawler setup, preflight, delay, resume, and batch rules.
3. Read `references/report-contract.md` for JSON schema, metrics, target/competitor recognition, and report rules.
4. Run `node scripts/preflight.mjs --profile <profile>` before fresh crawling.
5. Stage 1: run `scripts/deepseek_batch_crawl.mjs` with questions, repeat, profile, target entity/type, and output dir. Default delay is random 60-100 seconds; `--safe-random-delay` switches to 5-20 minutes. Plan order defaults to `round`（轮询）：第 1 轮所有问题各采样 1 次，第 2 轮再全部采样，依次类推；需要按“先问完一个问题的全部次数再问下一个”时用 `--plan-order question`。
   - Public share creation is enabled by default (`--create-share`); use `--no-create-share` to disable. After each answer it creates a public share and pulls the full structured share payload via the share API. The raw sample keeps DOM references under `dom_references` for audit and prefers share references for analysis.
   - Add `--store` to export CSV and SQLite tables (`deepseek-samples.csv`, `deepseek-references.csv`, `deepseek-samples.db`) under `<out-dir>/store`, plus `share-links.xlsx`（问题→分享链接明细 + 按问题汇总）.
   - Add `--html-maps` to generate one field-map HTML per question under `<out-dir>/store/field-maps` (implies `--store`); repeated samples for the same question reuse the first valid sample.
   - Share-only collection: run `scripts/deepseek_share_batch.mjs --links share_links.txt --out-dir runs/shares [--store] [--html-maps]` to aggregate existing public share links into the same `deepseek-crawl.json` schema. Extraction is structure-adaptive (see above); a `structure` fingerprint is stored per sample.
   - Inspect a payload's structure before deciding storage: run `scripts/deepseek_share_probe.mjs --link <share-url>` or `--input <file>`; it prints the discovered fields, fingerprint, confidence, and a unified-schema preview without writing files.
   - Repair missing share data without re-asking: run `scripts/deepseek_repair_shares.mjs --dataset <deepseek-crawl.json> --profile <name> --store --html-maps`. It matches existing conversations by question/answer and creates the missing public shares (background window by default).
6. Stage 2: run `scripts/analyze_deepseek_results.py` on any crawl JSON with target entity/type, optional brands file, report output dir, and semantic review mode. Use `--semantic-review auto` by default; use `--semantic-review required` for formal delivery when AI review must pass.
7. Return the raw crawl JSON, structured Markdown, structured Excel workbook, HTML report, summary JSON, semantic-review cache when present, and failed logs. Reports include AI semantic labels for entity recognition, target-vs-best-3 radar, click-to-reveal bubbles, Chinese source names, clickable citations, title intent, compact treemap, and GEO actions.

## Honest Boundaries

- Do not use for generic website crawling, DeepSeek API chat, SEO copywriting, or one-off answer generation.
- Reuses local DeepSeek web automation; does not bypass login, CAPTCHA, bot checks, or hidden data.
- Share-created samples inherit the share metadata boundaries: `model` is not exposed, `inserted_at` is closer to share export time than generation time, and search sub-query text is not included. Treat share-derived data as archive samples and keep the share URL for audit.
- Probability metrics are repeated-sample estimates, not ground truth.
- Inferred competitors are heuristic unless `--semantic-review required` passes. AI semantic review is an audit enhancement and never replaces hard-rule gates or answer-body evidence.
- Review aliases, semantic labels, excluded candidates, and competitor tables before external use.
- Preserve raw answers, reference titles, URLs, and logs.
