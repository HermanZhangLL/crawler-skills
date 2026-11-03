# Changelog — qianwen-crawler-web

版本号规范：`vMAJOR.MINOR.PATCH`。每次发布同步更新 `manifest.json` 的 `version` 字段。

## v1.0.0 — 2026-10-30

首个以本仓库为准的独立发布版。基于内部版本线 v0.1.0 → v0.1.6 清理而成。

### Changed

- manifest owner 更新，版本号 `1.0.0`；移除版本快照目录与 `versions.md`（由本文件替代）。
- 新增 GitHub 发布 README（预安装软件、预设值与取舍、链接权威来源规则）。
- 剔除 `__pycache__` 等构建产物。

---

## 内部版本线（v0.1.0 – v0.1.6，2026-09-09 – 2026-09-15）

- `v0.1.6`（2026-09-15）：审查修复（第 3 轮续采前的代码体检）。
  - `qianwen_build_links_table.py` 兼容两种问题清单字段名（`index`/`levelName`/`intent` 与 `level_name`/`intent_label`），缺 `index` 时按清单顺序自动编号。**修复前实测**：用第 3 轮的 `questions-104-full-20260915.json` 出表，「序号 / 层级名称 / 意图标签」三列整列空白（第 2 轮清单恰好是老字段名，所以一直没暴露）
  - `qianwen_batch_crawl.mjs` 修复看门狗计时器泄漏：`setTimeout(child.kill, (timeout+120)s)` 原先从不清除，子进程已结束后进程仍被挂住。**实测**（stub 子脚本立即返回、`--timeout -110`）进程仍活满 10.3s；按默认 `--timeout 600` 即每批白挂约 12 分钟，并拖慢等待 node 退出的 wrapper 循环。现在 `clearTimeout` + `unref`
  - 文档纠正「拒答不落库」的旧结论：2026-09-15 实测账号级拒答（对任何问题都回「你好，我无法回答这个问题，我们换一个话题聊聊吧。」）**会话会落库、链接可打开**，因此 `ok=true` 不等于采集成功，必须看回答内容
  - 新增「适配器可用性按扩展版本」对照：v1.0.15~v1.0.22 上 `qwen ask` 不可用（恒定 600s 超时、`chat_url` 常不存在，9/11、9/14 两轮因此改用 DOM 自建采集器），**v1.0.24 复测恢复正常**（8.3s 返回、`qwen detail` 可读回）
  - `qianwen_build_links_table.py --validated` 的说明文案修正：`validate.json` 会为**未采集的题**各留一行空 `sid`，原先把这些空值也算作"剔除的失效会话"，导致说明页谎报剔除数（实测 61 条链接全通过时仍写"已剔除 1 条失效会话"）。现在只统计非空 `sid`
  - `manifest.json` 版本号从错写的 `0.1.0` 修正为 `0.1.6`，`updated_at` 更新；当前版本目录剔除 `scripts/__pycache__/`（Python 构建产物，`v0.1.4`/`v0.1.5` 历史快照保持原样未动）
  - 未改动：`--group-json` 唯一权威链接来源、逐条校验、同题多链接保留等既有规则

- `v0.1.5`（2026-09-15）：确认"分组=真实、非分组=有问题"的判定规则，出表只认分组。
  - `qianwen_build_links_table.py` 默认**不再采用 raw `chat_url`**，需显式 `--allow-raw-fallback` 才启用回退；说明页新增"取用规则"一行
  - 按该规则重出交付表：143 行（全部来自分组）、104 题覆盖、29 题多链接、无缺失；分组外的 3 条曾校验可用的 raw 会话按规则剔除
  - `SKILL.md`、`references/qianwen-crawl-workflow.md` 固化规则原文

- `v0.1.4`（2026-09-15）：同题多链接全量保留 + 校验防误杀（用户明确要求"有结果的链接都附上，不去重"）。
  - `qianwen_build_links_table.py` 新增 `--all-links`（同题多条会话各占一行，不再只保留第一条）、`--extra-links`（补录已校验的额外会话）；`--validated` 改为**按会话号逐条剔除**（原先是整题作废）；说明页新增"表内链接行数 / 有链接的问题数 / 同题多链接的问题数 / 链接来源 / 保留策略"
  - `qianwen_validate_links.mjs` 新增 `--retries`（默认 2，失败自动重试并加大等待）——实测存在"页面没加载完就被判无效"的假阴性（例如会话 `e348a52d…` 首判失败、重判通过）；同时改为**每行都打印结果**（跳转行原先静默不输出，长跑时看起来像卡死）
  - 实战数据：229 条候选链接（分组 143 + raw 86），校验后 141 条可用；`--all-links` 出表 146 行覆盖 104 题、31 题多链接
  - `SKILL.md`、`references/qianwen-crawl-workflow.md` 同步更新

- `v0.1.3`（2026-09-15）：链接来源改为“分组枚举优先”（和光书苑 104 题第2轮收尾实战）。
  - 新增 `qianwen_build_links_table.py --group-json`：链接直接取分组枚举出来的 `data-session-id`（`/chat/<sid>`），raw `chat_url` 降级为回退来源；新增 `--emit-missing` 产出补问题清单
  - `qianwen_validate_links.mjs` 支持 `--table <csv>`：直接校验交付表里的链接，并识别“会话不存在 → 静默跳回 `/chat`”（记为 `redirected_to_new_chat`），默认 `--sleep` 提到 5000ms
  - 经验固化：`qwen status` 的 `chat_url` 不可信（拒答/未落库会话会给不存在的 session id）；分组页每行 `div[data-session-id]` 的行文本含“标题+问题+答案片段”，命中即可证明会话存在；会话移入分组后会从“最近对话”消失，首页显示“暂无对话”属正常；同题多会话取“问题位置最靠前”的那条
  - 本轮实测：分组 140 条会话、104 题全部命中、104 条链接逐条校验通过；补问最后 2 题（YX-L5-14、YX-L5-15）并归组
  - `SKILL.md`、`references/qianwen-crawl-workflow.md` 同步更新

- `v0.1.2`（2026-09-14）：链接有效性与完成度核对能力（第2轮实战教训）。
  - 新增 `scripts/qianwen_validate_links.mjs`：逐题打开会话页，确认页面确实包含该问题；实测一轮 104 条 raw 链接中有 69 条无效（打开后找不到问题），交付前必须校验
  - 新增 `scripts/qianwen_enumerate_group.mjs`：枚举千问分组内的会话（前端虚拟列表，滚动至不再增长），用于按“分组实际会话”判定完成度
  - 新增 `scripts/qianwen_build_links_table.py`：生成“问题→会话链接”CSV/XLSX；支持多个 `--run-dir` 合并（补采覆盖原始）与 `--validated` 过滤无效链接
  - 经验固化：完成度不能只看 raw 或汇总表，必须以分组内实际会话为准；同题重试会在分组里产生多条会话（实测 49 题对应 85 条）；顺序固定为“先取会话链接、后移入分组”；连片无应答先冷却再续
  - `SKILL.md`、`references/qianwen-crawl-workflow.md` 同步更新

- `v0.1.1`（2026-09-10）：和光书苑 104 题第一轮实战修复与增强。
  - 批次判定改为以 `raw/<sample>.json` 为准，修复成功样本被误记为 `no_result` 的问题
  - 单题支持 `--id <样本号>`，raw 记录 `sample_id`/`question_id`；`session_id` 缺失时从 `chat_url` 推导（反向亦然）；单题/批次默认超时 600s
  - 批次新增风控熔断：连续失败（默认 3）自动冷却（默认 20 分钟），`--pause-after-fails`/`--pause-minutes` 可调，`--no-circuit-breaker` 关闭；totals 增加 `cooldowns`
  - 新增 `scripts/qianwen_move_to_group.mjs`：采集后把会话拖拽归入千问分组，支持 `--max-scroll`/`--dry-run`，并兼容从 URL 推导会话号
  - 文档补充：题间 ≥40-60 秒、连片无应答冷却再续、重题必须用样本号为键、分组核对受前端虚拟列表限制

- `v0.1.0`（2026-09-09）：初版基线。
  - opencli qwen 适配器提问（`--new true`），记录回答与 `chat_url`/`session_id`
  - batch 支持 `--resume/--delay-ms/--delay-min-ms/--delay-max-ms/--safe-random-delay/--dry-run`
  - 采集前确认项与分组归置说明（千问网页 UI 移动，不调用隐藏接口）
  - 链接/分组顺序原则固化：千问无公开分享，先记录会话 URL 再移入分组；与元宝/豆包统一“先取/生成链接→后移入分组”，禁止先移后取
  - 实测：单题成功约 20-30s；偶发 300s 超时（页面未答/答得慢），建议 `--timeout 600`

