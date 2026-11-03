# User Setup And Usage

本指南面向刚安装 `yuanbao-crawler-web`、希望运行真实腾讯元宝网页端采集的用户。

## 本 Skill 需要什么

真实采样需要本地浏览器自动化。Skill 不负责安装 OpenCLI、登录腾讯元宝、处理验证码或绕过账号风控。

真实采样要求：

- Node.js 21+
- Python 3.10+
- OpenCLI CLI 1.8.6+，命令为 `opencli`
- OpenCLI Browser Bridge 已连接 Chrome 或 Edge profile
- 该 profile 中腾讯元宝网页端已登录且能发送消息
- 需要来源分析时，腾讯元宝回答中需要出现可见链接（联网搜索默认开启）
- 本 Skill 自带的采集器：`scripts/yuanbao_browser_crawl.mjs`；若使用兼容替代脚本，请传 `--crawler-script <file>` 或设置 `YUANBAO_CRAWLER_SCRIPT`

仅分析已有数据时要求：

- Node.js 18+
- Python 3.10+
- 已有 `yuanbao-crawl.json` 或兼容的腾讯元宝原始 JSON
- 如需 AI 语义复核，可设置 `OPENAI_API_KEY`；不设置时 `--semantic-review auto` 会回退到本地规则

## 1. 运行预检

在 Skill 目录下执行：

```bash
node scripts/preflight.mjs --profile <opencli-profile>
```

若采集器不在默认路径：

```bash
node scripts/preflight.mjs \
  --profile <opencli-profile> \
  --crawler-script /absolute/path/to/yuanbao_browser_crawl.mjs
```

仅分析已有 JSON 时：

```bash
node scripts/preflight.mjs --analysis-only
```

## 2. 准备问题

标准报告需要以下输入：

1. 关键词/问题：一个或多个腾讯元宝问题
2. 轮询次数：每个问题采样多少次（默认 1 次）
3. 目标实体：要诊断的实体，例如新东方、某人名或某产品
4. 实体类型：人、公司或产品
5. OpenCLI profile：已连接的 Browser Bridge profile
6. 单次查询间隔：默认随机 60-100 秒；可选 `--safe-random-delay`（5-20 分钟）或自定义
7. 可选别名/竞品表：人工复核过的目标别名和同类型竞品

创建 `questions.txt`，每行一个问题：

```text
出国留学公司推荐
出国留学机构
出国留学机构哪家好
出国留学公司哪家好
出国留学哪家靠谱
```

也支持 JSON：

```json
[
  {"id": "q01", "question": "出国留学公司推荐", "repeat": 5},
  {"id": "q02", "question": "出国留学机构", "repeat": 5}
]
```

## 3. 准备目标实体别名

标准报告需要目标实体和实体类型。别名让 Top 1 / Top 3 / Top 5、提及率和平均排名更稳定。

目标匹配使用包含逻辑加别名。例如目标实体 `新东方` 可以合并 `新东方前途出国` 和 `前途出国`。短拉丁别名如 `AI`、`GEO` 只匹配独立词，不匹配 `PallasAI`、`GEOFlow` 这类长名内部。

`brands.txt` 示例（公司）：

```text
启德教育|启德留学|启德
新东方前途出国|新东方|前途出国
指南者留学|指南者
优越留学|优越教育
```

如果没有提供别名/竞品表，分析器会从回答结构中推断同类型候选实体，并把结果标记为推断/低置信度。推断结果只用于探索，不用于正式交付。

## 4. 预演

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --entity-type company \
  --out-dir runs/my-yuanbao-run \
  --dry-run
```

预演只校验计划和目标字段，不打开腾讯元宝。

## 5. 真实采样

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --target-aliases "新东方前途出国,前途出国" \
  --entity-type company \
  --out-dir runs/my-yuanbao-run \
  --safe-random-delay \
  --timeout 300
```

- 每个样本会先 `opencli yuanbao new` 新建会话，再 `opencli yuanbao ask` 提问，最后 `opencli yuanbao status` 记录会话 URL 和模型信息
- 回答完成后自动创建会话公开分享链接（分享接口优先，页面按钮兜底），并从公开页面解析完整引用、媒体、模型和时间戳（默认开启；`--no-create-share` 关闭）
- 每问题默认生成一份数据字段地图 HTML（取第一份有效样本）；`--no-field-maps` 关闭
- 默认开启联网搜索；需要关闭时加 `--no-search`
- 快速模式为默认（`--model quick`）；可选专家模式 `--model expert`、Vision 模式 `--model vision`；深度思考加 `--think`（回答更长、耗时更高）。元宝适配器限制：expert 近似为深度思考，vision 暂按快速模式并记录警告
- 5 个问题各 5 次 = 25 个样本、24 次等待；默认间隔预计等待约 24-40 分钟，`--safe-random-delay` 约 2-8 小时

自定义随机间隔：

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --entity-type company \
  --out-dir runs/my-yuanbao-run \
  --delay-min-minutes 5 \
  --delay-max-minutes 20
```

采集器在 Skill 外部时：

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --entity-type company \
  --crawler-script /absolute/path/to/yuanbao_browser_crawl.mjs \
  --out-dir runs/my-yuanbao-run
```

输出：

- `runs/my-yuanbao-run/yuanbao-crawl.json`
- `runs/my-yuanbao-run/raw/*.json`
- `runs/my-yuanbao-run/logs/*.log`
- `runs/my-yuanbao-run/field-maps/<question_id>-data-map.html`（每问题一份，默认开启，`--no-field-maps` 关闭）
- `runs/my-yuanbao-run/store/yuanbao-samples.csv`、`yuanbao-references.csv`、`yuanbao-samples.db`（默认开启，`--no-store` 关闭）
- `runs/my-yuanbao-run/store/share-links.xlsx`（问题→分享链接登记表，含轮次；`--no-share-links-excel` 关闭）

保持单线程采集，一次只跑一个采集任务；一次采集固定同一账号，切换账号可能导致旧分享链接失效。输出目录默认自动命名，若目录已有旧版本会自动追加 `-v2/-v3`，旧版本保留，不覆盖。

## 5.3 把会话归入指定“对话分组”（可选）

元宝网页端有“对话分组”（文件夹）功能。如果希望每个问题的新会话都落在某个分组里（例如按项目/批次管理），先在该账号的元宝网页端创建好分组，然后在启动批量采集时设置环境变量：

```powershell
$env:YUANBAO_GROUP = "0818 营销104个问题"
node scripts/yuanbao_batch_crawl.mjs --questions questions.txt --repeat 1 --profile <profile> --out-dir runs/my-yuanbao-run
```

行为与已验证的经验：

- 每个样本仍然先在默认区新建会话、提问、生成分享链接，最后才移入分组。移动发生在分享之后，因为分享匹配依赖默认侧边栏；先移动会导致“no matching conversation found in sidebar”。
- 移动使用元宝网页端官方接口 `POST /api/user/agent/conversation/move`（`agent_id`、`source_cid`、`target_project_id`），projectId 由采集器从侧边栏分组元素的 `data-project-id` 自动解析（32 位十六进制）。已在分组中的会话重复移动返回 `code 21006 项目id重复`，幂等视为成功。
- 不要在分组页面的输入框直接提问：分组内已有会话时，分组页发消息会续接最近一条会话，不会为每个问题新建会话（只有空分组才会新建）。所以“点分组→发消息”不能替代“默认区提问+移入分组”。
- 会话 ID 是短字母数字（如 `0PiSKR4x5Wa`），不是 36 位 UUID；采集器已按短 ID 处理，排查时不要再按 UUID 校验。
- 验证归属：运行后查看每个样本 raw JSON 的 `group_move` 字段（`ok: true, skipped: false`），或调用 `/api/user/agent/conversation/list` 看 `projectId`；不要只靠页面侧边栏判断（侧边栏只渲染可见窗口，分组页列表可能混入最近会话）。
- 大批次建议：先跑 2–3 题试点，确认“分享链接 + 归组”都成功再全量；全量用 `--resume` 续跑。

## 5.5 公开分享链接采集（无需登录）

如果你已有元宝分享短链（`https://yb.tencent.com/s/<shareId>`），可直接批量解析，不需要浏览器：

```bash
node scripts/yuanbao_share_batch.mjs \
  --links share_links.txt \
  --target-entity "新东方" \
  --entity-type company \
  --out-dir runs/my-yuanbao-shares
```

- `share_links.txt`：每行一个分享链接，或 JSON 数组
- 每条分享生成一个样本，`transport: yuanbao-share-public`
- 默认生成每问题数据字段地图（`--no-field-maps` 关闭）
- 公开分享页内嵌 `__NEXT_DATA__`，可解析问题、回答全文、引用、媒体、模型与时间戳

## 6. 中断续跑

中断后重跑同一命令并加 `--resume`：

```bash
node scripts/yuanbao_batch_crawl.mjs \
  --questions questions.txt \
  --repeat 5 \
  --profile <opencli-profile> \
  --target-entity "新东方" \
  --entity-type company \
  --out-dir runs/my-yuanbao-run \
  --resume
```

`--resume` 只复用满足条件的 raw JSON：有效、`ok=true`、有回答文本、问题与当前计划一致。

## 7. 生成报告

```bash
python3 scripts/analyze_yuanbao_results.py \
  runs/my-yuanbao-run/yuanbao-crawl.json \
  --target-entity "新东方" \
  --target-aliases "新东方前途出国,前途出国" \
  --entity-type company \
  --brands-file brands.txt \
  --semantic-review auto \
  --title "腾讯元宝 AI 搜索概率分析报告" \
  --out-dir runs/my-yuanbao-run/report
```

输出：

- `runs/my-yuanbao-run/report/summary.json`
- `runs/my-yuanbao-run/report/structured-data.md`
- `runs/my-yuanbao-run/report/structured-data.xlsx`
- `runs/my-yuanbao-run/report/report.html`
- `runs/my-yuanbao-run/report/semantic-review-cache.json`（AI 语义复核产生可缓存结果时）

语义复核模式：

- `--semantic-review auto`（默认）：有 `OPENAI_API_KEY` 时用 AI；否则回退本地规则并记录 `semantic_review_status: fallback`
- `--semantic-review required`：正式交付时强制 AI 复核，AI 不可用则失败
- `--semantic-review off`：只用本地规则
- `--semantic-confidence-threshold 0.72`：AI 直连竞品的最低置信度

标准实体类型：`person/人`、`company/公司`、`product/产品`。

## 8. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `opencli: command not found` | OpenCLI 未安装或不在 PATH | 安装 OpenCLI 并验证 `opencli --version` |
| `No Browser Bridge profiles connected` | 浏览器扩展未连接 | 打开已启用 OpenCLI Browser Bridge 的 Chrome/Edge profile，再 `opencli profile list` |
| `Browser profile ... is not connected` | 所选 profile 离线 | 用 `opencli profile list` 选择已连接 profile |
| `logged_in: false` | 腾讯元宝未登录 | 在浏览器中登录腾讯元宝，再 `opencli yuanbao whoami -f json` |
| `references.count = 0` | 搜索关闭、回答无外链或页面 DOM 变化 | 确认联网搜索开启，重跑单个样本并查看 raw/log |
| `share.find_error: no matching conversation found in sidebar` | 会话已移入分组，默认侧边栏为空；或使用旧版脚本 | 确认使用 v0.3.0+ 脚本（会改用 `yuanbao status` 的会话 URL 直接创建分享）；升级后重跑失败样本 |
| `group_move.ok: false / 分组未生效` | 分组名不存在、账号未登录、或 projectId 解析失败 | 确认分组已在网页端创建且侧边栏可见；查看 raw JSON 的 `group_move.error` 定位 |
| 分享链接内容不是本问题（是上一条问题） | `yuanbao new` 未真正跳转新会话，问题被追加进上一条会话 | 按“链接校验与修复”流程：定位单题会话、重建分享链接、更新 raw JSON（v0.3.2+ 文档有完整步骤） |
| 多个样本连续失败 | 浏览器桥、账号限流、腾讯元宝页面不稳定或平台风控 | 停止运行、等待后重试，用 `--safe-random-delay` 或更宽随机间隔，加 `--resume`，查看失败日志 |

## 证据与隐私

运行目录保存原始腾讯元宝回答、来源标题、URL、会话 URL 和日志，请作为审计证据保管。若问题、回答或来源包含私密或客户敏感信息，不要对外发布或提交。
