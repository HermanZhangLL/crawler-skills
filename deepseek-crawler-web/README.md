# DeepSeek Crawler Web

`deepseek-crawler-web` 是一个 **DeepSeek 网页端 AI 搜索重复采样与 GEO 概率分析 Skill**。它通过 OpenCLI Browser Bridge 自动操作已登录的 DeepSeek 网页会话完成提问 → 创建分享链接 → 结构自适应拉取链接数据 → 统一存储 → 生成概率分析报告的完整链路。

它不是通用网站爬虫，也不调用 DeepSeek API。

英文说明：[README.en.md](README.en.md) · 版本记录：[CHANGELOG.md](CHANGELOG.md)

## 核心链路

```text
1. 自动化操作软件    OpenCLI 驱动已登录的 DeepSeek 网页会话（后台窗口，不抢焦点）
                     deepseek ask --new --keep-tab --site-session persistent --window background
                     回答完成后用页面域名 + prompt + 回答 SHA-256 做 DOM 指纹校验
2. 收集链接          自动创建公开分享 share/create，拿到结构化分享链接
3. 链接数据获取      结构自适应：先分析链接 JSON 的数据结构（消息数组、角色字段、
                     引用数组及其字段别名），再按探测结果抽取，归一到统一 schema；
                     结构指纹写入样本留档，平台改版时可审计漂移，不写死字段
4. 统一存储          deepseek-crawl.json 规范数据集 + raw/*.json 证据 +
                     CSV/SQLite 数据表 + 问题→分享链接 Excel + 字段地图 HTML
5. 分析与报告        混合 NER 实体识别 + 可选 AI 语义复核 + Markdown/Excel/HTML 报告
```

## 技术路线

- **网页端适配而非 API**：直接复用你已登录的 DeepSeek 网页会话，采集到的是用户真实看到的回答与信源，与 API 通道的结果分布不同。
- **OpenCLI deepseek 适配字段**：`deepseek ask/status/whoami/history/login` 原生子命令，支持 `--model instant|expert|vision`、`--think`（深度思考）、`--search`（联网）、`--window background`（后台窗口）、`--site-session persistent`、`--keep-tab`。
- **分享接口直连**：回答完成后走 `share/create → share/content` 公开接口拉取完整结构化数据（回答正文、引用列表、信源、token 用量、搜索开关），不依赖浏览器标签页绑定。
- **结构自适应链接数据采集**：DeepSeek、豆包这类产品的回答数据结构一直在迭代，本 skill 不把字段路径写死。获取链接数据时先探测结构（消息数组在哪、角色/正文字段叫什么、引用数组及其 url/标题/摘要/序号/日期字段的别名），再按探测结果抽取；已知的 DeepSeek 结构作为高优先级候选加速匹配，探测失败回退已知结构，结构指纹随样本保存。
- **后台执行**：采集窗口默认 `background`，批量采集期间不打断你正常使用浏览器；需要观察过程时用 `--window-mode foreground` 切换。
- **证据优先**：每次采样保留原始回答、引用标题、URL、raw JSON 和执行日志，概率指标均为重复采样估计。

## 预安装软件

| 依赖 | 版本要求 | 用途 | 检查命令 |
|---|---|---|---|
| Node.js | **21+**（仅离线分析 18+） | 运行采集与编排脚本 | `node --version` |
| Python | **3.10+** | 聚合分析与报告渲染 | `python3 --version`（Windows 用 `python`） |
| OpenCLI CLI | **1.8.4+**（本机实测 1.8.7） | 浏览器自动化与 deepseek 适配 | `opencli --version` |
| OpenCLI deepseek 适配 | 随 OpenCLI 内置；若无 `opencli deepseek` 子命令则装插件 | `deepseek ask/status/whoami/history` | `opencli deepseek --help` |
| OpenCLI Browser Bridge | Chrome/Edge 扩展已安装并连接 | 驱动浏览器 | `opencli doctor` |
| DeepSeek 账号 | 网页端已登录 | 提问与分享 | `opencli deepseek whoami -f json` |
| bash | 任意（Windows 用 Git Bash / WSL） | 执行 `run-tests.sh` 离线测试 | `bash --version` |
| OPENAI_API_KEY | 可选 | 分析阶段 AI 语义复核；没有时自动回退本地规则 | — |

一键预检：

```bash
node scripts/preflight.mjs --profile <opencli-profile>        # 真实采集前
node scripts/preflight.mjs --analysis-only                    # 只做离线分析
```

profile 未连接时，在 skill 目录执行 `node scripts/setup_deepseek_bridge.mjs`（只会打开 `https://chat.deepseek.com/`，不要使用其他项目里的 bridge setup 脚本）。

## 预设值与取舍

默认值以"**保证采得回来、数据可信**"为第一目标，效率让位于稳定性；追求速度时按下表调整。

| 预设项 | 默认值 | 取舍说明 | 如何调整 |
|---|---|---|---|
| 每题提问次数 | `5` | 次数越多概率越稳，耗时线性增长 | `--repeat <n>`（1-50） |
| 采样间隔 | 随机 `60-100 秒` | 压低风控风险；短测可缩短，长期采样建议加长 | `--delay-min/max-minutes`；`--safe-random-delay` = 5-20 分钟 |
| 单题超时 | `600 秒` | DeepSeek 联网回答常接近 600s 才返回，属慢速非卡死 | `--timeout 30-1200` |
| 快速完成判定 | 关闭 | 开启后单题约 30-60s（ask 只等 30s，随后轮询历史接口到完成），但依赖历史接口稳定性 | `--fast-ask` 或 `DEEPSEEK_FAST_ASK=1` |
| 计划顺序 | `round` 轮询 | 每轮全问题各问一次，时间分布均匀、抗平台波动 | `--plan-order question` 按题连续 |
| 分享链接 | 开启 | 拿到结构化引用的最可靠途径；关闭后引用只能靠 DOM 抽取（不可靠） | `--no-create-share` 关闭 |
| 窗口模式 | `background` | 不抢用户浏览器焦点 | `--window-mode foreground` |
| 模型模式 | `instant` 快速 | `expert` 更慢更稳，`vision` 看图 | `--model instant\|expert\|vision`；`--think` 深度思考 |
| 输出目录命名 | `YYYYMMDD_<实体>_deepseek_web` | 快速模式追加 `_fast`，深度思考追加 `_think` | `--out-dir` 最终为准 |
| 数据表/字段地图 | 关闭 | 开启会增加导出耗时 | `--store`、`--html-maps` |
| AI 语义复核 | `auto` | 有密钥时复核，失败回退本地规则 | 正式交付用 `--semantic-review required` |
| 分享批量并发 | `4` | 纯接口拉取，可适当加大 | `--concurrency 1-20` |
| 分享修复扫描 | `200` 条历史 | 补链不重问；会话多时加大 | `--history-limit <n>` |

## 快速开始

### 1. 创建问题清单 `questions.txt`（每行一个问句）

```text
新能源汽车推荐
豪华新能源SUV品牌推荐
哪个新能源电车品牌更靠谱
推荐一款靠谱的新能源汽车品牌
```

### 2. 采集前检查

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

### 3. 第一阶段：批量采样

```bash
node scripts/deepseek_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "蔚来" \
  --target-aliases "蔚来ES8,蔚来ES6,蔚来EC6,NIO" \
  --entity-type product \
  --safe-random-delay \
  --out-dir runs/nio-nev
```

先加 `--dry-run` 可只生成计划、不打开 DeepSeek。输出：`deepseek-crawl.json`（聚合数据集）、`raw/*.json`（单样本证据，含 `share`、`share_meta`、`structure` 结构指纹）、`logs/*.log`。

### 4. 第二阶段：分析与报告

```bash
python3 scripts/analyze_deepseek_results.py \
  runs/nio-nev/deepseek-crawl.json \
  --target-entity "蔚来" \
  --target-aliases "蔚来ES8,蔚来ES6,蔚来EC6,NIO" \
  --entity-type product \
  --brands-file brands.txt \
  --semantic-review auto \
  --out-dir runs/nio-nev/report
```

`brands.txt` 用于人工校准竞品口径，格式 `实体|别名A|别名B`。标准报告必须给 `--target-entity` 和 `--entity-type`（`person/人`、`company/公司`、`product/产品`）。

输出：`summary.json`、`structured-data.md`、`structured-data.xlsx`、`report.html`、`semantic-review-cache.json`（如产生）。

## 分享链接数据采集（结构自适应）

**场景 A — 采集时自动携带**：默认 `--create-share`，每次回答完成后自动创建分享并拉取结构化数据，无需额外操作。

**场景 B — 只有现成分享链接**：

```bash
node scripts/deepseek_share_batch.mjs \
  --links share_links.txt \
  --target-entity "新东方" \
  --entity-type company \
  --store --html-maps \
  --out-dir runs/deepseek-shares
```

**场景 C — 先分析链接数据结构**（平台改版、字段对不上、或想先看看数据长什么样时）：

```bash
node scripts/deepseek_share_probe.mjs --link "https://chat.deepseek.com/share/<id>"
node scripts/deepseek_share_probe.mjs --input saved-share.json     # 离线分析本地 JSON
```

输出结构探测报告：消息数组路径、角色/正文/状态字段、引用数组位置、各字段别名命中情况、结构指纹与置信度，以及按探测结果抽取的统一 schema 预览。抽取结果中的 `structure` 字段会随每个样本保存，用于跨版本审计数据结构漂移。

**场景 D — 采集后补链**（缺 share 的样本不重问，按问题/回答匹配已有会话补建分享）：

```bash
node scripts/deepseek_repair_shares.mjs \
  --dataset runs/my-deepseek-run/deepseek-crawl.json \
  --profile <opencli-profile> --store --html-maps
```

分享样本的边界：缺少具体模型版本、真实生成时间、搜索子查询原文；`inserted_at` 更接近分享导出时间。正式概率报告以网页端实时采样为准，分享样本用于补录和复核。

## 离线验证

```bash
bash scripts/run-tests.sh
```

覆盖：全部脚本语法检查、参数解析与 DOM 校验回归、分享解析与结构自适应探测测试、繁转简测试、实体识别回归、fixture 数据集端到端分析断言。

## 运行边界

- 不处理 DeepSeek 登录、验证码、Cloudflare、人机校验、账号风控或平台限制绕过。
- 概率指标是重复采样估计，不代表真实市场份额或平台官方排名。
- 竞品实体识别优先使用用户提供的别名表；自动识别候选建议人工复核，正式报告建议 `--semantic-review required`。
- AI 语义复核是可选增强，不覆盖硬规则、正文证据要求或原始日志审计。
- 真实采集会操作浏览器访问 DeepSeek 网页端，请遵守目标网站规则和账号使用限制。

## 目录结构

```text
SKILL.md                        路由触发与工作流骨架
README.md / README.en.md        本说明 / 英文说明
CHANGELOG.md                    版本记录
manifest.json                   元数据（版本、依赖、输出契约）
agents/interface.yaml           接口声明
evals/                          触发用例与预期产物
references/
  user-setup-and-usage.md       安装前置与用户运行手册
  deepseek-crawl-workflow.md    采集配置、延迟、续采、修复规则
  report-contract.md            JSON 合约与指标定义
scripts/
  preflight.mjs                 依赖与登录状态检查
  setup_deepseek_bridge.mjs     DeepSeek 专用 Browser Bridge 连接助手
  geo-deepseek-browser-direct.mjs   单题问答与引用证据采集入口
  deepseek_batch_crawl.mjs      重复采样编排
  deepseek_share_batch.mjs      分享链接批量汇总
  deepseek_share_probe.mjs      分享链接数据结构探测（结构自适应）
  deepseek_repair_shares.mjs    缺失分享补建
  deepseek_export_store.mjs     CSV/SQLite/字段地图导出
  analyze_deepseek_results.py   聚合分析与 HTML 渲染
  lib/share-structure.mjs       链接数据结构探测与自适应抽取
  lib/share-utils.mjs 等        分享解析、数据表写入、HTML 渲染公共模块
  test_*.mjs / test_*.py        回归测试
  run-tests.sh                  离线验证入口
templates/                      采集前问卷与简报模板
fixtures/                       离线测试样例数据
```

## 相关文档

- [references/user-setup-and-usage.md](references/user-setup-and-usage.md) — 安装、排错、证据与隐私
- [references/deepseek-crawl-workflow.md](references/deepseek-crawl-workflow.md) — 采集规则、延迟、续采、混合分享模式
- [references/report-contract.md](references/report-contract.md) — 数据 JSON 合约与指标定义
