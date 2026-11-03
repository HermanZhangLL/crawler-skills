# 腾讯元宝测评采集前确认单

每次开始真实测评前，先向用户确认以下事项。用户未回答时按默认值执行。

## 1. 问题/关键词集（必填，无默认）

请提供 questions.txt（每行一个问题）、JSON 数组，或直接粘贴问题。例如：

`	ext
出国留学公司推荐
出国留学机构哪家好
出国留学公司哪家好
`

## 2. 每个问题提问次数

- 默认：1 次（--repeat）
- 范围：1-50
- 次数越多，提及率、Top1/Top3 概率越稳定，但耗时和请求次数也越高。

## 3. 目标实体、实体类型、竞品/别名表

- 目标实体：必填，用户提供要诊断的对象，例如“星潮里商业”
- 实体类型：默认 uto，由采集方根据问题判断是 人/person、公司/company 还是 产品/product；用户也可直接指定
- 竞品/别名表：可选；不提供时由分析器从回答中推断同类型竞品并标记低置信度
- 别名表格式：每行 实体|别名A|别名B，第一列为规范名

示例（公司）：

`	ext
新东方前途出国|新东方|前途出国
启德教育|启德留学|启德
指南者留学|指南者
`

示例（人）：

`	ext
卢鑫|Echo Lu|Echo
孟庆涛
李德仁
`

示例（产品）：

`	ext
蔚来|NIO|蔚来ES8|蔚来ES6
问界|AITO|问界M9|问界M7
理想汽车|理想L9|理想L8
`

## 4. 每个问题之间的采集间隔

- 默认：随机 60-100 秒（--delay-min-ms 60000 --delay-max-ms 100000）
- 可选更安全模式：--safe-random-delay，随机 5-20 分钟
- 可选自定义：--delay-min-minutes <n> --delay-max-minutes <n>
- 仅测试可缩短：--delay-ms <ms>

## 5. 采集模式 / 模型 / 深度思考

- 默认：快速模式（--model quick）
- 可选：专家模式（--model expert）、Vision 模式（--model vision）
- 深度思考：默认关闭（--think）
- 元宝说明：OpenCLI 元宝适配器目前只暴露 --think/--search，不直接切换页面模型；xpert 用深度思考近似，ision 暂按快速模式采集并记录警告。如需精确模型，请先在浏览器中手动选择后运行预检

## 6. 会话 URL 审计

- 默认保留：每次提问后记录 conversation.url（yuanbao.tencent.com/chat/<agentId>/<convId>）
- 会话 URL 仅用于审计，不作为公开分享链接

## 7. 数据字段地图 HTML

- 默认：每个问题生成一份 ield-maps/<question_id>-data-map.html（取第一份有效样本）
- 关闭：--no-field-maps

## 8. 自动分享与公开链接解析

- 默认开启：每次回答后自动创建会话公开分享链接（分享接口优先，页面按钮兜底），并解析 yb.tencent.com/s/<shareId> 全量数据
- 关闭：--no-create-share
- 质量规则：开启自动分享时，链接创建失败或取不到数据，该样本标记为失败，不计入成功样本
- 注意：分享链接是公开的，回答内容可能被任何人访问；含私密或客户敏感信息时请关闭自动分享

## 9. 数据表与“问题→分享链接”Excel

- 默认导出（--store）：store/yuanbao-samples.csv、store/yuanbao-references.csv、store/yuanbao-samples.db（SQLite）
- 默认生成 store/share-links.xlsx：每个样本一行“问题、轮次、share_id、分享链接、分享成功”，并附按问题汇总表
- 关闭全部导出：--no-store；只关闭 Excel：--no-share-links-excel

## 10. 浏览器采集 profile（真机采样必填）

- 真机采样需要已连接且已登录腾讯元宝的 Browser Bridge profile
- 默认：用户当前已连接的 profile；运行前可用 opencli profile list 确认
- 一次采集固定同一个账号；切换账号可能导致之前创建的分享链接失效
- 仅做公开分享链接批量解析时不需要 profile

## 11. 输出目录

- 不指定时自动生成：有目标实体时 YYYYMMDD_<实体>_yuanbao_web（快速模式 _fast、专家 _expert、Vision _vision、深度思考 _think），无实体时 yuanbao-<timestamp>
- 也可直接提供完整文件夹路径；全部 raw、日志、字段地图、数据表、Excel 和报告都写入该目录
- 版本规则：若目标目录已存在旧版本，自动追加 -v2、-v3 等，旧版本保留，不删除、不覆盖；最终以 --out-dir 为准

## 可选确认项

- 是否启用 --resume：中断后续跑
- 是否把新会话归入指定“对话分组”：若需要，请提供分组名（已在元宝网页端创建）；通过环境变量 `YUANBAO_GROUP=<分组名>` 启用，采集器会在分享完成后把每个新会话移入该分组（v0.3.0+）
- 是否关闭联网搜索：--no-search（默认开启）
- 是否提供公开分享链接文件（share_links.txt，每行一个 yb.tencent.com/s/<shareId>）：可跳过浏览器，直接批量解析
- 采样顺序：默认 ound（所有问题按轮次采样）；需要按“先问完一个问题的全部次数再问下一个”时用 --plan-order question
- 输出目录、报告标题、语义复核模式（auto/required/off）
- 一次只跑一个采集任务，不要同时跑多个，避免浏览器互相干扰
