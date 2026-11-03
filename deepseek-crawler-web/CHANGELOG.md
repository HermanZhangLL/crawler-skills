# Changelog — deepseek-crawler-web

版本号规范：`vMAJOR.MINOR.PATCH`。每次发布同步更新 `manifest.json` 的 `version` 字段。

## v1.0.0 — 2026-10-30

首个以本仓库为准的独立发布版。基于长期实战采样迭代（原内部版本线 v0.2.0 → v0.3.2）清理而成。

### Added

- **结构自适应链接数据采集**（`scripts/lib/share-structure.mjs` + `scripts/deepseek_share_probe.mjs`）：
  - 获取链接数据前先探测结构：消息数组路径、角色/正文/状态字段、引用数组位置及 url/标题/摘要/序号/日期/站点字段别名；
  - 按探测结果抽取并归一到统一 schema，已知 DeepSeek 结构仅作为高优先级候选与回退；
  - **typed-fragment 布局支持**（发布当日用真实分享链接实测发现平台已改版）：DeepSeek 已将 `message.content` 字符串改为 `messages[].fragments[]` 类型块（REQUEST/SEARCH/RESPONSE），引用移入 SEARCH 块的 `results` 数组。探测器按结构识别 fragment 容器、类型分桶与块内引用数组，question/answer/references 分别从对应类型块抽取；新增 fixture `sample-deepseek-share-fragments.json`（真实 payload）作回归；
  - 结构指纹（fingerprint）与置信度随每个样本的 `structure` 字段保存，平台改版可审计漂移；
  - 新增 CLI：`deepseek_share_probe.mjs --link <url> | --input <file>`，离线/在线两种探测模式，输出结构报告与统一 schema 预览。
- **GitHub 发布文档**：README（预安装软件清单、预设值取舍表、技术路线）、README.en、CHANGELOG。

### Changed

- 全面去除历史遗留的第三方前缀：`schema_version` 改为 `deepseek-crawler-web/v1`（raw 样本 `deepseek-crawler-raw/*-v1`）、会话 id 前缀改为 `dscw-`、manifest owner 更新；分析器改为按 `deepseek-crawler` 子串识别数据集，同时兼容读取历史前缀的数据集。
- 语义复核模型环境变量更名为 `DSCW_SEMANTIC_MODEL`（`OPENAI_MODEL` 回退不变）。
- `deepseek_repair_shares.mjs` 窗口模式改为遵循 `--window-mode` / `DEEPSEEK_WINDOW_MODE`（默认 background），修复此前硬编码 foreground 抢占浏览器焦点的问题。
- `run-tests.sh` 增加 python3/python 自动探测（Windows Store 的 python3 存根会导致假失败）。
- README 全面重写为 GitHub 发布页：预安装软件、预设值与取舍、结构自适应采集四场景、目录结构。

### Removed

- 历史版本快照目录、`reports/`（过期元审查报告）、`examples/`（真实采样大数据，只保留 `fixtures/`）、`__pycache__`、`versions.md`（由本文件替代）。

---

## 内部版本线（v0.2.0 – v0.3.2，2026-08-06 – 2026-09-09）

> 归档于 `H:\06 深保发展\02 日常工作归档文件\20260709 GEO材料汇总\20260720 企业GEO内容梳理\00 Skills重构\Deepseek Crawler_Web_single`，此处仅留摘要。

- **v0.2.0** 分享创建改为 Node 直连接口（status + token + history → share/create → share/content）；新增 `deepseek_repair_shares.mjs`；默认 `--create-share`、`--timeout 600`、`--plan-order round`。
- **v0.2.1** raw 样本 `share.share_ok` 标记；CSV/SQLite 增加 `share_ok` 字段。
- **v0.2.2** 新增"问题 → 分享链接"Excel 登记表 `store/share-links.xlsx`。
- **v0.2.3** 新增 `--model instant|expert|vision` 模型模式选择。
- **v0.2.4** 分析器恢复识别旧数据集前缀，新旧数据集均可分析。
- **v0.2.5** 采集前确认清单新增输出文件夹命名与存储位置规则。
- **v0.2.6** 字段地图展示层繁体转简体（原始 JSON 保留原文）。
- **v0.2.7** t2s 最长词组优先匹配（保留专有名词）；多 profile 环境 preflight 改 WARN。
- **v0.2.8** 竞品识别噪声过滤（话语词/连接词不再误判为竞品）。
- **v0.3.0** 采集窗口模式可配置，默认 background 不抢焦点。
- **v0.3.1** 104 题长清单实测经验固化：慢速非卡死、宜 `--resume` 分段。
- **v0.3.2** `--fast-ask` 快速完成判定：ask 只等 30s，轮询历史接口到完成，单题 30-60s。
