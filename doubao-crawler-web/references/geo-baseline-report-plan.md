# GEO 基线测评报告方案（DeepSeek 样式，豆包 Web 版）

> 状态：方案（规划中，未实现）
> 日期：2026-08-04
> 对应需求：在现有分析四件套之外，新增一份“参照 DeepSeek 基线测评报告形式”的品牌 GEO 分析报告。
> 参考样本：`H:\06 深保发展\02 日常工作归档文件\20260709 GEO材料汇总\20260720 企业GEO内容梳理\02 基线测量\20260731 营销问题评测\deepseek\和光书苑_DeepSeek基线测评报告.html`

---

## 1. 背景与目标

1. 现有 `analyze_doubao_results.py` 四件套（summary.json / structured-data.md / structured-data.xlsx / report.html）保持不动，继续作为通用概率分析输出。
2. 新增一份面向业务汇报的“品牌 GEO 基线测评报告”，形式参照 DeepSeek 基线测评报告（总览 → 逐题分析 → 信源分析 → 关键发现 → 行动建议），但数据源为豆包 Web 采集结果，并利用豆包特有的结构化字段做增强。
3. 报告要能直接说明：和光书苑（或任意目标品牌）在豆包 AI 搜索里的可见性、推荐位、信源构成、推荐追问、泛需求 vs 直接提问表现，以及可执行的 GEO 优化建议。

## 2. 输入与运行方式

```bash
python scripts/analyze_geo_baseline.py <doubao-crawl.json> \
  --target-entity "和光书苑" \
  --target-aliases "和光书苑,东湖尚品云境苑" \
  --entity-type product \
  --out-dir <输出目录> \
  --out-file "和光书苑_豆包Web基线测评报告.html" \
  [--platform "豆包网页端"] [--title "深圳园·和光书苑 豆包 Web 基线测评报告"]
```

- 输入：单个 run 的 `doubao-crawl.json`，或 `--merge-runs` 合并后的数据。
- 复用 `analyze_doubao_results.py` 的 `normalize_samples / normalize_plan / merge_runs / text_contains_alias` 等函数（import 方式），不复制逻辑。
- 输出：自包含 HTML（+ 可选同名 `.md`），默认文件名使用“豆包”字样，避免覆盖 DeepSeek 样本。

## 3. 报告结构（对照 DeepSeek 样本 + 增强）

### 3.1 总览
- 采集平台、采集日期、问题数、有效样本、完成率。
- 品牌提及率：总体、直接提问（问题含品牌名）、泛需求（推荐/性价比/改善/预算类）。
- 平均引用数、平均回答字数、推荐问题出现率、平均回答耗时、采样时间跨度。

### 3.2 逐题分析（每题一个卡片，可展开）
- 问题原文、是否提及目标品牌、回答摘要（`brief`，无则从正文截取）、推荐楼盘/实体（实体识别结果）。
- 引用信源列表（`references.items` + `references.full` 的 sitename/domain/url）。
- 豆包推荐追问（`suggest_questions`）。
- 回答字数、耗时、`asked_at / completed_at`。
- 泛需求与直接提问分组展示，对齐 DeepSeek 样本的 Q1-Q4 / Q5-Q12 分组方式。

### 3.3 搜索与引用分析（豆包特有增强）
- 豆包实际搜索关键词：`search_blocks[].queries[]` 聚合。
- 引用域名排名：按 `references.full` 的 domain 统计出现次数。
- 信源类型分布：沿用 `classify_channel`（官方/政府/媒体/平台/社区/UGC 等）。
- 引用时效：`publish_time_second` 分布（近 1 年/近 3 年/更早/未识别）。
- 权威性分级：gov/edu/org/官媒为高，平台为中，UGC 为参考。
- 信源覆盖矩阵：问题 × 域名（哪些问题缺信源、哪些域名覆盖多个问题）。

### 3.4 推荐追问分析
- 推荐问题出现率、内容清单、目标品牌/竞品在推荐问题中的提及情况。
- 推荐问题可作为“用户下一步会问什么”的线索，供选题复用。

### 3.5 关键发现
- 泛需求缺失：目标品牌在推荐/性价比/改善/预算类问题中是否出现。
- 竞品对比：同类型竞品（如紫华学府、燕华城、东湖尚品）在泛需求中的出现情况。
- 信源缺口：高权威域名覆盖不足、UGC/社区缺位、关键事实缺失。
- 时间/时效风险：引用多为旧信息或缺失时间。

### 3.6 行动建议
- 短期（30 天）/ 中期（60 天）/ 长期（90 天），自动生成或半自动生成。

### 3.7 附录
- 问题-链接-时间表（对应 `question-links.csv`）。
- 方法说明与免责声明：重复采样估计、非平台内部真相。

## 4. HTML 设计

- 复用现有 Kami 设计语言（暖米纸底、象牙内容面、油墨蓝、serif 标题、固定顶部导航），保证与现有 `report.html` 同一视觉体系。
- 结构：Hero 标题区 + 固定导航 + 统计卡片 + 逐题手风琴 + 信源排名 + 关键发现 + 行动建议 + 页脚。
- 纯静态、无外部依赖、无 JS 也能看（展开交互可用原生 details 或 JS 增强）。
- 中英文切换可选（沿用现有双语言样式）。

## 5. 分析维度扩展（不局限于样本内容）

1. 泛需求 vs 直接提问分层（样本已有，保留）。
2. 豆包搜索关键词与引用来源的对应关系（`queries[]` + `results[]`）。
3. 推荐问题中的品牌/竞品信号（新维度）。
4. 引用时效与信息新鲜度（`publish_time_second`）。
5. 回答完整度（字数、`brief` 长度、块类型、引用数）。
6. 多次测评合并后的时间序列趋势（预留，`--merge-runs` 数据）。
7. 信源覆盖矩阵（问题 × 域名）。
8. 品牌事实一致性（与品牌事实库对比，预留）。

## 6. 实现方案（文件级）

| 文件 | 动作 | 内容 |
|---|---|---|
| `scripts/analyze_geo_baseline.py` | 新增 | 读取 doubao-crawl.json，复用 analyze 的 normalize/merge，计算基线指标，渲染 HTML/MD |
| `scripts/test_geo_baseline.py` | 新增 | fixture 报告生成 + 关键指标断言（提及率、信源排名、推荐问题） |
| `fixtures/sample-doubao-thread-crawl.json` | 复用 | 作为离线报告生成 fixture |
| `README.md` | 更新 | 新增“GEO 基线测评报告”用法说明 |
| `references/report-contract.md` | 更新 | 补充基线报告输出契约 |
| `references/geo-baseline-report-plan.md` | 新增 | 本方案 |
| `manifest.json` | 更新 | 版本 0.2.1、输出契约 |

## 7. 测试与验收

1. 用 `fixtures/sample-doubao-thread-crawl.json` 生成报告，检查总览/逐题/信源/推荐问题各模块非空。
2. 用真实 run（如 `20260804 豆包web采集-前3题测试/doubao-crawl.json`）生成报告，人工核对与原始回答一致。
3. 断言：目标品牌提及率、引用域名排名、推荐问题出现率与手工统计一致。
4. 旧数据兼容：无新字段的旧 doubao-crawl.json 也能生成报告（缺失字段置空/隐藏）。
5. 离线测试纳入 `run-tests.sh` 与 `run-tests.ps1`。

## 8. 输出路径说明（重要）

- 用户指定输出：`H:\06 深保发展\02 日常工作归档文件\20260709 GEO材料汇总\20260720 企业GEO内容梳理\02 基线测量\20260731 营销问题评测\deepseek\和光书苑_DeepSeek基线测评报告.html`
- 该路径与现有 DeepSeek 样本**同名**，直接输出会覆盖样本。为避免覆盖，默认输出文件名为 `和光书苑_豆包Web基线测评报告.html`（同目录），并支持 `--out-file` 指定任意文件名。
- 若确认要覆盖/替换 DeepSeek 样本，可将默认值改为用户给定路径，或在运行时显式传 `--out-file`。

## 9. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1 | 新增脚本骨架：读取/复用 normalize，输出基础 HTML | fixture 报告生成 |
| M2 | 总览 + 逐题分析（含 brief、推荐问题、引用） | 与原始数据一致 |
| M3 | 信源/搜索词/推荐追问/时效维度 | 指标断言通过 |
| M4 | 关键发现 + 行动建议 + MD 输出 + 测试 + 文档 | run-tests 全绿 |
| M5 | 用真实 12 题 run 出正式报告 | 业务验收 |

---

> 本方案对应需求：审核后新增的“DeepSeek 样式 GEO 基线测评报告”；现有分析四件套保持不变。
