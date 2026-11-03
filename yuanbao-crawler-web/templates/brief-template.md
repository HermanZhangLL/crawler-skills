<!--
Project: yuanbao-crawler-web
Version: 1.0.0
Updated: 2026-10-30
-->

# Yuanbao Crawler Web Brief

- `skill_id`: `yuanbao-crawler-web`
- `keywords`:
  -
- `repeat_count_per_keyword`:
- `plan_order`: `round`（默认，轮询）| `question`（按题连续）
- `target_entity`:
- `target_entity_aliases`:
  -
- `entity_type`: `人` | `公司` | `产品`
- `opencli_profile`:
- `think_mode`: `快速` | `深度思考`（默认快速）
- `search`: `true`（默认联网搜索）| `false`（--no-search）
- `delay_strategy`（默认：随机 60-100 秒）:
  - `delay_min_minutes`:
  - `delay_max_minutes`:
- `crawler_script`:
- `output_directory`:
- `competitor_alias_file`:
- `report_title`:
- `max_report_items`: `10`
- `create_share`: `true`（默认，回答后自动分享并解析公开页面）| `false`（--no-create-share）
- `share_links`: 可选；公开分享链接文件（yb.tencent.com/s/<shareId>，每行一个）
- `field_maps`: `true`（默认，每问题一份 HTML）| `false`（--no-field-maps）
- `run_mode`: `fresh-crawl` | `resume` | `share-links` | `analysis-only`
- `notes`:

## Expected Outputs

- `yuanbao-crawl.json`
- `raw/*.json`
- `logs/*.log`
- `field-maps/<question_id>-data-map.html`
- `report/summary.json`
- `report/structured-data.md`
- `report/structured-data.xlsx`
- `report/report.html`
