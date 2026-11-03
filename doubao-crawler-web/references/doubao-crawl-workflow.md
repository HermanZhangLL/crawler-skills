# Doubao Crawl Workflow

## Local Capability Source

Preferred local crawler:

```text
scripts/doubao_browser_crawl.mjs
```

The crawler uses the OpenCLI `doubao` site adapter. It opens a fresh conversation, sends one prompt to Doubao web, waits for the answer, normalizes the answer text, extracts visible external markdown links and bare URLs as references, and records answer length plus optional target mention count. When a compatible replacement crawler can expose richer citation rows, it should preserve `references.items[]` with `number`, `source`, `domain`, `title`, `date`, `url`, and `summary`.

Override the crawler path with `--crawler-script` or `DOUBAO_CRAWLER_SCRIPT` when the local project moves.

## Preflight

Run the skill preflight before a real crawl:

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

If the crawler script is not in the default local path:

```bash
node scripts/preflight.mjs \
  --profile <opencli-profile> \
  --crawler-script /absolute/path/to/doubao_browser_crawl.mjs
```

The preflight wraps these underlying checks:

```bash
opencli --version
opencli doctor
opencli profile list
opencli doubao status -f json
opencli doubao whoami -f json
```

Doubao web must already be logged in and reachable from the connected profile. The skill does not handle login, region blocks, CAPTCHA, Cloudflare checks, or account recovery.

## Stage 1: Batch Crawl

Use the batch wrapper from this skill:

```bash
node scripts/doubao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 1 \
  --profile <opencli-profile> \
  --target-entity "孟庆涛" \
  --entity-type person \
  --out-dir runs/geo-doubao-20260619
```

Input formats:

- Text: one question per line.
- JSON array of strings.
- JSON array of objects: `{"id":"q01","question":"...","repeat":1,"target":"...","mode":"专家"}` (optional per-question repeat and answer mode).
- Thread share links: `--thread-urls <file>` with one `https://www.doubao.com/thread/<share_id>` or share_id per line. Thread samples do not need opencli or login; they are parsed from the public share snapshot. The snapshot does not include the answer mode, so mode is recorded only for browser-asked samples (`--doubao-mode`, default quick).

Standard user inputs:

- `keywords/questions`: one or more questions.
- `repeat`: how many fresh samples per question (default 1, range 1-50).
- `target_entity`: the target entity to diagnose.
- `entity_type`: `person`, `company`, or `product`.
- `doubao_mode`: `quick` (default), `expert`, `work_turbo`, or `work_pro`; browser mode opens the Doubao mode menu and selects it per sample.

The wrapper records `target_entity`, `target_aliases`, `entity_type`, `doubao_mode`, `plan_order`, `create_share`, `repair_shares`, `share_links_excel`, resolved output dir, and delay strategy in `doubao-crawl.json > input`.

The default web flow operates the browser through `scripts/doubao_browser_crawl.mjs` (`--completion-mode browser`): open a Doubao conversation, send the prompt, poll the page until the answer is stable, capture the thread share link from the page, then parse the public snapshot. The wrapper writes per-sample raw JSON and logs, then writes `doubao-crawl.json`. The `opencli doubao new` adapter path is used by ask/send modes; if that adapter only reloads `/chat` or repeatedly returns no visible messages, use `--no-new` for controlled web runs while preserving raw logs and answer evidence.

## 项目归置（可选，对标元宝“对话分组”）

Doubao 网页端支持“项目”，可把会话移入项目。需要把每个问题的新会话归入指定项目时，先创建好项目，再传 `--project <项目名>`（或设 `DOUBAO_PROJECT` 环境变量）：

```bash
node scripts/doubao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 1 \
  --profile <opencli-profile> \
  --project "20260901 和光书苑全意图-第1轮" \
  --out-dir runs/my-doubao-run
```

实现与已验证的要点（2026-09 实测）：

- 流程顺序：提问 → 回答稳定 → 采集分享链接并解析 → 移动会话到项目。移动与分享采集共用同一套侧边栏 UI 自动化（悬停会话行 → 点击省略号菜单 → 移动到项目 → 选择项目），走官方页面交互，不调用隐藏接口。
- 项目需已存在于侧边栏（`section[data-project-id]` 提供项目 ID）；采集器按项目名匹配菜单项，不自动创建项目。
- 每个样本的会话行 ID 为 `conversation_<conversationId>`，采集器从页面 URL 取会话 ID；移动后会话出现在项目子树下，不影响后续样本的新会话。
- 结果记录在样本 `project_move` 字段（`requested/ok/project/error/steps`）；移动失败不把样本判为失败，但保留错误供事后处理。
- 若菜单弹出异常（Radix 弹层偶发两个菜单），可重试；与分享采集相同的容错逻辑。

## 分享链接可提取信息（信息采集要求）

每个公开 thread 分享链接通过 `scripts/parse_doubao_thread.mjs` 解析后，可获得以下结构化信息（`result` 记录字段）：

| 字段组 | 字段 | 内容 |
|---|---|---|
| 基础 | `question` / `answer.text` | 用户问题与 AI 完整回答文本（多轮消息合并） |
| 摘要 | `answer.brief` | 回答摘要（brief） |
| 时间 | `timing` | `asked_at`、`completed_at`、`collected_at`、`question_message_time`、`share_time` |
| 页面 | `page` | 分享 URL、conversation_id、share_id、分享标题 |
| 完成状态 | `completion` | 回答是否完成（finished）与完成信号列表（message_status、ext_is_finish、block_is_finish） |
| 参考来源 | `references.items[]` | 编号、站点名、域名、标题、日期、URL、摘要；`references.full[]` 保留原始卡片（text/video/image card，含 `cited` 是否被回答引用） |
| 搜索块 | `search_blocks[]` | 回答中的搜索过程：查询词、场景、搜索类型、扩展字段 |
| 追问建议 | `suggest_questions[]` | 平台推荐的追问问题（类型、内容、图标、点击链接） |
| 消息明细 | `message_list[]` | 归一化后的逐条消息（含 user_type、content、thinking_content、conversation_id 等） |
| 分享信息 | `share_info` | share_id、分享标题、分享状态、分享时间、bot、平台、业务类型 |
| 提取统计 | `extraction` | 字符数、行数、标题层级（headings）、引用数、目标实体提及次数 |

采集成果表（`question-links.csv` / `share-links.xlsx`）只保存“问题 → 链接”清单；链接内容数据（上表字段）保留在每个样本的 `raw/*.json` 与 `doubao-crawl.json` 中，供后续分析阶段使用。同一问题存在多个链接（如多轮、多账号、测试轮已入项目）时，成果表按问题保留多行链接，不覆盖。

## 窗口模式与独立采集 profile（不打断日常浏览器）

默认后台窗口模式：采集器把所有浏览器操作收敛为可配置的 `--window` 模式，不再把窗口强行置前、抢走鼠标焦点。

- 默认 `background`；按需切回 `foreground`：设环境变量 `DOUBAO_WINDOW_MODE=foreground`，或传 `--window-mode foreground`。
- 批次脚本同样支持 `--window-mode <foreground|background>`（会透传给子进程）；亦可直接设 `DOUBAO_WINDOW_MODE`。
- 后台模式下若窗口被最小化（尺寸为 0），会自动“恢复但不抢占焦点”（`restoreBrowserWindowViaOS` 仅在 foreground 模式调用 `SetForegroundWindow`）。
- 2026-09 实测：后台模式下“打开→新对话→选模式→输入→发送→采集→移项目→解析”整条链路可跑通，无因后台导致的报错；是否拿到链接取决于账号状态，与窗口模式无关。

独立采集 profile（推荐叠加）：新建一个专用 Chrome profile，与用户日常浏览器的 `--user-data-dir` 分开，日常窗口完全不受影响。

- 浏览器需带 OpenCLI Browser Bridge 扩展（未打包扩展在较新 Chrome 用 `--disable-extensions-except=<ext> --load-extension=<ext>`），先在前台启动一次让扩展建立连接，`opencli profile list` 能看到新 context id 后再用 `--profile <id>` 采集。
- 该 profile 需登录豆包账号；采集账号被风控时（欢迎页不产答案）即使换 profile 也无法拿到链接，需等待或换健康账号。
- 隔离原则：采集用“日常之外”的 profile（如闲着的备用 context），并在后台模式运行；不要把采集绑定到用户日常浏览的那一个 context。
- 一键建 profile 脚本示例见基线测量 `20260901_和光书苑_豆包104题_第一轮\setup-doubao-auto-profile.ps1`（含 `--disable-extensions-except`），停用见 `stop-doubao-auto-profile.ps1`。

## Run Rules

- Before each real run, follow `references/pre-run-confirmation.md`: confirm all 11 items (question set, per-question repeat count, target entity/entity type/competitor alias table, inter-question delay, answer mode, whether to place conversations into a Doubao 项目, create public share links, export tables + share-link Excel, field maps, browser profile, output dir) with the user; unanswered items use defaults (repeat=1, random 60-100s delay, quick mode, create share on, Excel on, field maps on, current profile, auto timestamped output dir, no project; no target means exploratory analysis).
- Doubao's OpenCLI adapter does not expose model switching or a dedicated Web Search flag; source extraction is limited to visible URLs unless a replacement crawler provides richer compatible references.
- Use `--no-reference-extraction` when URL extraction is not needed. `--no-search` is accepted as a compatibility alias for the same behavior.
- Use `--no-new` when the web adapter can send and read answers but cannot reliably open a fresh Doubao conversation. Label runs that use this option because samples may share the same Doubao conversation context.
- The default inter-question delay is random 60-100 seconds (`--delay-min-ms 60000 --delay-max-ms 100000`). Pass `--doubao-mode quick|expert|work-turbo|work-pro` (Chinese aliases accepted) when the pre-run confirmation selected a non-default mode.
- `--safe-random-delay` waits a random 5-20 minutes between fresh samples; `--moderate-delay` waits a random 60-180 seconds; both override the default random 60-100s range.
- Use `--delay-min-minutes <n> --delay-max-minutes <n>` (or `--delay-min-ms/--delay-max-ms`) when a different random interval is needed.
- Answer completion is detected by polling: browser mode reads the page text, ask/send modes call `opencli doubao read`, until the answer text is stable. `--completion-timeout` (default 600s), `--poll-interval-seconds` (default 8s), and `--stable-reads` (default 2) control the poll. Timed-out samples are marked `failure_reason=answer_incomplete`.
- `--plan-order round` (default) interleaves questions by round; `--plan-order question` runs one question fully before the next.
- `--create-share` is enabled by default: after a stable answer, the crawler captures the public thread share link and parses the public snapshot. `--no-create-share` disables link capture and parsing.
- With `--create-share` on, a sample is successful only when the thread link exists and the snapshot parses. Missing link -> `failure_reason=thread_link_failed`; parse failure -> `failure_reason=thread_parse_failed`; both keep `pending_thread_capture=true` and count as failed samples.
- `--retry <n>` retries failed samples within the same run and records `attempt_count`. `--resume` skips samples that already have valid raw JSON; `--repair-shares` with `--resume` re-runs samples that lack a valid public thread share.
- Each run writes `question-links.csv` with run/sample/question metadata, `doubao_mode`, conversation/thread links, and `asked_at/completed_at/fetched_at` timestamps.
- Each run also writes `full-sample-data.csv` (UTF-8 BOM, one row per sample with the full parsed record), `share-links.xlsx` (question -> share link workbook, default on; `--no-excel` skips it), and `field-maps/<question_id>-data-map.html` (one field map per question, default on; `--no-field-maps` skips the HTML).
- Output directories are versioned: a new run reuses `--out-dir` only when it contains no `doubao-crawl.json`; otherwise it writes to `-v2`, `-v3`, and so on, so old runs are never overwritten.
- Run one collection task at a time and keep the same account for one run; switching accounts can invalidate previously created share links.
- `--defer-parse` leaves non-thread samples as `pending_thread_capture=true`; run `--capture-threads --out-dir <run>` afterwards to fetch structured snapshots without re-asking.
- Use `--delay-ms` only for controlled tests or trusted low-risk environments.
- Treat failed samples as evidence. Do not delete them from the dataset.
- If a question must be crawled N times, the denominator is N even when one sample fails; report completion and valid-sample counts separately.
- Slower random intervals reduce request frequency but do not guarantee account safety or bypass platform risk controls.

## Stage 2: Analyze And Render

```bash
python3 scripts/analyze_doubao_results.py \
  runs/geo-doubao-20260619/doubao-crawl.json \
  --target-entity "孟庆涛" \
  --entity-type person \
  --brands-file brands.txt \
  --out-dir runs/geo-doubao-20260619/report
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

- `references.count = 0`: Doubao may have answered without visible links, citations may not be exposed as markdown links or bare URLs, or a replacement crawler did not provide compatible reference rows.
- `ok = false`: keep the raw file/log and include it in completion metrics.
- Repeated adapter failures: rerun one question manually with `node scripts/doubao_browser_crawl.mjs --prompt "..." --profile <profile>` and inspect the per-sample log before changing this skill.
- 连续 `answer_incomplete`（回答区始终未渲染、poll 读到超时）是典型的账号/平台风控特征，而不是页面卡死：先停止批次，等待冷却（建议 ≥30 分钟），再以更长的题间延迟 `--resume` 续跑；失败样本会被自动重跑。2026-09-01 实测：快速模式下连续约 30 题后出现连片 `answer_incomplete`，冷却 30 分钟后仍未恢复（现象持续数小时）：此时不要反复重试，等待更长时间或更换账号后再续跑。
- 风控期间的识别特征：新会话仍能创建（URL 可能变为 `/chat/local_<id>`），提问后回答区不渲染，页面长时间停留在“欢迎/新对话”界面（`有什么我能帮你的吗？`），composer 中的文本可能累积不发送。采集器已加防护：发送前清空 composer、欢迎页不作为完成信号、conversation_id 支持 `local_` 前缀并带 DOM 兜底。
- 长清单（100+ 题）建议使用默认随机 60-100 秒题间延迟或更保守的区间；`--delay-ms` 仅用于受控测试。出现连续失败时不要原地重试，先停止、冷却、再续跑。
- `--resume` 必须复用传入的 `--out-dir`（不再自动新建 `-vN` 目录），否则会从第一题重跑；配合 `--repair-shares` 可重跑“有答案但缺公开分享链接”的样本。
- 间歇性风控长清单实操（2026-09-07 第三轮 104 题验证）：账号会在“健康期（可连续成功数十题）”和“限流期（连片 `answer_incomplete`）”之间切换。批次自带熔断器（连错 N 次停 10 分钟探测）与自适应延迟；进程因熔断跳过剩余样本属预期，等待 10-20 分钟后再次 `--resume` 即可续跑，通常 2-4 轮可跑满 104/104。
- `project_move` 记录的是 UI 侧“是否成功点完菜单”，个别样本会因 Radix 菜单未渲染而记 `ok=false`，但分享链接仍有效；快照 `conversation_id` 与网页侧栏行 id 可能不是同一套编号。成果表以 `raw/*.json` 的 thread 链接为准；如确需网页项目完整，可对失败样本重跑（会建新会话）或在网页端手动补移。

## Evidence Boundary

This skill analyzes what Doubao web displayed. It does not claim that cited source pages are correct, complete, or currently reachable. If downstream work needs external page truth, add a separate fetch-and-parse stage and label it separately.
