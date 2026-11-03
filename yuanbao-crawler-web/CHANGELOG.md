# Changelog — yuanbao-crawler-web

版本号规范：`vMAJOR.MINOR.PATCH`。每次发布同步更新 `manifest.json` 的 `version` 字段。

## v1.0.0 — 2026-10-30

首个以本仓库为准的独立发布版。基于内部版本线 v0.2.1 → v0.3.5 清理而成；skill 更名 `Yuanbao-crawler-web` → `yuanbao-crawler-web`（与其他 crawler skill 统一命名）。

### Added

- **结构自适应分享链接解析**（`scripts/lib/yuanbao-share-structure.mjs`）：抓取分享页 `__NEXT_DATA__` 后先探测 chat 载荷路径、speaker/speech/内容块/docs 字段（含改名回退与值模式识别），再按探测结果抽取归一；结构指纹与置信度随样本 `structure` 字段保存；新增 fixture `sample-yuanbao-share-payload.json`（真实载荷）与 4 个回归用例。
- GitHub 发布 README（预安装软件、预设值与取舍、核心链路、技术路线）。

### Changed

- 统一命名：目录、SKILL.md、manifest、文档、测试全部改为 `yuanbao-crawler-web`。
- 去除历史第三方前缀：`schema_version` 改为 `yuanbao-crawler-web/v1`（raw 样本 `yuanbao-crawler-raw/*-v1`、share `yuanbao-crawler-share/v1`）、会话 id 前缀 `ybcw-`；分析器按 `yuanbao-crawler` 子串识别，兼容读取历史前缀数据集。
- 语义复核模型环境变量更名为 `YBCW_SEMANTIC_MODEL`（`OPENAI_MODEL` 回退不变）。
- `run-tests.sh` 增加 python3/python 自动探测；`analyze_yuanbao_share.mjs` 输出结构探测摘要。

### Removed

- 版本快照目录、`过程文件/`（历史跑批数据留档在源归档目录）、`versions.md`（由本文件替代）、`__pycache__`。

---

## 内部版本线（v0.2.1 – v0.3.5，2026-08-06 – 2026-08-24）

- 0.3.5（2026-08-24）：修复 opencli 升级提示污染 stdout 导致分组 ID 解析失败（商业96题第3轮实测）。
  - 现象：opencli 开始在每个命令输出后追加 “Update available: v1.8.6 → v1.8.7” 横幅，`browser eval` 返回的 projectId 被横幅污染，32 位正则校验失败，整轮 96 个会话全部未归组
  - 修复：分组 projectId 改为从输出中用 `/[0-9a-f]{32}/i` 正则提取，不再依赖整串 trim
  - 运维提示：若某轮出现“全部未归组”且 group_move.error 含 “Update available”，说明同样问题；升级 opencli 或应用本修复后，把未归组会话批量移入目标分组

- 0.3.4（2026-08-24）：网络受限/沙箱环境兼容 + 分组解析接口化 + 残留会话清理（商业96题三连跑实测）。
  - 分享页解析兼容：`analyze_yuanbao_share.mjs` 新增 `--html <file>`（从本地 HTML 解析，跳过 Node 直连）；采集器在 Node fetch 被沙箱拦截时自动改用浏览器抓取分享页 HTML（`fetchShareHtmlViaBrowser`，带重试）再本地解析
  - 浏览器会话容错：`tab select` 在部分沙箱下写状态文件会 EPERM，改为尽力而为（tab new 已激活新标签），失败忽略不中断
  - 分组 projectId 解析改为优先调用 `get-user-projects` 接口（按分组名精确匹配），不再依赖侧边栏 DOM（分组多时目标组可能在“更多分组”折叠区而取不到）
  - 已知问题与运维：失败/被中断样本的会话不会自动归组，重试会生成重复会话，导致默认区出现“未分组残留”；采集后应校验默认区并把这些残留移入对应分组（或清理）。残留不影响已交付链接质量，但会污染账号并可能干扰按问题匹配
  - 实测：商业96题第1/2轮各 96/96 链接校验通过，0 错位；第3轮进行中

- 0.3.3（2026-08-20）：定位“合并会话/链接错位”根因并修复（产发136第1轮实测后固化）。
  - 根因：部分账号下 `yuanbao status` 只返回 `/chat/<agent>`（无会话 ID），历史/标签页回退会取到上一条会话；匹配要求“问题+回答”双重一致，回答文本截断或归一化差异导致匹配失败，进而回退到陈旧会话 URL，把分享建在上一条会话上（表现为“链接内容=上一条问题”）；少数情况新建会话动作确实失败，问题被追加进上一条会话（真合并，本样本问答在会话末尾）
  - 修复1：`findMatchingConversation` 改为按“问题文本”匹配即返回（回答匹配只作参考），不再因回答差异回退到陈旧 URL
  - 修复2：`buildCreateShareApiJs` 改为分享该会话**最后一问一答**（按页面消息数取最后两条，selectAll:false），单题会话等价于第 1-2 条，真合并时也能拿到本样本的问答
  - 修复3：分享页解析后自检 `question.text` 是否等于本次问题，不一致时记录 `share.content_mismatch` 供事后修复
  - 文档更新：链接校验与修复流程保留为最后兜底，并补充根因说明
  - 实测验证：产发136第2轮（20260820）全量 136 条链接内容校验 136/136 通过、0 错位；仅 1 条因回答提前返回（只有“先搜索…”前言）需事后对完整回答重新生成分享链接（属平台偶发，非错位问题）

- 0.3.2（2026-08-20）：补充“链接内容校验与修复”流程（20260819 第二轮 104 题实测：部分账号下 23/103 链接指向了上一条问题）。
  - 现象：个别账号/浏览器状态下，`yuanbao new` 点击后页面未真正跳转到新会话，`ask` 把问题追加进上一条会话；分享接口取该会话前 2 条消息，导致链接内容 = 上一条问题
  - 防御：每轮结束后必须校验每个分享链接解析出的 `question.text` 是否等于对应问题（用 `analyze_yuanbao_share.mjs` 批量比对）；不一致时，从会话列表中找到该问题的单题会话（页面或 `conversation/list` 的标题/`lastReplyContent` 匹配），重新创建分享链接并移入目标分组，再更新 raw JSON 与表格
  - 判定合并会话：同一会话 ID 被多个样本引用 = 追加发生；分享页 `counts.messages > 2` 或 `question.text` 不等于目标问题 = 链接错误

- 0.3.1（2026-08-19）：分组移动目标改为“分享结果权威会话 ID”（20260819 第二轮 104 题实测修复）。
  - 部分账号下 `yuanbao status` 只返回 `/chat/<agent>`（不含会话 ID），历史/标签页回退可能取到上一条会话，导致分组移动把上一条会话移入分组
  - 修复：移动前优先用分享页解析出的 `chat.id/agent_id`，其次用分享接口返回的 `conversation_id/agent_id`，均无 cid 时跳过移动并保留证据；不再以 status/侧边栏 URL 作为移动依据

- 0.3.0（2026-08-19）：对话分组采集 + 短会话 ID 与分享健壮性修复（20260818-19 和光书苑 104 题全意图基线实测验证）。
  - 新增 `YUANBAO_GROUP=<分组名>`：每次新会话在回答与分享链接完成后，通过元宝官方接口 `POST /api/user/agent/conversation/move` 移入指定对话分组；projectId 从侧边栏 `data-project-id` 自动解析（32 位十六进制），已在分组时 `code 21006` 幂等视为成功
  - 修正会话 ID 判定：元宝会话 ID 是短字母数字（如 0PiSKR4x5Wa），不是 36 位 UUID；`YUANBAO_SESSION_RE`、状态回读、来源校验、分享兜底与 URL 提取全部按短 ID 处理
  - 分享创建改为不依赖默认侧边栏：侧边栏为空（全部会话已归组）时直接用 `yuanbao status` 的会话 URL 打开会话页调用分享接口；回答文本偶发截断不再阻塞分享
  - 明确顺序约束：先分享后归组；分组页输入框在分组非空时会续接最近会话，不能替代“默认区提问+移入分组”
  - 文档新增分组采集用法、试点先行建议、接口级归属验证方法与故障排查行

- 0.2.0（2026-08-06）：当前已安装 skill Yuanbao-crawler-web 的基线版本（纳入版本管理前的状态，未单独快照）。
  - 网页端采集、会话 URL 审计、自动分享与公开链接解析、数据字段地图等基础能力

- 0.2.1（2026-08-10）：自动分享接口化 + 数据导出 + 采集前确认补齐。
  - 回答稳定后自动调用元宝分享接口创建公开短链（页面按钮兜底），解析 yb.tencent.com/s/<shareId> 全量数据；分享失败样本标记 ok=false，不计成功
  - 默认 --repeat 1；实体类型默认 uto（采集方判断），竞品不提供时由分析器推断
  - 新增 --model quick|expert|vision（expert 以深度思考近似；vision 暂按快速模式并记录警告，元宝适配器限制见 SKILL Honest Boundaries）
  - 新增 --store（默认开启）导出 store/yuanbao-samples.csv、store/yuanbao-references.csv、store/yuanbao-samples.db
  - 新增 store/share-links.xlsx：问题→分享链接登记表，含轮次与按问题汇总
  - 输出目录自动命名 YYYYMMDD_<实体>_yuanbao_web[_fast|_expert|_vision|_think] 或 yuanbao-<timestamp>；已有旧版本自动追加 -v2/-v3，旧版本保留不覆盖
  - 会话定位修复：剥离 Markdown 标题干扰、注入 conversationId/agentId、校验已知 URL
  - 采集前确认单、SKILL、用户指南、workflow、README 同步更新
