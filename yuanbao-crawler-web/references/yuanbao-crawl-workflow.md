# Yuanbao Crawl Workflow

## Local Capability Source

Bundled local crawler:

```text
scripts/yuanbao_browser_crawl.mjs
```

The crawler uses the OpenCLI `yuanbao` site adapter:

1. Starts a fresh conversation with `opencli yuanbao new`.
2. Sends the prompt with `opencli yuanbao ask` (internet search on by default; `--think` enables deep thinking) and waits for the assistant response.
3. Reads the current conversation metadata with `opencli yuanbao status` and keeps `Url` (the `/chat/<agentId>/<convId>` audit link), `AgentId`, `SessionId`, `Model`, and `ModelId`.
4. Automatically opens the conversation page, clicks 分享, copies the public link, and parses the public share page `__NEXT_DATA__` payload. Full question, answer, references, media, model, and timestamps are merged into the sample (default enabled; `--no-create-share` disables).
5. If share creation fails, falls back to verified browser DOM citation links when available, then to markdown links and bare URLs in the answer text. Each reference records `source_origin`, `title_origin`, and `summary_origin` provenance fields.
6. Optional group placement: when `YUANBAO_GROUP=<分组名>` is set, the crawler moves the fresh conversation into the named 元宝对话分组 after share creation via `POST /api/user/agent/conversation/move` (`agent_id`, `source_cid`, `target_project_id`). The target project id is read from the sidebar group element's `data-project-id` (32-hex). Moving is idempotent: `code 21006 项目id重复` means the conversation is already in the group and is treated as success.

Override the crawler path with `--crawler-script` or `YUANBAO_CRAWLER_SCRIPT` when the local project moves.

## 对话分组采集（可选）

元宝网页端“对话分组”把会话按文件夹组织。需要把每个问题的新会话归入指定分组时，先创建分组，再设置 `YUANBAO_GROUP` 环境变量后运行同一批命令（Windows PowerShell 示例）：

```powershell
$env:YUANBAO_GROUP = "0818 营销104个问题"
node scripts/yuanbao_batch_crawl.mjs --questions questions.txt --repeat 1 --profile <profile> --out-dir runs/my-yuanbao-run
```

验证过的关键结论（2026-08 实测）：

- **顺序**：先提问、先创建分享链接，最后移动会话。分享创建通过默认侧边栏匹配会话；会话移入分组后从默认列表消失，先移动会让分享失败（`no matching conversation found in sidebar`）。
- **不要在分组页直接提问**：分组内已有会话时，分组页输入框会续接最近一条会话，不会为每个问题新建会话（空分组才会新建）。因此不能用“进分组→发消息”代替“默认区提问+移入分组”。
- **会话 ID 是短字母数字**（如 `0PiSKR4x5Wa`），不是 36 位 UUID。脚本内部所有会话 URL 解析均已按短 ID 处理。
- **分享健壮性**：即使默认侧边栏为空（全部会话已归组），采集器会直接用 `yuanbao status` 返回的会话 URL 打开会话页并调用分享接口；回答文本偶发截断（如“我先搜索最新数据”）不阻塞分享。
- **验证归属**：读每个样本 raw JSON 的 `group_move`（`ok:true, skipped:false`）或调用 `/api/user/agent/conversation/list` 看 `projectId`；不要只靠页面 DOM（侧边栏只渲染可见窗口，分组页列表可能混入最近会话）。
- **试点先行**：大批量前先用 2–3 题试点确认“分享链接+归组”全链路，再全量；全量用 `--resume` 续跑。

## Preflight

Run the skill preflight before a real crawl:

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

If the crawler script is not in the default local path:

```bash
node scripts/preflight.mjs \
  --profile <opencli-profile> \
  --crawler-script /absolute/path/to/yuanbao_browser_crawl.mjs
```

The preflight wraps these underlying checks:

```bash
opencli --version
opencli doctor
opencli profile list
opencli yuanbao whoami -f json
```

腾讯元宝 web must already be logged in. The skill does not handle login, CAPTCHA, Cloudflare checks, or account recovery. If Browser Bridge is disconnected, open a Chrome or Edge profile with the OpenCLI Browser Bridge extension enabled, log in to 腾讯元宝, and rerun `opencli doctor`.

## Stage 1: Batch Crawl

Use the batch wrapper from this skill:

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --entity-type company \
  --safe-random-delay \
  --out-dir runs/my-yuanbao-run
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

The wrapper records `target_entity`, `target_aliases`, `entity_type` (default `auto`), model mode, store/Excel flags, and delay strategy in `yuanbao-crawl.json > input`. When auto-share is required and share creation fails, the sample is marked `ok=false` and kept as evidence. The wrapper opens a fresh 腾讯元宝 conversation per sample (`--session` is a browser session id used for DOM reference extraction). It writes per-sample raw JSON and logs, then writes `yuanbao-crawl.json`.

## Per-Question Data Field Maps

The batch crawler writes one data field map HTML per question by default:

```text
<out-dir>/field-maps/<question_id>-data-map.html
```

It uses the first valid sample of each question. The HTML contains five tabs: 字段地图 / 回答正文映射 / 引用明细 / 推导分析 / 原始 JSON, matching the Doubao and DeepSeek crawler field-map method. Disable with `--no-field-maps`. You can also render field maps from an existing dataset:

```bash
node scripts/render_yuanbao_field_maps.mjs runs/my-yuanbao-run/yuanbao-crawl.json --out-dir runs/my-yuanbao-run
```

## Share-Only Collection

Public share links (`https://yb.tencent.com/s/<shareId>`) embed a full `__NEXT_DATA__` payload and need no login. Aggregate existing share links into the same dataset schema without browser automation:

```bash
node scripts/yuanbao_share_batch.mjs \
  --links share_links.txt \
  --target-entity "新东方" \
  --entity-type company \
  --out-dir runs/yuanbao-shares
```

Input format: one share URL per line, or a JSON array. Duplicate share ids are deduplicated. Each share link becomes one sample marked `transport: yuanbao-share-public`, and per-question field maps are generated by default. A single share link is one sample; repeat sampling still requires multiple independent links.

## Run Rules

- Default to `--search` so citation links are more likely to appear in the answer.
- Default interval is random 60-100 seconds between fresh samples. Prefer `--safe-random-delay` (5-20 minutes) for long real runs that need a slower request rate.
- Use `--delay-min-minutes <n> --delay-max-minutes <n>` when a different random interval is needed.
- Use `--resume` to skip samples that already have valid raw JSON.
- `--store` is on by default and exports CSV, SQLite, and `share-links.xlsx` under `<out-dir>/store`; use `--no-store` or `--no-share-links-excel` to disable parts.
- If `<out-dir>` already contains a run, the batch writes to `<out-dir>-v2/-v3` and keeps the old version.
- Use `--delay-ms` only for controlled tests or trusted low-risk environments; a fixed override replaces the default 60-100 second random interval.
- Quick mode is the default. Use `--model expert` or `--model vision` for other collection modes (Yuanbao adapter limitation: expert approximates with deep thinking, vision records a warning and runs in quick mode). Use `--think` to enable 腾讯元宝 deep thinking mode; this increases answer time and cost.
- Default per-sample timeout is 600 seconds.
- Plan order defaults to `round`（轮询）：each round visits every question once, then repeats. This spreads each question's repeats across the whole run window for fairer cross-question comparison and more natural request traffic. Use `--plan-order question` to finish one question entirely before the next.
- Treat failed samples as evidence. Do not delete them from the dataset.
- If a question must be crawled 5 times, the denominator is 5 even when one sample fails; report completion and valid-sample counts separately.
- Slower random intervals reduce request frequency but do not guarantee account safety or bypass platform risk controls.

## 链接校验与修复（正式交付前必做）

2026-08 实测发现：个别账号/浏览器状态下，`opencli yuanbao new` 点击“新建对话”后页面未真正跳转，`ask` 会把问题追加进上一条会话。此时该会话被多个样本引用（同一 `conversation.url` 的 cid 重复），分享接口取的是会话前 2 条消息，链接内容变成**上一条问题**。

校验方法（批量、逐样本）：

```bash
node scripts/analyze_yuanbao_share.mjs --link https://yb.tencent.com/s/<shareId> --out check.json
```

比对 `check.json > question.text` 是否等于该样本的问题。任何不一致即视为链接错误。

修复步骤：

1. 在 `conversation/list`（未分组会话）中按标题/`lastReplyContent` 找到该问题的**单题会话**（追加发生时，未分组区通常保留一个只含该问题的会话副本）。
2. 用分享接口（`POST /api/conversations/v2/share`，payload 含 `conversationId/agentId/conversations:[{index:1},{index:2}]/selectAll:true`）为该会话创建新链接。
3. 用 `POST /api/user/agent/conversation/move` 把该会话移入目标分组。
4. 更新对应 raw JSON 的 `share.url/share_id`、`conversation.url`、`answer.text`、`references`、`group_move`，重新生成表格，并再次全量校验。

判定线索：同一会话 ID 被多个样本引用 = 追加发生；分享页 `counts.messages > 2` 或 `question.text` 不等于目标问题 = 链接错误。

## Stage 2: Analyze And Render

```bash
python3 scripts/analyze_yuanbao_results.py \
  runs/my-yuanbao-run/yuanbao-crawl.json \
  --target-entity "新东方" \
  --entity-type company \
  --brands-file brands.txt \
  --out-dir runs/my-yuanbao-run/report
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

- `references.count = 0`: share creation failed, the search toggle may be off, the answer may contain no external URLs, or the visible citation DOM changed. Check `share.error` in the raw sample. When auto-share is required, a failed share marks the sample failed; you can rerun with `--no-create-share` + a manual share link for reference-only collection.
- `ok = false`: keep the raw file/log and include it in completion metrics.
- Repeated DOM failures: rerun one question manually with `node scripts/yuanbao_browser_crawl.mjs --prompt "..." --profile <profile>` and inspect the per-sample log before changing this skill.

## Evidence Boundary

This skill analyzes what 腾讯元宝 web displayed. It does not claim that cited source pages are correct, complete, or currently reachable. If downstream work needs external page truth, add a separate fetch-and-parse stage and label it separately.
