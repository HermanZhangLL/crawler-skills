---
name: doubao-crawler-web
description: "Use when a user needs repeated Doubao AI-search collection from web or Android Appium into compatible JSON plus Markdown/Excel/HTML GEO reports. Requires keywords/questions; repeat count and target entity/type are confirmed before each run with defaults. Not for generic scraping, Doubao API chat, hidden API extraction, SEO writing, high-frequency automation, or one-off answers."
---

# doubao-crawler-web

## Inputs

Collect with keywords/questions, repeat count, backend (`web` or `mobile`), connection fields, and output dir. Web can also collect existing Doubao thread share links (`--thread-urls` or `--thread-url`). Optionally place each fresh conversation into a Doubao 项目 (`--project <名称>` or `DOUBAO_PROJECT`), mirroring Yuanbao's 分组 placement. Add target entity + entity type for standard diagnosis. Without a target, generate exploratory output and label inferred candidates as heuristic.

Each collected thread share link is parsed into a structured record: question/answer text, brief, timing, completion signals, references (numbered + full citation cards with cited flags), search blocks, suggested questions, normalized message list, share info, and extraction stats. The link-only成果表 records question → link(s) (duplicates kept as extra rows); the parsed content stays in per-sample raw JSON for the analysis stage. See `references/doubao-crawl-workflow.md` → “分享链接可提取信息（信息采集要求）” for the full field catalog.

Browser window mode is configurable so crawl automation no longer steals focus from the user's daily browsing. Default is `background` (set `DOUBAO_WINDOW_MODE=foreground`, or pass `--window-mode foreground|background` to override). For a fully isolated setup, run the crawl against a dedicated automation browser profile (a separate Chrome `--user-data-dir` with the OpenCLI Browser Bridge extension), not the user's daily profile — see `references/doubao-crawl-workflow.md` → “窗口模式与独立采集 profile”.

Before each web run, follow `references/pre-run-confirmation.md` and confirm all 11 items with the user: question set, per-question repeat count, target entity/entity type/competitor alias table, inter-question delay, answer mode, whether to place conversations into a Doubao 项目 (project name), whether to create public share links, whether to export tables and the question->share-link Excel, whether to generate field maps, which browser profile to use, and the output directory. Unanswered items use defaults:

- repeat: 1
- inter-question delay: random 60-100 seconds
- answer mode: quick (`快速`)
- create public thread share: on
- export CSVs + `share-links.xlsx`: on
- field maps: on
- browser profile: current logged-in profile
- output dir: auto `runs/<timestamp>`, with `-vN` versioning instead of overwrite
- project: none by default; set `--project <名称>` or `DOUBAO_PROJECT` to move each fresh conversation into a Doubao 项目 after capture

Web default flow is browser-driven questioning (`--completion-mode browser`): send the prompt, poll the page until the answer is stable, capture the thread share link, then parse the public snapshot. Completion polling uses `--completion-timeout` (default 600s), `--poll-interval-seconds` (default 8s), and `--stable-reads` (default 2). With public share creation enabled, a sample is successful only when the thread link exists and the public snapshot parses; `thread_link_failed` / `thread_parse_failed` samples are marked `ok=false` and can be retried with `--retry`, `--resume`, or `--repair-shares`. Web runs write `question-links.csv`, `full-sample-data.csv`, `share-links.xlsx`, and one field map HTML per question (`field-maps/<question_id>-data-map.html`, from the first valid repeat) by default.

## Workflow

1. Before starting a run, follow `references/pre-run-confirmation.md`: ask the user the 11 confirmation items (question set is required; all others have defaults). If the user does not answer, use defaults (repeat=1; random 60-100s delay; quick mode; create share on; export Excel on; field maps on; current profile; auto timestamped out dir; no project placement; no target means exploratory analysis; no question list means do not start).
2. Read `references/user-setup-and-usage.md`, `references/doubao-crawl-workflow.md`, and `references/report-contract.md`.
3. Web preflight: run `node scripts/preflight.mjs --profile <profile>` (omit `--profile` when using the current logged-in profile); do not start until the browser is connected and the Doubao login check passes.
4. For Android/Appium, also read `references/mobile-appium-workflow.md` and run `python3 scripts/doubao_mobile_crawl.py preflight ...`.
5. Stage 1 web: run `scripts/doubao_batch_crawl.mjs` (default `--completion-mode browser`, default `--repeat 1`, default random 60-100s delay, default `--create-share`, then capture and parse thread share links). Use `--plan-order round` (default) or `--plan-order question` to control execution order.
   - 项目归置（可选）：传 `--project <项目名>`（或设 `DOUBAO_PROJECT`）后，每个样本在“提问→回答→采集分享链接”完成后，会用与分享采集相同的侧边栏 UI 自动化把该会话移入指定 Doubao 项目；结果记录在样本的 `project_move` 字段。
6. Stage 1 mobile: run `scripts/doubao_mobile_crawl.py batch`; use `--fresh-chat --require-fresh-chat` when samples must start in separate Doubao app conversations.
7. Stage 2: run `scripts/analyze_doubao_results.py` on the compatible crawl JSON.
8. Use `evals/` and `templates/` for packaging checks and collection briefs.
9. Return crawl JSON, `question-links.csv`, `full-sample-data.csv`, `share-links.xlsx`, per-question field map HTML, `summary.json`, structured Markdown/Excel, HTML report, screenshots/XML for mobile, failed logs, and mobile search-material evidence when present.

## Quality And Versioning

- Run one collection task at a time and keep the same account for one run; switching accounts can invalidate previously created share links.
- 项目归置要求项目已存在；采集器通过网页端 UI（会话悬停菜单 → 移动到项目）移动，不创建项目、不绕过权限。移动失败不判定样本失败，但会在 `project_move` 中记录错误供事后处理。
- Share links must be publicly accessible. If link creation or snapshot parsing fails, mark the sample failed; do not count it as success.
- Never overwrite or delete an existing run. New runs reuse the requested directory only when it contains no `doubao-crawl.json`; otherwise the batch auto-creates `-v2`, `-v3`, and so on.
- Keep raw answers, references, URLs, screenshots/XML, logs, and failed samples as evidence.

## Honest Boundaries

- Do not bypass login, CAPTCHA, risk controls, hidden APIs, network traffic, or app storage.
- Android/Appium is low-frequency visible UI evidence capture.
- Probability and competitor metrics are repeated-sample estimates; review aliases before external use.
- Doubao web does not currently expose a Vision mode or a separate deep-thinking toggle; those DeepSeek options have no Doubao equivalent and are not confirmed for Doubao runs.
