# Qianwen Crawl Workflow

## 能力来源

优先使用 opencli 内置 qwen 站点适配器（Browser Bridge 扩展自带 `clis/qwen`）：

```bash
opencli --profile <p> qwen status -f json     # 登录/会话/模型检查
opencli --profile <p> qwen ask "<问题>" --new true --timeout 300
```

`qwen ask` 支持：`--new`（新会话）、`--think`/`--research`（深度思考/深度研究）、`--markdown`。适配器基于 DOM 读取回答，默认 120s 超时。

### 适配器可用性（按扩展版本，务必先确认）

`qwen ask` 能不能用**取决于 Browser Bridge 扩展版本**，不是账号问题：

| 扩展版本 | 实测表现 |
|---|---|
| v1.0.15 ~ v1.0.22（opencli 1.8.6/1.8.7） | **不可用**：提交后恒定 600s 超时，`waitForAnswer` 读不到回答；即便页面已作答，返回的 `chat_url` 也可能是服务端不存在的 session id。9/11、9/14 两轮因此改用 DOM 路径自建采集器 |
| **v1.0.24**（2026-09-15 复测） | **恢复正常**：`qwen ask --new true` 8.3s 返回 User+Assistant 两条消息；`qwen status` 给出真实 `SessionId`，`qwen detail <sid>` 能读回同一会话 |

排查顺序：先 `opencli doctor` 看扩展版本，再 `qwen status -f json` 看登录态，最后用一条已知问题做 8-10 秒级的连通性探针。**扩展版本低于 v1.0.23 时不要走单题/批次路径**，改用项目目录里的 DOM 采集器（如 `qianwen_runner_v2.mjs`），它产出的 `raw/*.json` 字段与本 skill 兼容，后续归组/枚举/出表步骤可照用。

## 预检

```bash
node scripts/preflight.mjs --profile <p>
```

预检要求：Node 18+、Python 3.10+（表格/分析用）、opencli 1.8.4+、Browser Bridge 已连接、千问已登录（`qwen status` 的 Login 非 guest）。

## 单题采集

```bash
node scripts/qianwen_single.mjs --prompt "保定莲池区现在买房合适吗？" --id YX-L1-01-r01 \
  --profile <p> --timeout 600 --out raw/YX-L1-01-r01.json
```

输出 JSON：`{ok, question, answer, session_id, chat_url, model, error, asked_at, finished_at}`。`chat_url` 来自提问后 `qwen status`（当前会话 URL，如 `https://www.qianwen.com/chat/<session>`）。

- `--id <样本号>` 会把 `sample_id` / `question_id` 写进 raw；**批量场景必须带**，否则重复题干无法对齐。
- `session_id` 与 `chat_url` 任一缺失时会互相推导；两者都拿不到时该题视为失败，需重问。
- `ok=true` 只代表**拿到了回答文本**，不代表链接可用：模型答“我无法回答这个问题”这类拒答时，会话可能根本没落库，随后 `qwen status` 给出的 `chat_url` 打开会跳回 `/chat`。判定链接是否真的可用必须走 `qianwen_validate_links.mjs` 或分组枚举。

## 批次采集

```bash
node scripts/qianwen_batch_crawl.mjs \
  --questions yx-104-questions.json --repeat 1 --profile <p> \
  --target-entity 和光书苑 --entity-type product \
  --delay-min-ms 40000 --delay-max-ms 60000 --timeout 600 \
  --pause-after-fails 3 --pause-minutes 20 \
  --out-dir runs/main
```

- 每题默认 1 次；每个样本通过 `qwen ask --new true` 开新会话提问；默认超时 600s。
- 记录写入 `raw/<sample_id>.json`、`logs/<sample_id>.log`、数据集 `qianwen-crawl.json`。
- **成功判定以 `raw/<sample_id>.json` 为准**，不依赖子进程 stdout（stdout 解析失败曾把成功样本误记为 `no_result`）。
- 风控熔断：连续失败达 `--pause-after-fails`（默认 3）自动冷却 `--pause-minutes`（默认 20）分钟后继续；`--no-circuit-breaker` 关闭，totals 里的 `cooldowns` 记录冷却次数。
- `--resume` 跳过已有**有效** raw；`--dry-run` 只打印计划。
- 题间默认随机 60-100 秒；实测 **40-60 秒**可用但偏快，出现“提问后无应答”时应拉长或冷却。

## 链接来源与完成度判定（重要）

千问没有公开分享链接。`raw` 里的 `chat_url` 来自 `qwen status`（当前页地址），**经常无效**：会话未落库、页面已切走、或模型直接回“我无法回答这个问题”时，它会给一个根本不存在的 session id，打开 `https://www.qianwen.com/chat/<sid>` 会**静默跳回** `https://www.qianwen.com/chat`。实测一轮 104 题中 69 条 raw 链接打开后找不到对应问题。

**权威链接来源是分组枚举**：分组页每一行是 `div[data-session-id]`，行文本包含“标题 + 问题 + 答案片段”。命中问题文本 ⇒ 该会话真实存在、可打开、且就是这道题的会话。

**判定规则（用户 2026-09-15 明确）：分组里的会话都是真实的；不在分组里的采集地址都是有问题的。** 所以：

- 交付表只写分组枚举出来的链接，raw `chat_url` 不进表（`--allow-raw-fallback` 仅用于诊断）。
- 题目在分组里没有对应会话 ⇒ 这题没完成，补问后重新归组、重新枚举。

```bash
# 1) 枚举分组内会话（前端虚拟列表，脚本会滚动到不再增长）
node scripts/qianwen_enumerate_group.mjs --group-url <分组URL> --out group.json --profile <p>

# 2) 用分组命中出表 + 产出补问题清单
python scripts/qianwen_build_links_table.py --group-json group.json \
  --run-dir runs/main --run-dir runs/gap --questions questions.json \
  --prefix <文件名前缀> --group "<分组名>" --out-dir . --emit-missing questions-missing.json

# 3) 校验表内链接（脚本逐条打开 /chat/<sid> 并检查页面含该问题）
node scripts/qianwen_validate_links.mjs --table <文件名前缀>.csv --out validate.json --profile <p>
```

处置规则（按顺序）：

- 分组内命中 → 已完成，链接 = `https://www.qianwen.com/chat/<分组行 sid>`。
- 分组内无命中、`raw` 链接校验 `ok=true` → 会话有效，只需移入分组（再用分组链接出表）。
- 都不成立 → **必须重新提问**（不要复用旧 raw；补问用 `--emit-missing` 产出的题单 + **新的 out-dir**，避免 `--resume` 复用无效 raw）。

实测补充：

- 同题重试会在分组里留下多条会话（第2轮实测 104 题对应 140 条会话）。出表时取“行文本中问题出现位置最靠前”的那条（行首即该问题），避免误取到“答案里提到该问题”的会话。
- 会话移入分组后会从左侧“最近对话”里消失，`/chat` 首页显示“暂无对话”是正常的，**不代表采集失败**；判定只能看分组页。
- 被拒答的题要重问；若该题在分组里已有历史会话，直接沿用那条。
- **拒答是“账号级”的，不是“题目级”的**：账号进入限流/异常态时，千问对**任何**输入都回同一句固定文案「你好，我无法回答这个问题，我们换一个话题聊聊吧。」——2026-09-15 实测，连“1+1等于几？”和真实业务题都得到同一句。这类会话**确实会落库**（`qwen detail <sid>` 能读回），与早前“拒答不落库”的记录相反。
- 因此**不能只看“链接能否打开”判断采集成功，必须看回答内容**：命中那句固定文案即视为该题未采集。已采集数据可用文本检索全量自查一遍 `raw/` 与分组快照；本项目 2026-09-15 第 3 轮自查结果：`runs/main/raw` 23 ok、`runs/gap/raw` 22 ok、分组快照 63 行，**均无**该文案，历史数据可信。
- 出现账号级拒答时：停止提问，冷却 30 分钟以上再单题探针复测；不要原地重试（会固化风控）。

## 生成“问题 → 会话链接”表

```bash
python scripts/qianwen_build_links_table.py \
  --group-json group.json \
  --run-dir runs/main --run-dir runs/gap \
  --questions questions.json \
  --prefix 和光书苑_千问_问题链接汇总_20260910_第2轮 \
  --group "20260910_和光书苑_千问104题_第2轮" \
  --out-dir . --emit-missing questions-missing.json
```

- `--group-json`：**唯一交付来源**，链接直接由分组行的 `data-session-id` 生成。
- `--all-links`：**同一题的多条会话全部保留**，各占一行（默认只留第一条）。用户要"有结果的链接都附上、别去重"时必须加。
- `--extra-links`：补录额外已校验的会话（如没进分组但确实能打开的 raw 会话）。
- `--run-dir`：仅在加 `--allow-raw-fallback` 时作为回退来源（默认关闭，因为"不在分组的地址=有问题"）。
- `--emit-missing <file>`：把仍无链接的题写成补问题清单（含 id/index/层级/意图），可直接喂给 `qianwen_batch_crawl.mjs`。
- `--validated validate.json`：**按会话号逐条**剔除校验失败的链接（同一题的其他有效链接照常保留），避免把无效链接写进交付物。
- 问题清单的字段名两种都认：`index` / `levelName` / `intent`（早期轮次）与 `level_name` / `intent_label`（2026-09-15 轮）。**v0.1.6 起**缺 `index` 时按清单顺序自动编号，不再要求两轮清单统一口径（此前混用会导致「序号 / 层级名称 / 意图标签」三列整列空白）。
- 输出 CSV（UTF-8 BOM）+ XLSX（含“说明”页）。表头与元宝/豆包口径一致：序号 / 问题编号 / 层级 / 层级名称 / 意图标签 / 问题 / 千问会话链接 / 会话ID。

实操提示：

- 校验很慢（每条约 9-12 秒），一次 100+ 条要十几分钟到半小时；脚本每行都会打印结果，**没有输出才是真卡住**。
- 校验存在假阴性（页面没加载完）：v0.1.4 起默认失败重试 2 次；实测有会话首判失败、重判通过。
- 只校验"还没校验过的会话号"能省时间：先用 `--all-links` 出候选表，比对已有 `validate*.json` 的 `sid`，把剩下的单独跑一遍。

## 分组归置

```bash
node scripts/qianwen_move_to_group.mjs --run-dir runs/main --group "20260910_和光书苑_千问104题_第2轮" --profile <p>
```

- 顺序不可颠倒：**先拿到会话链接、再移入分组**（与元宝一致的思想）。移动本身不影响会话 URL，但移动过程会打断提问，所以必须在采集结束后执行。
- 千问前端虚拟列表只渲染可见行，脚本会自动滚动重试；仍找不到的会话会记入 `skipped`，需要滚动更多或人工补拖。
- 分组页支持把会话行直接拖到左侧分组（`data-session-id` 行 → 分组项）。

## 并发与安全

- 千问、DeepSeek、豆包、元宝共用同一浏览器 profile 时**不要并发**；等待上一轮采集结束再跑下一轮。
- 出现登录弹窗：适配器内置关闭逻辑；如反复要求登录，回到浏览器扫码登录后重试。
- 长清单慢答属正常：不要因为单题耗时数分钟就误判卡死；用 `--resume` 分段续跑。
- 出现连续“提问后无应答”时，先停止、冷却 20 分钟以上，再 `--resume`；不要原地高速重试。

## 证据边界

记录的是千问网页展示的回答与会话 URL，不保证引用源正确/可达；千问无公开分享链接，链接仅账号内可访问。因此交付前务必做一次链接有效性校验，并在交付说明中注明“账号内会话链接”。
