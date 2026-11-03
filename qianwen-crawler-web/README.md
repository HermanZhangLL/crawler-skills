# Qianwen Crawler Web

`qianwen-crawler-web` 是一个 **千问（www.qianwen.com）网页端 AI 搜索重复采样 Skill**。它通过 OpenCLI Browser Bridge 自动操作已登录的千问网页会话完成提问 → 记录会话链接 → 分组归置 → 分组枚举 → 链接校验 → 交付出表的完整链路，用于 GEO 测评的问题级链接证据收集。

它不是通用网站爬虫，也不调用千问 API。

版本记录：[CHANGELOG.md](CHANGELOG.md)

## 核心链路

```text
1. 自动化操作软件    OpenCLI 驱动已登录的千问网页会话逐题提问
                     qwen ask --new，记录回答正文与 chat_url/session_id
2. 收集链接          千问无公开分享接口：以账号内会话 URL 为链接证据
3. 分组归置          采集后通过网页 UI 把会话拖入指定"分组"（文件夹）
                     先落盘 raw、再移入分组；归组后会话从"最近对话"消失属正常
4. 链接权威来源      分组枚举（data-session-id）是唯一可信链接来源；
                     分组里的会话=真实可用，不在分组的地址=有问题
5. 校验与出表        逐条打开 /chat/<sid> 确认页面含该问题（防静默跳转假链接），
                     校验通过后再出交付 CSV，--emit-missing 直接产出补问清单
```

## 技术路线

- **网页端适配而非 API**：复用你已登录的千问网页会话，采集用户真实看到的回答。
- **链接证据分级**：`qwen status` 的 `chat_url` 经常无效（拒答/未落库会话会给不存在的 session id），因此 raw 链接默认不进交付表；**分组枚举结果是唯一权威链接来源**（可用 `--allow-raw-fallback` 显式回退做诊断）。
- **校验防误杀**：会话不存在时千问静默跳回 `/chat`，脚本记为 `redirected_to_new_chat`；失败自动重试（默认 2 次）避免"页面没加载完"的假阴性。
- **风控熔断**：连续失败（默认 3 次）自动冷却（默认 20 分钟），连片无应答先冷却再续。
- **证据优先**：每题保留 raw JSON（回答正文、session_id、chat_url、耗时），成功判定以 raw 为准，且必须看回答内容（账号限流时千问会对任何问题回同一句固定文案，`ok=true` 不等于采集成功）。

## 预安装软件

| 依赖 | 版本要求 | 用途 | 检查命令 |
|---|---|---|---|
| Node.js | **18+** | 运行采集与校验脚本 | `node --version` |
| Python | **3.10+** | 链接出表（`qianwen_build_links_table.py`） | `python --version` |
| OpenCLI CLI | **1.8.4+** | 浏览器自动化与 qwen 适配 | `opencli --version` |
| OpenCLI Browser Bridge | Chrome/Edge 扩展已连接；**扩展版本影响 qwen ask 可用性**（v1.0.15~v1.0.22 不可用，v1.0.24+ 正常） | 驱动浏览器 | `opencli doctor` |
| 千问账号 | 网页端已登录 | 提问 | `opencli qwen status` |
| bash | 任意（Windows 用 Git Bash / WSL） | 执行测试脚本 | `bash --version` |

一键预检：

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

千问需已登录，且**不要与 DeepSeek/豆包/元宝共用同一浏览器 profile 并发运行**。

## 预设值与取舍

默认值以"**采得回来、链接可信**"为第一目标；效率让位于稳定性。

| 预设项 | 默认值 | 取舍说明 | 如何调整 |
|---|---|---|---|
| 每题次数 | `1` | 千问会话落库较慢，重试会留下多条会话 | `--repeat <n>` |
| 题间间隔 | 随机 `60-100 秒` | 实测 40-60 秒可用但偏快，出现无应答时拉长或冷却 | `--delay-min-ms/--delay-max-ms` |
| 单题超时 | `600 秒` | 千问偶发 300s 超时（页面未答/答得慢） | `--timeout <秒>` |
| 风控熔断 | 连续失败 3 次 → 冷却 20 分钟 | 防账号限流；限流时千问回固定拒答文案 | `--pause-after-fails`/`--pause-minutes`；`--no-circuit-breaker` 关闭 |
| 深度模式 | `--think`/`--research` 关闭 | 慢且贵，默认走联网问答 | 显式开启 |
| 链接来源 | 分组枚举（唯一权威） | raw chat_url 实测 104 条中 69 条无效 | `--allow-raw-fallback` 仅诊断用 |
| 出表去重 | 默认不去重 | 用户要求"有结果的链接都留下" | `--all-links` 同题多会话各占一行 |
| 校验重试 | 2 次 | 防"页面没加载完"假阴性 | `--retries <n>` |
| 输出目录 | `runs/<时间戳>` | 建议 `YYYYMMDD_<实体>_Qianwen104题_第N轮` | `--out-dir` |

## 快速开始

### 1. 采集前检查

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

### 2. 批量采样

```bash
node scripts/qianwen_batch_crawl.mjs \
  --questions questions.json \
  --repeat 1 \
  --profile <opencli-profile> \
  --target-entity <实体> \
  --entity-type product \
  --delay-min-ms 40000 --delay-max-ms 60000 \
  --timeout 600 \
  --pause-after-fails 3 --pause-minutes 20 \
  --out-dir runs/<轮次>
```

支持 `--resume`（续采）、`--dry-run`（只生成计划）。成功判定以 `raw/<样本号>.json` 为准。

### 3. 分组归置（先落盘 raw、再移入分组）

```bash
node scripts/qianwen_move_to_group.mjs --run-dir <run> --group "<分组名>" --profile <p>
```

### 4. 枚举分组（权威链接来源）

```bash
node scripts/qianwen_enumerate_group.mjs --group-url <分组URL> --out group.json --profile <p>
```

分组页每行带 `data-session-id`，行文本含"标题 + 问题 + 答案片段"，命中即证明会话真实存在。

### 5. 出表 + 校验 + 交付

```bash
python scripts/qianwen_build_links_table.py --group-json group.json --all-links \
  --questions questions.json --prefix <前缀> --group "<分组名>" --out-dir . \
  --emit-missing questions-missing.json

node scripts/qianwen_validate_links.mjs --table <前缀>.csv --out validate.json --profile <p>

# 校验通过后出交付版
python scripts/qianwen_build_links_table.py ... --validated validate.json
```

补问缺失题：用 `questions-missing.json` 重跑 batch（**新 out-dir**，避免 `--resume` 复用无效 raw），再回到第 3 步。

## 运行边界

- 不绕过登录/CAPTCHA；不调用隐藏 API 或网络流量抓取。
- 千问无公开分享链接；`chat_url` 仅供该账号内访问，且经常无效。
- `ok=true` 只代表拿到回答文本；账号限流时千问回固定拒答文案且会话仍落库，判定成功必须看回答内容。
- 千问前端虚拟列表只渲染可见行：分组枚举、批量归组都是"尽力而为"，脚本滚动重试并记录 `skipped`。
- 长清单（104 题）按每问 1-5 分钟预估总时长，建议分批 `--resume`。
- 概率类分析不在本 skill 范围（本 skill 交付链接证据表；分析用各平台 analyze 脚本另行处理）。

## 目录结构

```text
SKILL.md                          路由触发与工作流骨架
README.md                         本说明
CHANGELOG.md                      版本记录
manifest.json                     元数据（版本、依赖、输出契约）
references/
  qianwen-crawl-workflow.md       采集配置、延迟、续采、分组规则
  pre-run-confirmation.md         采集前确认清单
scripts/
  preflight.mjs                   依赖与登录状态检查
  qianwen_single.mjs              单题采集
  qianwen_batch_crawl.mjs         批量编排（续采/熔断/延迟）
  qianwen_move_to_group.mjs       分组归置（UI 拖拽）
  qianwen_enumerate_group.mjs     分组枚举（权威链接来源）
  qianwen_build_links_table.py    问题→链接出表（CSV/XLSX）
  qianwen_validate_links.mjs      逐条链接校验
  lib/opencli-command.mjs         OpenCLI 命令解析公共模块
```
