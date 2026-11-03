<!--
Project: deepseek-crawler-web
Version: 1.0.0
Updated: 2026-10-30
-->

# DeepSeek Crawler Web Brief

- `skill_id`: `deepseek-crawler-web`
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
- `model_mode`: `instant` | `expert` | `vision`（默认 instant）
- `create_share`: `true`（默认开启，公开分享）| `false`（--no-create-share）
- `store`: `true` | `false`
- `html_maps`: `true` | `false`（同一问题只生成一份）
- `delay_strategy`（默认：随机 60-100 秒）:
  - `delay_min_minutes`:
  - `delay_max_minutes`:
- `crawler_script`:
- `output_directory`:
- `competitor_alias_file`:
- `report_title`:
- `max_report_items`: `10`
- `run_mode`: `fresh-crawl` | `resume` | `repair-shares` | `analysis-only`
- `notes`:

## Expected Outputs

- `deepseek-crawl.json`
- `raw/*.json`
- `logs/*.log`
- `report/summary.json`
- `report/structured-data.md`
- `report/structured-data.xlsx`
- `report/report.html`

