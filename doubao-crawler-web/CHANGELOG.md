# Changelog — doubao-crawler-web

版本号规范：`vMAJOR.MINOR.PATCH`。每次发布同步更新 `manifest.json` 的 `version` 字段。

## v1.0.0 — 2026-10-30

首个以本仓库为准的独立发布版。基于内部版本线 v1.0.0 → v1.2.0 清理而成；skill 更名 `Doubao Crawler_Web_single` → `doubao-crawler-web`（与其他 crawler skill 统一命名）。

### Changed

- 统一命名：目录、SKILL.md、manifest、文档、测试全部改为 `doubao-crawler-web`。
- 去除历史第三方前缀：`schema_version` 改为 `doubao-crawler-web/v1`（分析器按 `doubao-crawler` 子串识别，兼容读取历史前缀数据集）；manifest owner 更新。
- 版本快照目录、`reports/`、`versions.md`（由本文件替代）、`__pycache__` 全部移除。
- 新增 GitHub 发布 README（预安装软件、预设值与取舍）。

---

## 内部版本线（v1.0.0 – v1.2.0，2026-08-10 – 2026-09-03）

- `v1.2.0`（2026-09-03）：采集速度优化——熔断器 + 自适应延迟 + 风控快速失败。
  - **熔断器（Circuit Breaker）**：连续 3 次 `answer_incomplete` 后自动熔断，跳过后续题目并冷却 10 分钟；冷却后试探 2 题，若仍失败则标记全部剩余为 `circuit_breaker_exhausted` 并终止，避免在账号被风控时持续空转
  - **自适应延迟**：根据最近 10 题的成功率动态调整题间延迟——成功率 ≥90% 时自动缩短至配置值的 15%（最低 5-10 秒），成功率 <70% 时自动加倍，实现”快时更快、慢时更稳”
  - **风控快速失败**：重试循环检测到 `failure_reason === 'answer_incomplete'` 时立即跳出，不再消耗 `completionTimeout` 做无效重试
  - 样本新增 `circuit_breaker_open` / `circuit_breaker_exhausted` 两种 failure_reason，`doubao-crawl.json` 中可区分跳过原因
  - 日志新增 `[circuit-breaker]` 前缀和 `[delay]` 中的成功率信息，便于事后分析
  - 优化效果（和光书苑 104 题实测数据估算）：原 26 小时可压缩至 2-4 小时（节省约 8-13 小时无效等待和重试）

- `v1.1.0`（2026-09-01）：新增”项目归置”，对标元宝”对话分组”。
  - 豆包网页端支持“项目”：新增 `--project <项目名>`（采集器参数）与 `DOUBAO_PROJECT`（环境变量）
  - 流程：提问 → 回答稳定 → 采集 thread 分享链接并解析 → 通过侧边栏 UI 自动化把会话移入指定项目（悬停会话行 → 省略号菜单 → 移动到项目 → 选择项目），与分享采集同一套交互
  - 样本新增 `project_move` 字段（requested/ok/project/error/steps）；移动失败不判定样本失败，保留错误供事后处理
  - 批次脚本 `--project` 透传，`doubao-crawl.json > input.project` 记录配置
  - 弹窗容错：新增 `dismissDoubaoPopups()`，在提问、分享链接采集、项目移动前自动关闭可见覆盖层弹窗（含右上角关闭按钮启发式）；页面刷新后出现弹窗不再卡死流程
  - 发送框适配 tiptap/ProseMirror 新版编辑器：`#input-engine-container [contenteditable]` 输入 + 真实键盘事件，并保留旧版 fallback；启用按钮查找放宽到 `button.rounded-full` 等
  - 菜单容错：`clickMenuItemByText()` 遍历所有 `[role=menu][data-state=open]` 菜单（处理 Radix 偶发双菜单），按文本匹配菜单项；模式选择失败不再导致样本失败
  - `findBrowserRef()` 找不到浏览器引用时返回 null 而非抛异常；`testMode()` 缩短测试等待
  - Windows preflight 修复：`opencli` 通过 `opencli_runtime.mjs` 解析（node 全局 .cmd shim），不再直接 spawn 导致 ENOENT；多浏览器 profile 连接时按 profile list 判定连接状态（WARN 而非 FAIL），采集器显式 `--profile` 不受影响
  - `--resume` 修复：直接复用传入的 `--out-dir`（不再自动新建 `-vN` 目录导致从第一题重跑）；配合 `--repair-shares` 重跑“有答案但缺公开分享链接”的样本
  - 风控防护：发送前清空 composer（防止文本累积）；新会话欢迎页（“有什么我能帮你的吗？”）不再被当作完成信号；conversation_id 支持 `/chat/local_<id>` 前缀并带 DOM 兜底；找不到 conversation_id 时判失败（`conversation_id_missing`）而非静默产出无链接“成功”
  - 窗口模式：新增 `--window-mode foreground|background`（批次与单题均支持），默认后台 `background`（或经 `DOUBAO_WINDOW_MODE` 控制），所有浏览器操作不再强行置前抢焦点；后台模式下最小化窗口只恢复不抢占
  - 独立采集 profile 建议：新增文档，说明用独立 Chrome `--user-data-dir` + Browser Bridge 扩展跑采集，与日常浏览器分离；新建 profile 需先前台启动一次让扩展建连并注册 context id，并登录豆包
  - SKILL/工作流/采集前确认单（10 项 → 11 项）/README/manifest 同步更新；采集前确认新增“是否把新会话归入指定项目”
  - 2026-09-01 实测：2 个测试提问跑通“提问→分享链接→移入项目”，项目“20260901 和光书苑全意图-第1轮”下会话可见
  - 2026-09-01 正式批量：和光书苑 104 题 × 1 轮（提问→移入项目→采集链接），快速模式，题间随机 10-20 秒，全部产出公开 thread 分享链接；结果见基线测量 `20260901_和光书苑_豆包104题_第一轮`
  - 2026-09-01/09-02 实测结论：快速模式连续约 30 题后触发豆包账号风控（新会话创建但回答不渲染、URL 出现 `local_` 前缀、composer 文本累积），冷却 30 分钟未能恢复，数小时后仍受限；100+ 题长清单应使用默认随机 60-100 秒题间延迟，出现连片 `answer_incomplete` 时停止、等待更长时间或更换账号后再 `--resume` 续跑
  - 2026-09-04 批次加固（熔断 + 自适应延迟）：`doubao_batch_crawl.mjs` 增加熔断器（连续 `answer_incomplete` 达阈值后冷却 10 分钟再探测，避免狂轰风控账号）与自适应延迟（按最近 10 题成功率拉长/缩短题间间隔）
  - 2026-09-07 第三轮续跑实测结论：
    - 账号风控多为“间歇性”：健康期可 100% 连成几十题，随后突然连片 `answer_incomplete`；恢复窗口常在 10-20 分钟冷却后出现。长清单靠“多轮 `--resume` + 冷却间隔”最终可跑满 104/104，不必更换账号
    - `project_move` 存在瞬时 UI 菜单失败：个别样本链接有效但未被移入项目（菜单项未渲染），且快照 conversation_id 与侧栏行 id 可能非同一编号体系；成果表以 `raw/...json` 里的 thread 链接为准，项目归置如需 100% 完整可对这些题重跑一次或在网页端手动补移
    - 提交的最终表由 `make-final-table.py` 生成：问题编号/层级/意图标签/问题/豆包分享链接，104 题各 1 行，无需并入跨轮测试链接

- `v1.0.0`（2026-08-10）：当前已安装 skill `Doubao Crawler_Web_single` 的首次完整快照。
  - 建立版本管理：新增 `versions.md` 与 `v1.0.0/` 快照目录
  - Web 默认链路：浏览器自动提问（快速/专家/工作任务 Turbo/工作任务 Pro）+ 回答稳定判定 + 公开 thread 分享创建与解析
  - 默认每题提问 1 次、题间随机 60-100 秒、创建公开分享、导出 CSV/Excel、每问题生成一份字段地图
  - 新增“问题 → 分享链接”Excel（`share-links.xlsx`，含轮次与提问时间）
  - 分享创建失败或快照解析失败严格标记：`thread_link_failed` / `thread_parse_failed`
  - 输出目录自动版本化（`-v2`、`-v3`），不覆盖旧测评
  - 支持 `--resume`、`--repair-shares`、`--capture-threads`、`--plan-order round|question`
  - 采集前确认 10 项、Web preflight、竞品未提供时自动推断（启发式）、移动端同步采集
  - 原始数据记录提问/完成/采集时间，分享快照落盘前脱敏
