#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import analyze_doubao_results as adr  # noqa: E402

CURRENT_YEAR = dt.datetime.now().year
DEFAULT_PLATFORM = "豆包网页端"


def esc(value: object) -> str:
    return html.escape(str(value if value is not None else ""))


def pct(value: float) -> str:
    return adr.pct(value)


def parse_year(value: object) -> int | None:
    match = re.match(r"(\d{4})", str(value or ""))
    return int(match.group(1)) if match else None


def recency_bucket(value: object) -> str:
    year = parse_year(value)
    if year is None:
        return "未识别"
    if year >= CURRENT_YEAR:
        return f"本年({CURRENT_YEAR})"
    if year >= CURRENT_YEAR - 2:
        return "近三年"
    return "更早"


def load_data(args: argparse.Namespace) -> tuple[dict, str]:
    if args.merge_runs:
        data = adr.merge_runs(args.merge_runs)
        input_label = "merged:" + ",".join(data["run"].get("merged_run_ids", []))
    else:
        input_path = Path(args.input_json).resolve()
        data = adr.read_json(input_path)
        input_label = input_path.name
    return data, input_label


def build_brands(args: argparse.Namespace, data: dict, samples: list[dict]) -> tuple[list[dict], dict]:
    namespace = SimpleNamespace(
        brands=args.brands or "",
        brands_file=args.brands_file,
        target_entity=args.target_entity or (data.get("input") or {}).get("target_entity") or "",
        target_aliases=args.target_aliases or "",
        entity_type=args.entity_type or (data.get("input") or {}).get("entity_type") or "company",
        min_inferred_count=2,
        max_entity_candidates=48,
        target_kind="auto",
    )
    try:
        brands, _source, _kind, _candidates, profile = adr.load_brand_defs(namespace, data, samples)
        return brands, profile
    except Exception:
        target = namespace.target_entity
        aliases = [item for item in adr.split_aliases(namespace.target_aliases) if item]
        if target:
            aliases = [target, *[a for a in aliases if a != target]]
        brands = (
            [{"name": target, "aliases": aliases or [target], "role": "target", "entity_type": namespace.entity_type}]
            if target
            else []
        )
        return brands, {"entity": target, "aliases": aliases, "has_target": bool(target)}


def compute_question_rows(
    samples: list[dict],
    plan_entries: list[dict],
    brands: list[dict],
    aliases: list[str],
) -> list[dict]:
    target_aliases = [alias for brand in brands if brand.get("role") == "target" for alias in brand["aliases"]] or aliases
    qids = sorted({item["question_id"] for item in plan_entries} | {sample["question_id"] for sample in samples})
    rows: list[dict] = []
    for qid in qids:
        q_samples = [sample for sample in samples if sample["question_id"] == qid]
        valid = [sample for sample in q_samples if sample["ok"]]
        question = next(
            (item["question"] for item in plan_entries if item["question_id"] == qid),
            q_samples[0]["question"] if q_samples else "",
        )
        per_target = next((item.get("target") for item in plan_entries if item["question_id"] == qid), "")
        direct = bool(per_target) or adr.text_contains_alias(question, target_aliases)
        mentioned = any(adr.text_contains_alias(sample["answer"], aliases) for sample in valid)
        refs = [ref for sample in valid for ref in sample["references"]]
        full_cards = [card for sample in valid for card in (sample.get("references_full") or [])]
        domains = Counter(ref["domain"] for ref in refs if ref.get("domain"))
        suggests = [text for sample in valid for text in (sample.get("suggest_questions") or [])]
        brief = next((sample.get("brief") for sample in valid if sample.get("brief")), "")
        answer = next((sample.get("answer") for sample in valid if sample.get("answer")), "")
        timing = next((sample.get("timing") or {} for sample in valid if sample.get("timing")), {})
        mentioned_brands = [brand["name"] for brand in brands if adr.text_contains_alias(answer, brand["aliases"])]
        rows.append(
            {
                "question_id": qid,
                "question": question,
                "direct": direct,
                "mentioned": mentioned,
                "mentioned_brands": mentioned_brands,
                "ref_count": len(refs),
                "full_cards": len(full_cards),
                "domains": [domain for domain, _ in domains.most_common(8)],
                "suggest_count": len(suggests),
                "suggests": suggests[:5],
                "brief": brief[:600] if brief else "",
                "answer_chars": len(answer),
                "asked_at": timing.get("asked_at", ""),
                "completed_at": timing.get("completed_at", ""),
            }
        )
    return rows


def compute_source_analysis(samples: list[dict]) -> dict:
    valid = [sample for sample in samples if sample["ok"]]
    refs = adr.flatten_references(valid)
    full_cards = [card for sample in valid for card in (sample.get("references_full") or [])]
    domain_counter = Counter(ref["domain"] for ref in refs if ref.get("domain"))
    channel_counter = Counter(ref["channel"] for ref in refs)
    recency = Counter(recency_bucket(card.get("publish_time_second")) for card in full_cards)
    query_counter: Counter[str] = Counter()
    for sample in valid:
        for block in sample.get("search_blocks") or []:
            for query in block.get("queries") or []:
                query_counter[str(query)] += 1
    coverage: dict[str, set[str]] = defaultdict(set)
    for ref in refs:
        if ref.get("domain"):
            coverage[ref["question_id"]].add(ref["domain"])
    return {
        "refs": refs,
        "full_cards": full_cards,
        "domain_counter": domain_counter,
        "channel_counter": channel_counter,
        "recency": recency,
        "query_counter": query_counter,
        "coverage": {key: sorted(value) for key, value in coverage.items()},
    }


def build_findings(
    question_rows: list[dict],
    source: dict,
    suggest: dict,
    timing: dict,
    target_entity: str,
) -> list[dict]:
    valid_questions = [row for row in question_rows if row["ref_count"] >= 0]
    direct = [row for row in valid_questions if row["direct"]]
    generic = [row for row in valid_questions if not row["direct"]]
    direct_rate = adr.rate(sum(1 for row in direct if row["mentioned"]), len(direct))
    generic_rate = adr.rate(sum(1 for row in generic if row["mentioned"]), len(generic))
    findings: list[dict] = []

    if generic and generic_rate == 0 and direct_rate > 0:
        findings.append(
            {
                "type": "danger",
                "title": "泛需求场景品牌缺失",
                "text": (
                    f"目标品牌 {target_entity or ''} 在 {len(generic)} 个泛需求问题中均未被提及，"
                    f"而直接提问时提及率 {pct(direct_rate)}。用户在 AI 搜索初步筛选阶段看不到该品牌。"
                ),
            }
        )
    else:
        findings.append(
            {
                "type": "info",
                "title": "品牌可见性概览",
                "text": (
                    f"泛需求提及率 {pct(generic_rate)}，直接提问提及率 {pct(direct_rate)}"
                    f"（直接 {sum(1 for r in direct if r['mentioned'])}/{len(direct)}，泛需求 "
                    f"{sum(1 for r in generic if r['mentioned'])}/{len(generic)}）。"
                ),
            }
        )

    competitors_in_generic: Counter[str] = Counter()
    for row in generic:
        for name in row["mentioned_brands"]:
            if name != target_entity:
                competitors_in_generic[name] += 1
    if competitors_in_generic:
        top = competitors_in_generic.most_common(3)
        findings.append(
            {
                "type": "warn",
                "title": "泛需求中的竞品表现",
                "text": "竞品在泛需求中被提及：" + "、".join(f"{name}（{count}题）" for name, count in top),
            }
        )

    official = sum(1 for ref in source["refs"] if ref.get("channel") == "official")
    community = sum(1 for ref in source["refs"] if ref.get("channel") == "community")
    findings.append(
        {
            "type": "good" if official else "warn",
            "title": "信源结构",
            "text": (
                f"共 {len(source['refs'])} 条可见引用：官方/权威 {official} 条，社区/UGC {community} 条。"
                + ("官方信源已有覆盖。" if official else "缺少官方/权威信源。")
                + ("社区内容缺位，可加强知乎/小红书等布局。" if community == 0 else "")
            ),
        }
    )

    suggest_rate = suggest.get("suggest_present_rate", 0)
    findings.append(
        {
            "type": "info" if suggest_rate > 0 else "warn",
            "title": "推荐追问",
            "text": (
                f"推荐问题出现率 {pct(suggest_rate)}，平均每条 {round(suggest.get('avg_suggest_count', 0), 2)} 个。"
                "推荐追问可复用为下一轮选题。"
            ),
        }
    )

    recency = source["recency"]
    recent = recency.get(f"本年({CURRENT_YEAR})", 0) + recency.get("近三年", 0)
    total_recency = sum(recency.values())
    findings.append(
        {
            "type": "info",
            "title": "引用时效",
            "text": (
                f"近三年内发布/更新的引用 {recent}/{total_recency or 0}（{pct(adr.rate(recent, total_recency))}），"
                f"未识别时间 {recency.get('未识别', 0)} 条。"
            ),
        }
    )

    if timing.get("first_asked_at"):
        findings.append(
            {
                "type": "info",
                "title": "时间记录",
                "text": f"本批最早提问 {timing.get('first_asked_at')}，最晚提问 {timing.get('last_asked_at')}。",
            }
        )
    return findings


def build_recommendations(findings: list[dict], target_entity: str) -> tuple[list[str], list[str], list[str]]:
    text = " ".join(item["text"] for item in findings)
    short: list[str] = []
    medium: list[str] = []
    long_term: list[str] = []

    if "泛需求场景品牌缺失" in text:
        short.append("围绕泛需求问题（推荐/性价比/改善/预算）制作对比与榜单内容，让品牌进入 AI 候选池。")
        short.append("在房产垂直平台与百科完善品牌词条和项目参数。")
    else:
        short.append("维持直接提问下的高提及率，持续监控泛需求问题中的排位。")
    if "社区内容缺位" in text:
        medium.append("在知乎/小红书/抖音布局探盘、体验、业主视角内容。")
    if "缺少官方" in text:
        medium.append("推动官方口径（政府/官媒/官网/住建/教育）内容上线并被平台收录。")
    medium.append("建立品牌事实库，统一楼盘参数、交付、学区等口径。")
    long_term.append("按 30/60/90 天节奏用同一问题集在豆包/DeepSeek/千问/元宝等平台持续采样。")
    long_term.append("将推荐追问、搜索关键词、引用时效纳入月度监测，形成趋势对比。")
    long_term.append(f"关注目标 {target_entity or '品牌'} 在泛需求与直接提问中的提及率和 Top3 位置变化。")
    return short, medium, long_term


def render_md(
    title: str,
    platform: str,
    collected_at: str,
    summary: dict,
    question_rows: list[dict],
    source: dict,
    suggest: dict,
    timing: dict,
    findings: list[dict],
    short: list[str],
    medium: list[str],
    long_term: list[str],
) -> str:
    lines = [f"# {title}", "", f"> 采集平台：{platform}", f"> 分析生成：{collected_at}", ""]
    lines.append("## 一、总览")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("|------|------|")
    for key, value in summary.items():
        lines.append(f"| {key} | {value} |")
    lines.append("")
    lines.append("## 二、逐题分析")
    lines.append("")
    for row in question_rows:
        mention = "✅" if row["mentioned"] else "❌"
        lines.append(f"### {row['question_id']}: {row['question']}")
        lines.append("")
        lines.append(f"- 品牌提及：{mention}（提及实体：" + "、".join(row["mentioned_brands"]) + "）")
        lines.append(f"- 引用数：{row['ref_count']}，完整引用卡：{row['full_cards']}，回答字数：{row['answer_chars']}")
        lines.append(f"- 推荐追问：{row['suggest_count']} 个（" + "；".join(row["suggests"]) + "）")
        lines.append(f"- 提问时间：{row['asked_at']}，完成时间：{row['completed_at']}")
        if row["brief"]:
            lines.append(f"- 回答摘要：{row['brief'][:200]}…" if len(row["brief"]) > 200 else f"- 回答摘要：{row['brief']}")
        lines.append("")
    lines.append("## 三、信源分析")
    lines.append("")
    lines.append("| 排名 | 域名 | 出现次数 |")
    lines.append("|------|------|---------|")
    for index, (domain, count) in enumerate(source["domain_counter"].most_common(20), start=1):
        lines.append(f"| {index} | {domain} | {count} |")
    lines.append("")
    lines.append("### 信源类型分布")
    lines.append("")
    lines.append("| 类型 | 次数 |")
    lines.append("|------|------|")
    for channel, count in source["channel_counter"].most_common():
        lines.append(f"| {adr.CHANNEL_LABELS_ZH.get(channel, channel)} | {count} |")
    lines.append("")
    lines.append("### 引用时效")
    lines.append("")
    lines.append("| 时效 | 次数 |")
    lines.append("|------|------|")
    for bucket, count in source["recency"].most_common():
        lines.append(f"| {bucket} | {count} |")
    if source["query_counter"]:
        lines.append("")
        lines.append("### 豆包实际搜索关键词")
        lines.append("")
        for query, count in source["query_counter"].most_common(10):
            lines.append(f"- {query}（{count}）")
    lines.append("")
    lines.append("## 四、关键发现")
    lines.append("")
    for item in findings:
        lines.append(f"- **{item['title']}**：{item['text']}")
    lines.append("")
    lines.append("## 五、行动建议")
    lines.append("")
    lines.append("### 短期（30 天）")
    for item in short:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("### 中期（60 天）")
    for item in medium:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("### 长期（90 天）")
    for item in long_term:
        lines.append(f"- {item}")
    lines.append("")
    lines.append("> 方法说明：指标来自重复采样估计，不构成平台内部真相。")
    return "\n".join(lines)


def render_html(
    title: str,
    platform: str,
    collected_at: str,
    summary: dict,
    question_rows: list[dict],
    source: dict,
    suggest: dict,
    timing: dict,
    findings: list[dict],
    short: list[str],
    medium: list[str],
    long_term: list[str],
) -> str:
    stat_cards = []
    card_colors = ["blue", "green", "orange", "red", "blue", "green"]
    for index, (key, value) in enumerate(summary.items()):
        stat_cards.append(f'<div class="stat-card {card_colors[index % len(card_colors)]}"><div class="num">{esc(value)}</div><div class="label">{esc(key)}</div></div>')

    qa_cards = []
    for row in question_rows:
        badge = '<span class="badge badge-yes">已提及</span>' if row["mentioned"] else '<span class="badge badge-no">未提及</span>'
        kind = "直接提问" if row["direct"] else "泛需求"
        brands = "、".join(row["mentioned_brands"]) or "—"
        suggests = "；".join(row["suggests"]) or "—"
        brief = row["brief"] or "（无摘要）"
        qa_cards.append(
            f"""
<details class="qa-card">
  <summary class="qa-header"><span class="qa-num {'no' if not row['mentioned'] else ''}">{esc(row['question_id'])}</span>
    <span class="qa-question">{esc(row['question'])}</span>{badge}</summary>
  <div class="qa-body">
    <div class="qa-label">问题类型</div><div>{kind}</div>
    <div class="qa-label">提及实体</div><div>{esc(brands)}</div>
    <div class="qa-label">回答摘要</div><div class="qa-answer">{esc(brief)}</div>
    <div class="qa-label">引用与耗时</div><div>引用 {row['ref_count']} 条 / 完整引用卡 {row['full_cards']} / 回答 {row['answer_chars']} 字</div>
    <div class="qa-label">推荐追问</div><div>{esc(suggests)}</div>
    <div class="qa-label">时间</div><div>提问 {esc(row['asked_at'])} · 完成 {esc(row['completed_at'])}</div>
    <div class="qa-label">引用域名</div><div class="qa-sources">{''.join(f'<span class="qa-source"><span class="domain">{esc(d)}</span></span>' for d in row['domains'])}</div>
  </div>
</details>
"""
        )

    domain_rows = "".join(
        f'<div class="source-rank"><span class="rank">{index}</span><span class="name">{esc(domain)}</span><span class="count">{count}</span></div>'
        for index, (domain, count) in enumerate(source["domain_counter"].most_common(20), start=1)
    )
    channel_rows = "".join(
        f"<tr><td>{esc(adr.CHANNEL_LABELS_ZH.get(channel, channel))}</td><td>{count}</td></tr>"
        for channel, count in source["channel_counter"].most_common()
    )
    recency_rows = "".join(f"<tr><td>{esc(bucket)}</td><td>{count}</td></tr>" for bucket, count in source["recency"].most_common())
    query_rows = "".join(
        f"<tr><td>{esc(query)}</td><td>{count}</td></tr>" for query, count in source["query_counter"].most_common(15)
    ) or "<tr><td colspan=2>（无搜索关键词数据）</td></tr>"

    insight_html = "".join(
        f'<div class="insight insight-{item["type"]}"><strong>{esc(item["title"])}</strong><br>{esc(item["text"])}</div>'
        for item in findings
    )

    def action_block(items: list[str]) -> str:
        return "".join(f"<li>{esc(item)}</li>" for item in items)

    suggest_html = (
        f"<div class='stats'><div class='stat-card blue'><div class='num'>{esc(pct(suggest.get('suggest_present_rate', 0)))}</div>"
        f"<div class='label'>推荐问题出现率</div></div>"
        f"<div class='stat-card green'><div class='num'>{esc(round(suggest.get('avg_suggest_count', 0), 2))}</div>"
        f"<div class='label'>平均推荐问题数</div></div></div>"
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<style>
:root {{ --blue:#1a56db; --blue-light:#dbeafe; --green:#16a34a; --green-light:#dcfce7; --orange:#ea580c; --orange-light:#fff7ed; --red:#dc2626; --red-light:#fef2f2; --gray:#64748b; --gray-light:#f1f5f9; --bg:#f8fafc; --card:#fff; --border:#e2e8f0; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ font-family:"Microsoft YaHei","PingFang SC",-apple-system,sans-serif; background:var(--bg); color:#1e293b; line-height:1.7; }}
.hero {{ background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1a56db 100%); color:#fff; padding:48px 32px; text-align:center; }}
.hero h1 {{ font-size:2.2em; margin-bottom:8px; }}
.hero .sub {{ font-size:1.05em; opacity:.75; }}
.hero .meta {{ margin-top:16px; font-size:.85em; opacity:.5; }}
.nav {{ position:sticky; top:0; z-index:100; background:rgba(255,255,255,.95); border-bottom:1px solid var(--border); padding:0 24px; display:flex; gap:8px; overflow-x:auto; }}
.nav a {{ display:block; padding:14px 14px; font-size:13px; font-weight:600; color:var(--gray); text-decoration:none; white-space:nowrap; border-bottom:2px solid transparent; }}
.nav a:hover {{ color:var(--blue); border-bottom-color:var(--blue); }}
.container {{ max-width:1100px; margin:0 auto; padding:0 24px; }}
.section {{ padding:40px 0; }}
.section-title {{ font-size:1.5em; font-weight:800; color:#0f172a; margin-bottom:20px; padding-left:16px; border-left:4px solid var(--blue); }}
.card {{ background:var(--card); border:1px solid var(--border); border-radius:12px; padding:22px; margin-bottom:16px; box-shadow:0 1px 3px rgba(0,0,0,.06); }}
.stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin:20px 0; }}
.stat-card {{ background:#fff; border:1px solid var(--border); border-radius:12px; padding:18px; text-align:center; }}
.stat-card .num {{ font-size:1.8em; font-weight:800; }}
.stat-card .label {{ font-size:.82em; color:var(--gray); margin-top:4px; }}
.stat-card.blue .num {{ color:var(--blue); }} .stat-card.green .num {{ color:var(--green); }} .stat-card.orange .num {{ color:var(--orange); }} .stat-card.red .num {{ color:var(--red); }}
table {{ width:100%; border-collapse:collapse; font-size:.92em; margin:12px 0; }}
th {{ background:var(--blue); color:#fff; padding:9px 12px; text-align:left; font-weight:500; }}
td {{ padding:9px 12px; border-bottom:1px solid var(--border); }}
tr:hover td {{ background:var(--gray-light); }}
.badge {{ display:inline-block; padding:2px 10px; border-radius:20px; font-size:.8em; font-weight:600; }}
.badge-yes {{ background:var(--green-light); color:var(--green); }} .badge-no {{ background:var(--red-light); color:var(--red); }}
.qa-card {{ background:#fff; border:1px solid var(--border); border-radius:12px; margin-bottom:14px; overflow:hidden; }}
.qa-header {{ padding:14px 18px; display:flex; align-items:center; gap:12px; cursor:pointer; list-style:none; }}
.qa-header::-webkit-details-marker {{ display:none; }}
.qa-num {{ background:var(--blue); color:#fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:.85em; flex-shrink:0; }}
.qa-num.no {{ background:var(--red); }}
.qa-question {{ font-weight:600; flex:1; }}
.qa-body {{ padding:16px 18px; border-top:1px solid var(--border); background:var(--gray-light); }}
.qa-label {{ font-size:.78em; font-weight:700; color:var(--blue); margin:12px 0 6px; }}
.qa-answer {{ background:#fff; border-radius:8px; padding:12px; white-space:pre-wrap; font-size:.9em; }}
.qa-sources {{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }}
.qa-source {{ background:#fff; border:1px solid var(--border); border-radius:6px; padding:3px 10px; font-size:.8em; color:var(--gray); }}
.source-rank {{ display:flex; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid var(--border); }}
.source-rank .rank {{ font-weight:800; color:var(--blue); min-width:24px; }}
.source-rank .name {{ font-weight:600; flex:1; }}
.source-rank .count {{ background:var(--blue-light); color:var(--blue); padding:2px 10px; border-radius:12px; font-size:.8em; font-weight:600; }}
.insight {{ padding:14px 18px; border-radius:8px; margin:10px 0; font-size:.95em; }}
.insight-warn {{ background:var(--orange-light); border-left:4px solid var(--orange); }}
.insight-danger {{ background:var(--red-light); border-left:4px solid var(--red); }}
.insight-good {{ background:var(--green-light); border-left:4px solid var(--green); }}
.insight-info {{ background:var(--blue-light); border-left:4px solid var(--blue); }}
.footer {{ background:#0f172a; color:#fff; padding:28px; text-align:center; font-size:.85em; opacity:.8; }}
@media (max-width:768px) {{ .hero h1 {{ font-size:1.5em; }} .stats {{ grid-template-columns:repeat(2,1fr); }} }}
</style>
</head>
<body>
<div class="hero"><h1>{esc(title)}</h1><div class="sub">AI 搜索可见性基线测评</div><div class="meta">采集平台：{esc(platform)} · 分析生成：{esc(collected_at)}</div></div>
<div class="nav">
  <a href="#overview">总览</a><a href="#questions">逐题分析</a><a href="#sources">信源分析</a><a href="#suggest">推荐追问</a><a href="#findings">关键发现</a><a href="#actions">行动建议</a>
</div>
<div class="container">
  <div class="section" id="overview">
    <h2 class="section-title">一、总览</h2>
    <div class="stats">{''.join(stat_cards)}</div>
    <div class="card">{insight_html}</div>
  </div>
  <div class="section" id="questions">
    <h2 class="section-title">二、逐题分析</h2>
    {''.join(qa_cards)}
  </div>
  <div class="section" id="sources">
    <h2 class="section-title">三、信源分析</h2>
    <div class="card"><h3>高权重信源域名排名</h3>{domain_rows}</div>
    <div class="card"><h3>信源类型分布</h3><table><thead><tr><th>类型</th><th>次数</th></tr></thead><tbody>{channel_rows}</tbody></table></div>
    <div class="card"><h3>引用时效</h3><table><thead><tr><th>时效</th><th>次数</th></tr></thead><tbody>{recency_rows}</tbody></table></div>
    <div class="card"><h3>豆包实际搜索关键词</h3><table><thead><tr><th>关键词</th><th>次数</th></tr></thead><tbody>{query_rows}</tbody></table></div>
  </div>
  <div class="section" id="suggest">
    <h2 class="section-title">推荐追问</h2>
    <div class="card">{suggest_html}</div>
  </div>
  <div class="section" id="findings">
    <h2 class="section-title">四、关键发现</h2>
    <div class="card">{insight_html}</div>
  </div>
  <div class="section" id="actions">
    <h2 class="section-title">五、行动建议</h2>
    <div class="card"><h3>短期（30 天）</h3><ul>{action_block(short)}</ul></div>
    <div class="card"><h3>中期（60 天）</h3><ul>{action_block(medium)}</ul></div>
    <div class="card"><h3>长期（90 天）</h3><ul>{action_block(long_term)}</ul></div>
  </div>
</div>
<div class="footer">方法说明：指标来自重复采样估计，不构成平台内部真相。时间字段以采集记录为准。</div>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 DeepSeek 样式的豆包 Web GEO 基线测评报告。")
    parser.add_argument("input_json", nargs="?", help="doubao-crawl.json 或聚合 JSON")
    parser.add_argument("--target-entity", help="目标品牌/楼盘，例如 和光书苑")
    parser.add_argument("--target-aliases", help="目标别名，逗号/竖线分隔")
    parser.add_argument("--entity-type", default="product", help="person/company/product 或 人/公司/产品")
    parser.add_argument("--brands", help="额外竞品/别名列表")
    parser.add_argument("--brands-file", help="竞品别名文件")
    parser.add_argument("--merge-runs", help="逗号分隔的多个 run 目录或 doubao-crawl.json")
    parser.add_argument("--out-dir", help="输出目录")
    parser.add_argument("--out-file", help="HTML 文件名")
    parser.add_argument("--platform", default=DEFAULT_PLATFORM, help="采集平台名称")
    parser.add_argument("--title", help="报告标题")
    parser.add_argument("--json", action="store_true", help="输出机器可读结果")
    args = parser.parse_args()

    if not args.input_json and not args.merge_runs:
        parser.error("缺少 input_json 或 --merge-runs")

    data, input_label = load_data(args)
    samples = adr.normalize_samples(data)
    plan_entries = adr.normalize_plan(data, samples)
    brands, profile = build_brands(args, data, samples)
    aliases = [alias for brand in brands for alias in brand["aliases"]]

    question_rows = compute_question_rows(samples, plan_entries, brands, aliases)
    source = compute_source_analysis(samples)
    suggest = adr.compute_suggest_metrics(samples, brands)
    timing = adr.timing_summary(samples, data.get("run") or {})

    valid = [sample for sample in samples if sample["ok"]]
    generic = [row for row in question_rows if not row["direct"]]
    direct = [row for row in question_rows if row["direct"]]
    direct_rate = adr.rate(sum(1 for row in direct if row["mentioned"]), len(direct))
    generic_rate = adr.rate(sum(1 for row in generic if row["mentioned"]), len(generic))
    target_entity = profile.get("entity") or args.target_entity or ""
    summary = {
        "总问题数": len(question_rows),
        "有效样本": len(valid),
        "完成率": pct(adr.rate(len(valid), len(samples) or 1)),
        "品牌提及率（总体）": pct(adr.rate(sum(1 for row in question_rows if row["mentioned"]), len(question_rows))),
        "品牌提及率（直接提问）": pct(direct_rate),
        "品牌提及率（泛需求）": pct(generic_rate),
        "平均引用数": round(adr.rate(sum(row["ref_count"] for row in question_rows), len(question_rows)), 1),
        "平均回答字数": round(adr.rate(sum(row["answer_chars"] for row in question_rows), len(question_rows)), 0),
        "推荐问题出现率": pct(suggest.get("suggest_present_rate", 0)),
    }

    findings = build_findings(question_rows, source, suggest, timing, target_entity)
    short, medium, long_term = build_recommendations(findings, target_entity)

    collected_at = dt.datetime.now(dt.timezone.utc).isoformat()
    default_name = f"{target_entity or '品牌'}_豆包Web基线测评报告.html" if target_entity else "豆包Web基线测评报告.html"
    out_file = Path(args.out_file) if args.out_file else Path(default_name)
    out_dir = Path(args.out_dir).resolve() if args.out_dir else Path(out_file).resolve().parent
    out_dir.mkdir(parents=True, exist_ok=True)
    html_path = out_dir / out_file.name
    md_path = html_path.with_suffix(".md")
    title = args.title or (f"{target_entity} 豆包 Web 基线测评报告" if target_entity else "豆包 Web 基线测评报告")

    html_text = render_html(title, args.platform, collected_at, summary, question_rows, source, suggest, timing, findings, short, medium, long_term)
    md_text = render_md(title, args.platform, collected_at, summary, question_rows, source, suggest, timing, findings, short, medium, long_term)
    html_path.write_text(html_text, encoding="utf-8")
    md_path.write_text(md_text, encoding="utf-8")

    result = {
        "ok": True,
        "input": input_label,
        "html": str(html_path),
        "markdown": str(md_path),
        "summary": summary,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({k: v for k, v in result.items() if k != "summary"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
