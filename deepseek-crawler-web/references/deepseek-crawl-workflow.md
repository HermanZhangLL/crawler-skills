# DeepSeek Crawl Workflow

## Local Capability Source

Bundled local crawler:

```text
scripts/geo-deepseek-browser-direct.mjs
```

This is preferred over the archived `deepseek-crawler` because it captures the DeepSeek answer, answer length, target mention count, and displayed citation links from the active DeepSeek browser DOM. With the public OpenCLI DeepSeek adapter, the separate source-panel object is not exposed directly, so the bundled crawler preserves source evidence from the `X 个网页` answer citations: citation number, domain/source, URL, inferred title, and nearby answer context. Each reference records provenance fields for observed and inferred values. Reference collection requires a valid DeepSeek conversation URL, the latest submitted prompt, and the latest assistant DOM text to match the answer returned by the current OpenCLI command. The temporary browser session is unbound after successful and failed extraction. The archived Playwright service is useful as historical evidence only; it mainly captures the final answer text.

Override the crawler path with `--crawler-script` or `DEEPSEEK_CRAWLER_SCRIPT` when the local project moves.

## Preflight

Run the skill preflight before a real crawl:

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

If the crawler script is not in the default local path:

```bash
node scripts/preflight.mjs \
  --profile <opencli-profile> \
  --crawler-script /absolute/path/to/geo-deepseek-browser-direct.mjs
```

The preflight wraps these underlying checks:

```bash
opencli --version
opencli doctor
opencli profile list
opencli deepseek whoami -f json
```

If Browser Bridge is disconnected, use this skill's DeepSeek-specific setup script:

```bash
node scripts/setup_deepseek_bridge.mjs
```

This script opens `https://chat.deepseek.com/` in a dedicated OpenCLI browser profile. Do not use the `opencli-boss-ai` bridge setup script for this skill, because that project intentionally opens BOSS Zhipin. DeepSeek web must already be logged in. The skill does not handle login, CAPTCHA, Cloudflare checks, or account recovery.

## Stage 1: Batch Crawl

Use the batch wrapper from this skill:

```bash
node scripts/deepseek_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "孟庆涛" \
  --entity-type person \
  --safe-random-delay \
  --out-dir runs/geo-deepseek-20260619
```

Input formats:

- Text: one question per line.
- JSON array of strings.
- JSON array of objects: `{"id":"q01","question":"...","repeat":5,"target":"..."}`.

Standard user inputs:

- `keywords/questions`: one or more questions.
- `repeat`: how many fresh samples per question.
- `target_entity`: the target entity to diagnose.
- `entity_type`: `person`, `company`, or `product`.

The wrapper records `target_entity`, `target_aliases`, `entity_type`, and delay strategy in `deepseek-crawl.json > input`.

The wrapper opens a fresh DeepSeek session name per sample. It writes per-sample raw JSON and logs, then writes `deepseek-crawl.json`.

## Hybrid Share Mode (Recommended For Full Structured Data)

Public share creation is enabled by default; add `--no-create-share` to disable. After each answer finishes, the crawler:

1. Binds the same browser session and verifies the latest user message matches the submitted prompt.
2. Fetches `/api/v0/chat/history_messages` to obtain message ids.
3. Calls `/api/v0/share/create` with `{chat_session_id, message_ids}` and receives a public `share_id`.
4. Pulls the public share payload from `/api/v0/share/content?share_id=...` (no auth required).
5. Probes the payload structure (see "Structure-Adaptive Extraction" below), then writes the raw sample with share-derived `answer`, `references`, `share`, `share_meta`, and `structure`; the DOM-derived references are kept under `dom_references` for audit.

```bash
node scripts/deepseek_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --entity-type company \
  --create-share \
  --store \
  --html-maps \
  --safe-random-delay \
  --out-dir runs/my-deepseek-run
```

`--store` writes `deepseek-samples.csv`, `deepseek-references.csv`, `deepseek-samples.db` (SQLite when the runtime supports `node:sqlite`; otherwise CSV only), and `share-links.xlsx` with the question-to-share-link mapping. `--html-maps` writes one field-map HTML per question under `<out-dir>/store/field-maps`; repeated samples for the same question reuse the first valid sample, so each question produces exactly one HTML.

You can also run the exporter separately on any completed dataset:

```bash
node scripts/deepseek_export_store.mjs runs/my-deepseek-run/deepseek-crawl.json \
  --out-dir runs/my-deepseek-run/store \
  --html-maps
```

## Share-Only Collection

If samples completed without a public share, repair them without re-asking:

```bash
node scripts/deepseek_repair_shares.mjs --dataset runs/my-deepseek-run/deepseek-crawl.json --profile <profile> --store --html-maps
```

If you already have share links (for example links a user shared manually), aggregate them into the same dataset without browser automation:

```bash
node scripts/deepseek_share_batch.mjs \
  --links share_links.txt \
  --target-entity "新东方" \
  --entity-type company \
  --store \
  --html-maps \
  --out-dir runs/deepseek-shares
```

Input format: one share URL or share id per line, or a JSON array. Duplicate share ids are deduplicated. Each share link becomes one sample; repeated sampling still comes from the number of independent share links you provide. Share-derived samples are marked `transport: deepseek-share-api` and keep `share_meta` so reports can separate web-fresh samples from archive samples.

## Structure-Adaptive Extraction

DeepSeek (and comparable products like Doubao) keep iterating their answer payload structure, so field paths are never hardcoded as the only extraction path. Whenever a share payload is fetched — during batch crawl, share-only aggregation, or repair — the extractor:

1. **Probes the structure first** (`scripts/lib/share-structure.mjs`): locates the message array (known DeepSeek paths are tried first as high-priority candidates, then a full payload scan), detects role/content/status/token fields by name *and* value pattern, locates the reference array, and resolves its url/title/snippet/index/date/site/domain field aliases the same way.
2. **Extracts per the probe**: pulls question, answer, and references according to the discovered fields and normalizes them into the unified schema (`answer.text`, `references.items[]` with `*_origin` provenance labels).
3. **Stores the fingerprint**: every raw sample carries a `structure` block (fingerprint, confidence `high/medium/low/none`, discovered paths and field names, warnings) so schema drift across platform versions is auditable without re-fetching.

Probe a payload interactively (read-only, writes no files):

```bash
node scripts/deepseek_share_probe.mjs --link "https://chat.deepseek.com/share/<id>"
node scripts/deepseek_share_probe.mjs --input saved-share.json
```

Use the probe when a platform redesign makes fields stop matching, or before deciding how to store a new product's payload. If no message array can be detected at all, extraction fails gracefully (`ok=false`, warnings recorded) instead of silently producing empty data.

## Run Rules

- Default to `--search` so the source panel can be captured.
- Default interval is random 60-100 seconds between fresh samples. Prefer `--safe-random-delay` (5-20 minutes) for long real runs that need a slower request rate.
- Use `--delay-min-minutes <n> --delay-max-minutes <n>` when a different random interval is needed.
- Use `--resume` to skip samples that already have valid raw JSON.
- Use `--delay-ms` only for controlled tests or trusted low-risk environments; a fixed override replaces the default 60-100 second random interval.
- Model: `--model instant` (default) / `expert` / `vision`. Use `--think` to enable deep thinking; expert and thinking modes increase answer time and cost.
- 窗口模式：默认后台 `background`，避免抢用户日常浏览器焦点；设 `DEEPSEEK_WINDOW_MODE=foreground` 或传 `--window-mode foreground` 可切回前台（batch 与单题均支持）。
- 快速完成判定（`--fast-ask`，batch/单题均支持；或 `DEEPSEEK_FAST_ASK=1`）：OpenCLI `deepseek ask` 自带的“最后消息文本连续 3 次一致”判定会因引用/页面动态内容长期不收敛，导致单题空等接近超时（实测 ~600s）。fast 模式把 ask 等待压到 30 秒触发发送，随即用 DeepSeek 官方历史接口轮询助手消息完成（状态 FINISHED 或文本 3 次稳定），再创建公开分享；单题全程压到约 30-60 秒（2026-09-09 试点 3/3，44/44/30 秒）。
- Default per-sample timeout is 600 seconds.
- Plan order defaults to `round`（轮询）：each round visits every question once, then repeats. This spreads each question's repeats across the whole run window for fairer cross-question comparison and more natural request traffic. Use `--plan-order question` to finish one question entirely before the next.
- Treat failed samples as evidence. Do not delete them from the dataset.
- If a question must be crawled 5 times, the denominator is 5 even when one sample fails; report completion and valid-sample counts separately.
- Slower random intervals reduce request frequency but do not guarantee account safety or bypass platform risk controls.

## Stage 2: Analyze And Render

```bash
python3 scripts/analyze_deepseek_results.py \
  runs/geo-deepseek-20260619/deepseek-crawl.json \
  --target-entity "孟庆涛" \
  --entity-type person \
  --brands-file brands.txt \
  --out-dir runs/geo-deepseek-20260619/report
```

The analyzer writes:

- `summary.json`: machine-readable analysis summary.
- `structured-data.md`: Markdown export of cleaned fields and data.
- `structured-data.xlsx`: Excel workbook with the same structured tables.
- `report.html`: visual diagnosis and analysis report.

Alias and competitor file format:

```text
目标实体|目标别名A|目标别名B
同类型竞品A|竞品别名A
同类型竞品B
```

Target matching uses contains logic plus aliases. For example, `--target-entity 新东方` can consolidate `新东方前途出国` and `前途出国`. Competitors are filtered to the same entity type as the target entity.

If no alias/competitor file is supplied, the analyzer infers same-type competitors from answer structure and marks lower-confidence candidates in the entity recognition table.

## Failure Handling

- `references.count = 0`: the search toggle may be off, the panel may not render, or DeepSeek DOM changed.
- `ok = false`: keep the raw file/log and include it in completion metrics.
- Repeated DOM failures: rerun one question manually with the existing crawler to inspect page state before changing this skill.
- 长样本接近单题超时（如 600s 上限附近仍 ok）属“生成慢但会完成”，不是卡死：DeepSeek 快速+联网搜索在夜间/高峰期常压线返回。104 题 ×1 实测单轮可达 14 小时以上，应作为可中断长任务管理，用 `--resume` 分段续跑，不要中途误判。
- 少量样本首跑 `answer_incomplete`/失败后，再次 `--resume` 通常可直接补成 ok（同一题重问即可），无需更换账号；仅当连片失败持续数小时才考虑冷却或换账号。
- 全量跑完后用 `deepseek_repair_shares.mjs` 兜底补齐缺 share 的样本，再用 `--store`/Excel 校验 `share_coverage`。

## Evidence Boundary

This skill analyzes what DeepSeek web displayed. It does not claim that cited source pages are correct, complete, or currently reachable. If downstream work needs external page truth, add a separate fetch-and-parse stage and label it separately.
