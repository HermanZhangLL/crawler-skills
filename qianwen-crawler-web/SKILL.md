---
name: qianwen-crawler-web
description: "Use when a user needs repeated Qianwen (千问 www.qianwen.com) web AI-search question collection into JSON/CSV/Excel with per-question evidence and optional UI grouping (e.g. 20260908 营销104题-第1轮). Requires questions/keywords, repeat count, target entity/type and browser profile. Not for generic scraping, Qianwen API chat, SEO writing, or one-off answers."
---

# Qianwen Crawler Web

## Inputs

Standard inputs: keywords/questions, repeat count, target entity/entity type, OpenCLI browser profile, output directory, and (optional) the Qianwen 分组 name used to place conversations. Qianwen web has no public share endpoint in the bundled adapter; the record keeps the account-scoped conversation URL (`chat_url`) as link evidence, so **links are only readable inside that account**.

## Pre-collection Confirmation

Confirm before a real run (defaults in parentheses):

1. 问题/关键词集（必填）
2. 每题次数（默认 1）
3. 目标实体与实体类型（如 和光书苑/产品）
4. 题间间隔（默认随机 60-100 秒；实测 40-60 秒可用但偏快，出现无应答时拉长或冷却）
5. 模式：联网问答；可 `--think`/`--research`（慢且贵，默认关闭）
6. 是否需要把新会话归入千问网页“分组”（提供分组名，采集后通过 UI 移动）
7. 浏览器 profile（默认当前已连接 profile）
8. 输出目录（默认 `runs/<时间戳>`；与其它平台一致建议 `YYYYMMDD_<实体>_Qianwen104题_第N轮`）

## Workflow

1. Read `references/qianwen-crawl-workflow.md` and `references/pre-run-confirmation.md`.
2. Preflight: `node scripts/preflight.mjs --profile <profile>`（千问需已登录，且不要与其它平台采集并发占用同一浏览器）。
3. Single question: `node scripts/qianwen_single.mjs --prompt "<问题>" --id <样本号> --profile <p> --timeout 600 --out raw/<id>.json`.
4. Batch: `node scripts/qianwen_batch_crawl.mjs --questions questions.json --repeat 1 --profile <p> --target-entity <实体> --entity-type product --delay-min-ms 40000 --delay-max-ms 60000 --timeout 600 --pause-after-fails 3 --pause-minutes 20 --out-dir <dir>`；支持 `--resume`、`--dry-run`。成功判定以 `raw/<样本号>.json` 为准。
5. 分组归置：`node scripts/qianwen_move_to_group.mjs --run-dir <run> --group "<分组名>" --profile <p>`。**先落盘 raw、再移入分组**；归组后会话会从“最近对话”消失（分组=文件夹），这是正常的，不要据此判断采集失败。
6. **权威链接来源 —— 枚举分组**：`node scripts/qianwen_enumerate_group.mjs --group-url <分组URL> --out group.json --profile <p>`。分组页每行都带 `data-session-id`，行文本含“标题 + 问题 + 答案片段”，因此命中即证明该会话真实存在且可打开。
7. 出表：`python scripts/qianwen_build_links_table.py --group-json group.json --all-links --questions questions.json --prefix <文件名前缀> --group "<分组名>" --out-dir . --emit-missing questions-missing.json`。**链接唯一来源是分组枚举结果**；`--emit-missing` 直接产出需要补问的题。
   - **默认不去重**：`--all-links` 让同一题的多条会话各占一行（用户要"有结果的链接都留下"时必须加）。
   - `--run-dir` 只在显式加 `--allow-raw-fallback` 时才作为回退来源；默认不采用 raw 地址，因为实测"不在分组里的地址=有问题"。
8. 链接校验（交付前必做）：`node scripts/qianwen_validate_links.mjs --table <前缀>.csv --out validate.json --profile <p> [--retries 2]` —— 逐条打开 `/chat/<sid>`，确认页面确实包含该问题（会话不存在时会静默跳回 `/chat`，脚本记为 `redirected_to_new_chat`）。失败的链接会自动重试，避免"页面没加载完"的假阴性误删有效链接；每条都会打印结果行。
9. 补问缺失题：用第 7 步的 `questions-missing.json` 重跑 batch（**新 out-dir**，避免 `--resume` 复用无效 raw），再回到第 5 步。
10. 全部校验通过后，用 `--validated validate.json` 再出一版交付表，确保表里没有无效链接。

## Honest Boundaries

- 不绕过登录/CAPTCHA；千问需已登录。
- 不调用隐藏 API 或网络流量抓取。
- qwen 适配器无公开分享链接；`chat_url` 仅供该账号内访问，且**经常无效**：它读的是 `qwen status` 的当前页地址，页面已切走或会话未落库时会给出不存在的 session id（打开 `/chat/<sid>` 静默跳回 `/chat`）。实测一轮 104 题中 69 条 raw 链接打开后找不到对应问题。
- `ok=true` 只代表拿到了回答文本，**不代表这题算采集成功**：账号进入限流/异常态时，千问对任何问题（含“1+1等于几？”和真实业务题）都回同一句「你好，我无法回答这个问题，我们换一个话题聊聊吧。」，且该会话**会落库、链接也能打开**（与早前“拒答不落库”的记录相反）。判定成功必须看回答内容，命中该固定文案即该题未采集、需重问。
- `qwen ask` 适配器能否使用取决于 Browser Bridge **扩展版本**：v1.0.15~v1.0.22 上恒定 600s 超时且 `chat_url` 常不存在（9/11、9/14 两轮因此改用 DOM 自建采集器），v1.0.24 上复测恢复正常。开跑前先 `opencli doctor` 确认扩展版本。
- **判定规则（用户已确认）：分组里的会话都是真实可用的；不在分组里的采集地址都是有问题的。** 因此交付表的链接只取分组枚举结果，raw 地址不进表（除非显式 `--allow-raw-fallback` 做诊断）。
- 千问没有“合并会话”概念；同一问题重试会在分组里留下多条会话，出表时按“行文本中问题出现位置最靠前”的那条取链接（行首即该问题），并在说明页记录同题多会话的数量。
- 千问前端虚拟列表只渲染可见行：分组枚举、批量归组都只能“尽力而为”，脚本会滚动重试并记录 `skipped`。
- 长清单（104 题×1 次）按每问实际耗时（可能 1-5 分钟）预估总时长，建议分批 `--resume`；出现连片无应答先冷却再续。
- 与 DeepSeek/豆包/元宝共用浏览器 profile 时不要并发运行。
