# Crawler Skills

四个 GEO 测评 crawler skill 的合集（monorepo）：通过 OpenCLI Browser Bridge 自动操作各平台已登录网页会话，完成重复采样 → 收集分享链接 → 结构化数据抽取 → 统一存储 → 概率分析报告的完整链路。用于品牌在 AI 搜索（GEO）中的可见度测评。

| Skill | 平台 | 说明 |
|---|---|---|
| [`deepseek-crawler-web`](deepseek-crawler-web/) | DeepSeek 网页端 | 分享接口直连 + 结构自适应 payload 探测（含 fragments 布局）；`--fast-ask` 快速完成判定 |
| [`qianwen-crawler-web`](qianwen-crawler-web/) | 千问网页端 | 分组枚举为唯一权威链接来源 + 逐条校验防静默跳转；风控熔断 |
| [`doubao-crawler-web`](doubao-crawler-web/) | 豆包网页端 / Android App | thread 分享链接双通道解析；网页 + Appium 双后端；熔断 + 自适应延迟 |
| [`yuanbao-crawler-web`](yuanbao-crawler-web/) | 腾讯元宝网页端 | `__NEXT_DATA__` 分享载荷结构自适应探测；对话分组归置 |

## 设计原则

- **网页端适配而非 API**：复用已登录会话，采集用户真实看到的回答与信源。
- **结构自适应**：分享/链接 payload 的字段路径不写死——先探测结构（消息数组、角色/正文/引用字段别名），再按探测结果抽取归一；结构指纹随样本保存，平台改版可审计漂移，不静默产出空数据。
- **后台执行**：采集窗口默认 `background`，不打断日常浏览器使用。
- **证据优先**：每题保留 raw JSON、引用标题、URL、日志；概率指标均为重复采样估计。
- **风控优先于效率**：默认延迟/熔断/重试保守，追求速度时按各 README 的"预设值与取舍"表调整。

## 每个 skill 的结构

```text
<skill>/
├── SKILL.md          路由触发与工作流骨架
├── README.md         使用文档（预安装软件、预设值与取舍、快速开始）
├── CHANGELOG.md      版本记录
├── manifest.json     元数据（version / owner / 依赖 / 输出契约）
├── references/       采集工作流、数据合约、用户手册
├── scripts/          采集/分析/测试脚本
├── fixtures/         离线测试样例
├── evals/            触发用例与预期产物
└── templates/        采集前问卷与简报模板
```

## 环境依赖（各 skill 通用）

- Node.js 21+（仅离线分析 18+）
- Python 3.10+
- OpenCLI CLI 1.8.4+（含对应平台站点适配器）
- OpenCLI Browser Bridge（Chrome/Edge 扩展已连接）
- 对应平台网页端已登录

各平台差异见各 skill 的 README"预安装软件"表。

## 测试

每个 skill 自带离线回归：

```bash
cd <skill>
bash scripts/run-tests.sh    # Windows 用 Git Bash；doubao 也提供 run-tests.ps1
```

覆盖语法检查、参数解析、结构探测、实体识别回归、fixture 端到端分析断言。

## 版本与发布

- 版本号以各 `manifest.json` 的 `version` 为准，配套 `CHANGELOG.md`。
- 发布流程：改 skill → `run-tests.sh` 回归 → 更新 manifest/CHANGELOG → commit + tag `v<version>` → push。
- `owner: Herman`；原始开发过程与历史版本留档在本地归档目录，不入库。

## 边界

- 不绕过登录、验证码、风控或平台限制；不调用各平台 API。
- 不用于高频自动化、SEO 改写或一次性问答。
- 概率指标为重复采样估计，不代表真实市场份额或平台官方排名。
