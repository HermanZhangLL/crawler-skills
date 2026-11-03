# yuanbao-crawler-web

`yuanbao-crawler-web` 是一个腾讯元宝网页端 AI 搜索重复采样与 GEO 概率分析 Skill。它借助本地 OpenCLI Browser Bridge 和已登录的腾讯元宝网页会话，对用户给定的一组关键词进行多轮独立采样，保存原始证据，并生成结构化 Markdown、Excel 和 HTML 可视化诊断报告。

## 核心链路

```text
1. 自动化操作软件    OpenCLI 驱动已登录的元宝网页会话，每样本独立新会话提问
                     yuanbao ask --new（自带 yuanbao 站点适配器），默认联网搜索
2. 收集链接          每个样本生成公开分享链接（yb.tencent.com/s/<id>）；
                     先分享、后归入"对话分组"（YUANBAO_GROUP，走官方移动接口）
3. 链接数据获取      结构自适应：先探测 __NEXT_DATA__ 载荷结构（chat 载荷路径、
                     speaker 字段、speech 容器、内容块与 docs 别名），再按探测结果
                     抽取问题/回答/引用/媒体，归一到统一 schema；结构指纹随样本保存
4. 统一存储          yuanbao-crawl.json 规范数据集 + raw/*.json + CSV/SQLite +
                     share-links.xlsx + 每题数据字段地图 HTML
5. 分析与报告        实体识别 + 同类型竞品对比 → Markdown/Excel/HTML 四件套
```

## 技术路线

- **网页端适配而非 API**：复用已登录的元宝网页会话，采集用户真实看到的回答与信源。
- **OpenCLI yuanbao 适配器**：`yuanbao ask/status/...` 站点适配随 OpenCLI 内置（1.8.6+），支持 `--think` 深度思考、联网搜索开关。
- **分享接口直连**：回答完成后创建公开分享，`analyze_yuanbao_share.mjs` 免登录抓取分享页 `__NEXT_DATA__` 解析结构化数据。
- **结构自适应链接数据采集**：元宝分享页是 Next.js `__NEXT_DATA__` 载荷，`chat` 载荷路径与字段名会随版本迭代。探测器（`scripts/lib/yuanbao-share-structure.mjs`）先尝试已知路径（`props.pageProps.fullChatShareData`）作高优先级候选，再全 payload 扫描结构匹配的对象；speaker/speech/内容块/docs 字段按值模式与结构识别（含改名回退），结构指纹与置信度（high/medium/low/none）随每个样本的 `structure` 字段保存，平台改版可审计漂移、不静默产出空数据。
- **后台执行**：采集窗口可配置，不抢用户日常浏览器焦点。
- **证据优先**：每题保留 raw JSON、引用标题、URL、日志；概率指标均为重复采样估计。

## 预安装软件

| 依赖 | 版本要求 | 用途 | 检查命令 |
|---|---|---|---|
| Node.js | **21+**（仅离线分析 18+） | 运行采集与编排脚本 | `node --version` |
| Python | **3.10+** | 聚合分析与报告渲染 | `python --version` |
| OpenCLI CLI | **1.8.6+**（自带 yuanbao 站点适配器） | 浏览器自动化 | `opencli --version` |
| OpenCLI Browser Bridge | Chrome/Edge 扩展已连接 | 驱动浏览器 | `opencli doctor` |
| 腾讯元宝账号 | 网页端已登录 | 提问与分享 | `node scripts/preflight.mjs --profile <p>` |
| bash | 任意（Windows 用 Git Bash / WSL） | 执行测试脚本 | `bash --version` |
| OPENAI_API_KEY | 可选 | AI 语义复核；缺省回退本地规则 | — |

一键预检：`node scripts/preflight.mjs --profile <opencli-profile>`（真实采集前）；`--analysis-only`（只做离线分析）。

## 预设值与取舍

默认值以"**采得回来、链接可信、不触发风控**"为第一目标；效率让位于稳定性。

| 预设项 | 默认值 | 取舍说明 | 如何调整 |
|---|---|---|---|
| 每题次数 | `1` | 每样本独立新会话，重复成本高 | `--repeat <n>` |
| 题间间隔 | 随机 60-100 秒 | 压低风控风险 | `--delay-min-ms/--delay-max-ms`、`--safe-random-delay` |
| 联网搜索 | 开启 | GEO 测评需要信源 | `--no-search` |
| 深度思考 | 关闭 | `--think` 更慢更贵 | `--think` |
| 分享链接 | 按需 | 分享是结构化数据权威来源；分享页免登录可解析 | 采集时生成或事后用 share 批量 |
| 分组归置 | 关闭 | 需已有元宝"对话分组"；先分享后归组 | `YUANBAO_GROUP=<分组名>` |
| 数据表/字段地图 | 按需 | 增加导出耗时 | `--store`、`--html-maps` |
| AI 语义复核 | `auto` | 有密钥时复核，失败回退本地规则 | 正式交付用 `--semantic-review required` |

## 它能做什么

- 每个样本都在独立的新会话中提问，避免上下文串扰
- 默认开启联网搜索，支持快速模式与深度思考（`--think`）
- 可选把每个新会话归入元宝“对话分组”（设置 `YUANBAO_GROUP=<分组名>`，先分享后归组，走官方移动接口）
- 保存原始回答、引用来源、会话 URL 和逐样本日志
- 输出目标实体提及率、Top 1 / Top 3 / Top 5 概率、平均提及、情感倾向、信源与标题结构
- 支持同类型竞品对比（人、公司、产品三种口径）
- 输出 JSON、Markdown、Excel、HTML 四种交付物

## 环境要求

- Node.js 21+（分析已有 JSON 时 18+ 即可）
- Python 3.10+
- OpenCLI CLI 1.8.6+（自带 `yuanbao` 站点适配器）
- OpenCLI Browser Bridge 已连接 Chrome 或 Edge profile
- 腾讯元宝网页端已登录

## 安装

把本目录放到 Codex skills 目录（例如 `C:\Users\Herman\.codex\skills\yuanbao-crawler-web`），重新打开 Codex 会话即可被识别。

## 快速开始

### 1. 准备输入

`questions.txt`，每行一个问题：

```text
出国留学公司推荐
出国留学机构哪家好
出国留学公司哪家好
```

也可用 JSON 数组（支持每题独立 repeat/target）：

```json
[
  {"id": "q01", "question": "出国留学公司推荐", "repeat": 5},
  {"id": "q02", "question": "出国留学机构", "repeat": 5}
]
```

### 2. 预检

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

### 3. 批量采样

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --target-aliases "新东方前途出国,前途出国" \
  --entity-type company \
  --safe-random-delay \
  --out-dir runs/my-yuanbao-run
```

- 默认间隔：随机 60-100 秒
- 更安全模式：`--safe-random-delay`（随机 5-20 分钟）
- 快速模式为默认；深度思考加 `--think`
- 每次回答后自动创建会话公开分享链接（分享接口优先，页面按钮兜底）；默认导出 CSV/SQLite 数据表和“问题→分享链接”Excel，支持 `--model quick|expert|vision`，并从公开页面解析完整引用、媒体、模型和时间戳（默认开启；`--no-create-share` 关闭）
- 分组采集：`$env:YUANBAO_GROUP = "分组名"` 后运行同一命令，每个新会话在分享完成后自动移入该分组（v0.3.0+）
- 中断续跑：重跑同一命令并加 `--resume`
- 预演：加 `--dry-run` 只生成计划，不打开腾讯元宝

输出：

```text
runs/my-yuanbao-run/yuanbao-crawl.json
runs/my-yuanbao-run/raw/*.json
runs/my-yuanbao-run/logs/*.log
runs/my-yuanbao-run/batch.log
runs/my-yuanbao-run/field-maps/<question_id>-data-map.html
```

字段地图默认开启：每个问题生成一份 HTML 数据字段地图（取第一份有效样本）；`--no-field-maps` 可关闭。

### 3.5 公开分享链接采集（无需登录）

如果你已有元宝分享短链（形如 `https://yb.tencent.com/s/<shareId>`），可以直接批量解析，不需要浏览器：

```bash
node scripts/yuanbao_share_batch.mjs   --links share_links.txt   --target-entity "新东方"   --entity-type company   --out-dir runs/my-yuanbao-shares
```

`share_links.txt` 每行一个分享链接。每条分享生成一个样本（`transport: yuanbao-share-public`），并默认生成每问题数据字段地图。公开分享页内嵌 `__NEXT_DATA__`，可解析问题、回答全文、引用、媒体、模型与时间戳。

### 4. 生成报告

```bash
python3 scripts/analyze_yuanbao_results.py \
  runs/my-yuanbao-run/yuanbao-crawl.json \
  --target-entity "新东方" \
  --target-aliases "新东方前途出国,前途出国" \
  --entity-type company \
  --brands-file brands.txt \
  --semantic-review auto \
  --out-dir runs/my-yuanbao-run/report
```

输出：

- `report/summary.json`
- `report/structured-data.md`
- `report/structured-data.xlsx`
- `report/report.html`
- `report/semantic-review-cache.json`（AI 语义复核可用时）

## 别名/竞品表格式

```text
目标实体|目标别名A|目标别名B
同类型竞品A|竞品别名A
同类型竞品B
```

## 测试

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-tests.ps1
```

macOS/Linux：

```bash
bash scripts/run-tests.sh
```

## 目录结构

- `SKILL.md`：Skill 触发与执行说明
- `scripts/yuanbao_browser_crawl.mjs`：单次腾讯元宝问答与引用证据采集
- `scripts/yuanbao_batch_crawl.mjs`：重复采样编排（随机间隔、resume、轮询顺序、字段地图）
- `scripts/yuanbao_share_batch.mjs`：公开分享链接批量采集
- `scripts/analyze_yuanbao_share.mjs`：分享页 `__NEXT_DATA__` 解析与归一化
- `scripts/render_yuanbao_field_maps.mjs`：单问题数据字段地图 HTML 渲染
- `scripts/preflight.mjs`：采集前环境预检
- `scripts/analyze_yuanbao_results.py`：聚合分析与 HTML 渲染
- `references/`：工作流、用户手册、报告契约
- `fixtures/sample-yuanbao-crawl.json`：离线分析测试样例
- `templates/`：采集前确认单与需求 brief

## 边界与说明

- 本 Skill 只做腾讯元宝网页端可见内容的低频率采集，不绕过登录、验证码、限流或平台风控
- 腾讯元宝 OpenCLI 适配器不提供公开分享命令；但 `yb.tencent.com/s/<shareId>` 公开分享页可直接解析，分享链接采集无需登录
- 自动分享为默认行为；若页面结构变化导致分享创建失败，直采样本引用可能为 0，此时可手动提供公开分享链接
- 引用证据优先取已验证的浏览器 DOM 链接，失败时回退到回答正文中的链接；缺失字段属于平台可见性限制
- 概率指标是重复采样估计，不是官方排名或市场份额
