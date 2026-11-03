---
name: yuanbao-crawler-web
description: "Use when a user provides 腾讯元宝 web AI-search keywords/questions, repeat count, target entity, entity type, OpenCLI profile, crawl interval preference, or public share links, then needs repeated fresh-conversation crawls or share-link collection aggregated into JSON, per-question data field map HTML, structured Markdown/Excel, and a Kami HTML GEO report. Not for generic website crawling, 腾讯元宝 API chat, SEO writing, hidden API extraction, high-frequency automation, or one-off answers."
---

# Yuanbao Crawler Web

## Inputs

Standard inputs: keywords/questions, repeat count, target entity, entity type (`人/person`, `公司/company`, `产品/product`), OpenCLI Browser Bridge profile, delay preset, and optional output directory. Competitors must match the target type. Reports default to Simplified Chinese with an English summary toggle.

可选输入：`YUANBAO_GROUP`（环境变量）把每次新会话归入元宝网页端指定的“对话分组”。分组必须已在账号中创建；采集器会在回答与分享链接完成后，通过元宝网页端官方会话移动接口把会话移入该分组。

## Pre-collection Confirmation

Before starting a real run, ask the user for these inputs and fall back to defaults when they do not answer:

1. 问题/关键词集：无默认，必填；缺失时先请用户提供 `questions.txt`、JSON 数组或直接粘贴。
2. 每个问题提问次数：默认 `1`（范围 1-50）。
3. 目标实体、实体类型和竞品/别名表：目标实体必填；实体类型默认 `auto`，由采集方根据问题判断（人/公司/产品），也可直接指定；别名表格式 `实体|别名A|别名B`；竞品不提供时由分析器从回答中推断。
4. 每个问题之间的采集间隔：默认随机 `60-100 秒`；可选 `--safe-random-delay`（5-20 分钟）或自定义。
5. 采集模式：默认快速模式（`--model quick`）；可选专家模式（`--model expert`）、Vision 模式（`--model vision`）；深度思考默认关闭（`--think`）。元宝适配器限制见 Honest Boundaries。
6. 是否保留会话 URL 审计：默认保留，采集器在每次提问后记录 `conversation.url`（`yuanbao.tencent.com/chat/<agentId>/<convId>`）作为证据链接。
7. 是否生成单问题数据字段地图 HTML：默认生成（`--no-field-maps` 关闭）；同一问题无论重复多少次，只取第一份有效样本生成一份。
8. 自动分享与公开链接解析：默认开启（分享接口优先，页面按钮兜底），解析 `yb.tencent.com/s/<shareId>` 全量数据；开启时分享创建失败或取数失败的样本标记为失败；`--no-create-share` 关闭。注意分享链接是公开的。
9. 数据表与“问题→分享链接”Excel：默认导出（`--store`），包括 CSV、SQLite 和 `share-links.xlsx`（问题、轮次、分享链接、分享成功）；`--no-store` 关闭，`--no-share-links-excel` 只关 Excel。
10. 浏览器采集 profile：真机采样必填，默认使用当前已连接且已登录元宝的 profile；一次采集固定同一账号；仅做公开分享链接批量解析时不需要。
11. 输出目录：不指定时自动生成 `YYYYMMDD_<实体>_yuanbao_web`（快速 `_fast`、专家 `_expert`、Vision `_vision`、深度思考 `_think`）或 `yuanbao-<timestamp>`；已有旧版本自动追加 `-v2/-v3`，旧版本保留。

12. 是否把会话归入指定对话分组：默认不归组；需要时由用户提供元宝“对话分组”名称，通过环境变量 `YUANBAO_GROUP=<分组名>` 传给采集器。分组需已存在（侧边栏可见），采集器自动解析其 projectId 并逐样本移动。

同时确认是否启用 `--resume`、`--no-search`、`--plan-order question`，是否提供 `share_links.txt`，以及输出目录、报告标题和语义复核模式。问题模板见 `templates/pre-collection-questionnaire.md`。
## Workflow

1. Read `references/user-setup-and-usage.md` for install, prerequisites, and user-facing steps.
2. Read `references/yuanbao-crawl-workflow.md` for crawler setup, preflight, delay, resume, and batch rules.
3. Read `references/report-contract.md` for JSON schema, metrics, target/competitor recognition, and report rules.
4. Run `node scripts/preflight.mjs --profile <profile>` before fresh crawling.
5. Stage 1: run `scripts/yuanbao_batch_crawl.mjs` with questions, repeat, profile, target entity/type, and output dir. Default delay is random 60-100 seconds; `--safe-random-delay` switches to 5-20 minutes. Plan order defaults to `round`（轮询）：第 1 轮所有问题各采样 1 次，第 2 轮再全部采样，依次类推；需要按“先问完一个问题的全部次数再问下一个”时用 `--plan-order question`。
   - Each sample starts a fresh 腾讯元宝 conversation via `opencli yuanbao new`, then sends the prompt with `opencli yuanbao ask` (internet search on by default, `--think` for deep thinking, `--model quick|expert|vision` for the requested collection mode). The crawler records the conversation URL from `opencli yuanbao status` for audit.
   - 分组采集（可选）：设置 `YUANBAO_GROUP=<分组名>` 后，采集器在**回答与分享链接完成之后**，用元宝网页端官方接口 `POST /api/user/agent/conversation/move`（`agent_id` + `source_cid` + `target_project_id`）把该会话移入指定分组。顺序不能颠倒：分享创建依赖默认侧边栏匹配，会话一旦移入分组就会从默认列表消失，先移动会导致“no matching conversation found in sidebar”。已在分组中的会话重复移动会返回 `code 21006 项目id重复`，视为成功（幂等）。
   - After the answer, the crawler automatically opens the conversation page, clicks 分享, copies the public link (`yb.tencent.com/s/<shareId>`), and parses the public page `__NEXT_DATA__` payload to merge full question, answer, references, media, model, and timestamps into the sample. This is enabled by default; use `--no-create-share` to disable.
   - 会话 ID 是短字母数字（如 `0PiSKR4x5Wa`），不是 36 位 UUID。采集器所有会话 URL 解析（含分享兜底、状态回读、来源校验）都按短 ID 处理；不要把会话 ID 当作 UUID 校验。
   - 分享创建不依赖侧边栏匹配的健壮性：即使默认侧边栏为空（全部会话已归组），也会用 `yuanbao status` 返回的会话 URL 直接打开会话页并调用分享接口生成公开链接；回答文本偶发截断（如“我先搜索最新数据”）不会阻塞分享。
   - 链接错位根因与预防（v0.3.3）：部分账号下 `yuanbao status` 不返回会话 ID，旧逻辑回退到上一条会话导致分享建错会话（表现：链接内容=上一条问题）；少数情况新会话未真正新建、问题被追加进上一条会话（本样本问答在会话末尾）。修复：会话匹配只按“问题文本”判定；分享固定取会话**最后一问一答**（单题会话等价第 1-2 条）；分享后自检 `question.text` 并记录 `share.content_mismatch`。
   - 环境兼容（v0.3.4）：Node 直连 `yb.tencent.com` 被网络沙箱拦截时，采集器自动改为“浏览器抓分享页 HTML（带重试）+ 本地解析”（`analyze_yuanbao_share.mjs --html`）；`tab select` 的 EPERM 状态文件写入会被容忍；分组 projectId 优先走 `get-user-projects` 接口解析（不依赖侧边栏 DOM，分组多时也能命中）。
   - 残留会话（v0.3.4 运维要点）：失败或被中断的样本，其会话不会自动归组；重试会生成重复会话。采集后请检查默认区（`conversation/list`），把残留移入对应分组或清理；残留不影响已交付链接质量，但会污染账号并可能干扰“按问题匹配”。
   - If share creation fails while auto-share is required, the sample is marked failed (`ok=false`); the raw JSON and log are still kept as evidence. When share creation is disabled, the crawler falls back to verified browser DOM citation links when available, then to markdown links and bare URLs in the answer text. Every reference keeps `source_origin`, `title_origin`, and `summary_origin` provenance fields.
   - Use `--resume` to skip samples that already have valid raw JSON.
   - After the run, one data field map HTML is generated per question under `<out-dir>/field-maps/<question_id>-data-map.html` (first valid sample only); use `--no-field-maps` to skip.
   - After the run, `--store` (default on) exports `store/yuanbao-samples.csv`, `store/yuanbao-references.csv`, `store/yuanbao-samples.db`, and `store/share-links.xlsx` (问题→分享链接登记表，含轮次)。Use `--no-store` or `--no-share-links-excel` to disable parts.
   - Output directories auto-version: if `<out-dir>` already contains a run, the batch writes to `<out-dir>-v2`, `-v3`, etc. so older versions are never overwritten.
6. Share-link collection (optional, no login needed): run `scripts/yuanbao_share_batch.mjs --links share_links.txt --out-dir runs/shares` to aggregate public `yb.tencent.com/s/<shareId>` links into the same `yuanbao-crawl.json` schema. Each share link becomes one sample marked `transport: yuanbao-share-public`, and per-question field maps are generated by default. The public share page embeds the full `__NEXT_DATA__` payload: question, answer text, references, media, model, and timestamps.
7. Stage 2: run `scripts/analyze_yuanbao_results.py` on any crawl JSON with target entity/type, optional brands file, report output dir, and semantic review mode. Use `--semantic-review auto` by default; use `--semantic-review required` for formal delivery when AI review must pass.
8. 链接内容校验（强烈建议，正式交付前必做）：对每个样本用 `analyze_yuanbao_share.mjs --link <share.url>` 解析，比对 `question.text` 是否等于该样本问题；任何不一致都说明分享链接抓到了错误会话（常见于 `yuanbao new` 未真正跳转新会话、问题被追加进上一条会话），需要从会话列表定位该问题的单题会话、重新创建分享链接并更新 raw JSON。参见 `references/yuanbao-crawl-workflow.md` 的“链接校验与修复”。
9. Return the raw crawl JSON, per-question field map HTML, structured Markdown, structured Excel workbook, HTML report, summary JSON, semantic-review cache when present, and failed logs. Reports include AI semantic labels for entity recognition, target-vs-best-3 radar, click-to-reveal bubbles, Chinese source names, clickable citations, title intent, compact treemap, and GEO actions.

## Honest Boundaries

- Do not use for generic website crawling, 腾讯元宝 API chat, SEO copywriting, or one-off answer generation.
- Reuses local 腾讯元宝 web automation through the OpenCLI `yuanbao` site adapter; does not bypass login, CAPTCHA, bot checks, or hidden data.
- 一次只跑一个采集任务，避免多个浏览器会话互相干扰；一次采集固定同一账号，切换账号可能导致旧分享链接失效。
- 分组采集依赖元宝网页端“对话分组”功能与官方会话移动接口；不创建分组、不绕过权限，分组不存在或未登录时该步失败并保留证据。不要在分组页面的输入框直接提问：分组内已有会话时，分组页发消息会**续接最近一条会话**，不会每个问题新建会话（只有空分组才会新建）。
- 验证分组归属请用接口（`/api/user/agent/conversation/list` 的 `projectId` 字段）或移动结果字段 `group_move`，不要只依赖页面 DOM：侧边栏只渲染可见窗口，分组页列表可能混入“最近会话”，DOM 判断不可靠。
- 部分账号/浏览器状态下 `yuanbao new` 点击后可能不真正跳转新会话，`ask` 会把问题追加进上一条会话，导致分享链接内容变成上一条问题（同一会话 ID 被多个样本引用即为征兆）。采集完成后必须校验链接内容与问题的一致性，并按校验结果修复。
- 元宝 OpenCLI 适配器不暴露模型切换（expert/vision）；当前实现中 `expert` 以深度思考近似，`vision` 按快速模式采集并记录警告。如需精确模型，请在浏览器手动选择。
- 开启自动分享时，分享创建失败或取数失败的样本标记为失败；采集不删除、不覆盖历史版本目录，旧版本保留。
- 腾讯元宝 OpenCLI 适配器没有公开分享命令；skill 回答稳定后自动调用元宝分享接口创建公开短链（页面分享按钮点击作为兜底），再解析，再解析 `yb.tencent.com/s/<shareId>` 页面内嵌 `__NEXT_DATA__`（默认开启，`--no-create-share` 关闭）。如果页面结构变化导致分享创建失败，直采样本引用可能为 0，此时可使用 `yuanbao_share_batch.mjs` 手动提供分享链接。
- Probability metrics are repeated-sample estimates, not ground truth.
- Inferred competitors are heuristic unless `--semantic-review required` passes. AI semantic review is an audit enhancement and never replaces hard-rule gates or answer-body evidence.
- Review aliases, semantic labels, excluded candidates, and competitor tables before external use.
- Preserve raw answers, reference titles, URLs, and logs.
