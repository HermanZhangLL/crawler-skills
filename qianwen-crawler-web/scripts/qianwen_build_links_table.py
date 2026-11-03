# -*- coding: utf-8 -*-
"""Build the Qianwen question -> conversation-link table (CSV + XLSX).

Qianwen exposes no public share link, so the link is the account-scoped
conversation URL `https://www.qianwen.com/chat/<session>`.

Link sources, in priority order:

1. `--group-json` (authoritative): the file written by qianwen_enumerate_group.mjs
   after the conversations were moved into the 千问分组. Each row carries
   `data-session-id` plus the visible title/question/answer snippet, so a
   question that matches a row is *provably* a real, openable conversation.
2. `--extra-links` (optional): extra validated conversations for a question
   (e.g. raw sessions that were never moved into the group but still open).
3. `--run-dir` (diagnostics only, opt-in via `--allow-raw-fallback`): the
   `chat_url` captured right after asking. In practice the rule that held up in
   production is: **sessions inside the 分组 are real; anything not in the 分组
   is broken** (the capture points at a wrong/never-saved session, and opening it
   silently redirects to /chat). So raw links are NOT written into the delivered
   table unless the caller explicitly opts in.

One question often has several conversations, because a failed attempt was
retried. `--all-links` keeps every usable conversation as its own row instead of
keeping only the first one; `--validated` then drops the rows whose link failed
validation (matched by session id).

Usage:
  python scripts/qianwen_build_links_table.py \
    --group-json group.json --run-dir runs/main --run-dir runs/gap \
    --all-links --validated validate.json \
    --questions questions.json \
    --prefix 和光书苑_千问_问题链接汇总_20260910_第2轮 \
    --group "20260910_和光书苑_千问104题_第2轮" \
    --out-dir .
"""
import argparse
import csv
import json
import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

HEADER = ["序号", "问题编号", "层级", "层级名称", "意图标签", "问题", "千问会话链接", "会话ID"]


def norm(text):
    return re.sub(r"[\s\u3000]+", "", str(text or ""))


def pick(record, *keys, default=""):
    """Return the first non-empty value among alternative field spellings.

    Question sets in this project are not normalized. Earlier rounds shipped
    `index` / `levelName` / `intent`; the 2026-09-15 round ships
    `level_name` / `intent_label` and omits `index`. Accept both, otherwise the
    序号 / 层级名称 / 意图标签 columns come out blank.
    """
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return default


def as_index(value, fallback):
    """Coerce 序号 to int so the final sort never mixes int and str."""
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return fallback


def chat_url(sid):
    return f"https://www.qianwen.com/chat/{sid}" if sid else ""


def session_of(record):
    sid = str(record.get("session_id") or "").strip()
    if not sid:
        m = re.search(r"/chat/([0-9a-zA-Z]{16,})", str(record.get("chat_url") or ""))
        sid = m.group(1) if m else ""
    return sid


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", action="append", default=[], help="run directory containing raw/ (repeatable; only used with --allow-raw-fallback)")
    ap.add_argument("--allow-raw-fallback", action="store_true", help="allow raw chat_url for questions with no 分组 hit (default: off)")
    ap.add_argument("--group-json", default="", help="group.json from qianwen_enumerate_group.mjs (authoritative)")
    ap.add_argument("--extra-links", default="", help="optional JSON list of {id, session|url} to append")
    ap.add_argument("--questions", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--group", default="")
    ap.add_argument("--round", default="")
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--all-links", action="store_true", help="emit one row per conversation instead of only the first")
    ap.add_argument("--validated", default="", help="optional validate.json; rows whose session failed are dropped")
    ap.add_argument("--emit-missing", default="", help="optional path to write questions without a usable link")
    args = ap.parse_args()

    questions = json.loads(Path(args.questions).read_text(encoding="utf-8"))
    by_text = {str(q.get("question", "")).strip(): q["id"] for q in questions}

    candidates = {q["id"]: [] for q in questions}

    def add(qid, sid, source, pos=10 ** 6):
        if not qid or qid not in candidates or not sid:
            return
        if any(c["sid"] == sid for c in candidates[qid]):
            return
        candidates[qid].append({"sid": sid, "url": chat_url(sid), "source": source, "pos": pos})

    if args.group_json and Path(args.group_json).exists():
        rows = json.loads(Path(args.group_json).read_text(encoding="utf-8"))
        normed = [(str(r.get("sid", "")), norm(r.get("text"))) for r in rows]
        for q in questions:
            qn = norm(q.get("question"))
            if not qn:
                continue
            hits = []
            for sid, text in normed:
                if not sid or not text:
                    continue
                pos = text.find(qn)
                if pos >= 0:
                    hits.append((pos, sid))
            # The earliest occurrence means the row leads with that question
            # (title/first turn) rather than mentioning it inside another answer.
            for pos, sid in sorted(hits):
                add(q["id"], sid, "group", pos)

    for run_dir in (args.run_dir if args.allow_raw_fallback else []):
        raw_dir = Path(run_dir) / "raw"
        if not raw_dir.exists():
            continue
        for p in sorted(raw_dir.glob("*.json")):
            try:
                r = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not r.get("ok"):
                continue
            sid = session_of(r)
            if not sid:
                continue
            qid = r.get("question_id") or str(r.get("sample_id", "")).replace("-r01", "")
            if not qid:
                qid = by_text.get(str(r.get("question", "")).strip(), "")
            add(qid, sid, "raw")

    if args.extra_links and Path(args.extra_links).exists():
        for item in json.loads(Path(args.extra_links).read_text(encoding="utf-8")):
            sid = str(item.get("session") or item.get("sid") or "").strip()
            if not sid:
                m = re.search(r"/chat/([0-9a-zA-Z]{16,})", str(item.get("url") or ""))
                sid = m.group(1) if m else ""
            add(str(item.get("id") or ""), sid, "extra")

    validate_note = "未校验；交付前请用 qianwen_validate_links.mjs 逐条确认链接页含对应问题"
    if args.validated and Path(args.validated).exists():
        validated = json.loads(Path(args.validated).read_text(encoding="utf-8"))
        # Only a real session id can be "removed". validate.json also contains one
        # row per *uncollected* question with an empty sid; counting those as
        # "剔除的失效会话" made the 说明 sheet report bogus removals.
        failed = {sid for sid in (str(v.get("sid") or "") for v in validated if not v.get("ok")) if sid}
        ok_sids = {sid for sid in (str(v.get("sid") or "") for v in validated if v.get("ok")) if sid}
        for qid in candidates:
            candidates[qid] = [c for c in candidates[qid] if c["sid"] not in failed]
        validate_note = f"已校验：{len(ok_sids)} 条会话打开后含对应问题；已剔除 {len(failed)} 条失效会话（同题其他有效会话照常保留）"

    rows, missing, multi = [], [], 0
    source_count = {"group": 0, "raw": 0, "extra": 0}
    for order, q in enumerate(questions, start=1):
        # Tolerate both question-set schemas (see `pick`).
        index = as_index(pick(q, "index", default=order), order)
        level = pick(q, "level")
        level_name = pick(q, "levelName", "level_name")
        intent = pick(q, "intent", "intent_label")
        items = sorted(candidates[q["id"]], key=lambda c: (c["pos"], c["sid"]))
        if not items:
            missing.append(q["id"])
            rows.append([index, q["id"], level, level_name,
                         intent, q["question"], "", ""])
            continue
        if len(items) > 1:
            multi += 1
        for c in (items if args.all_links else items[:1]):
            source_count[c["source"]] = source_count.get(c["source"], 0) + 1
            rows.append([index, q["id"], level, level_name,
                         intent, q["question"], c["url"], c["sid"]])

    rows.sort(key=lambda r: (r[0] if isinstance(r[0], int) else 999, r[1], r[7]))

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / f"{args.prefix}.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(HEADER)
        w.writerows(rows)

    wb = Workbook()
    ws = wb.active
    ws.title = "问题链接"
    ws.append(HEADER)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="4472C4")
        c.alignment = Alignment(horizontal="center", vertical="center")
    for r in rows:
        ws.append(r)
    for i, width in enumerate([6, 12, 8, 12, 26, 52, 46, 34], start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"

    ws2 = wb.create_sheet("说明")
    ws2.append(["项目", "值"])
    for k, v in [
        ("平台", "千问网页端 www.qianwen.com"),
        ("分组", args.group or "（未指定）"),
        ("轮次", args.round or "（未指定）"),
        ("问题数", len(questions)),
        ("表内链接行数", sum(1 for r in rows if r[6])),
        ("有链接的问题数", len(questions) - len(missing)),
        ("同题多链接的问题数", multi),
        ("链接来源", f"分组会话 {source_count.get('group', 0)}、raw 回退 {source_count.get('raw', 0)}、补录 {source_count.get('extra', 0)}"),
        ("取用规则", "分组内会话=真实可用；不在分组的采集地址=有问题，不写进交付表"
         if not args.allow_raw_fallback else "允许把分组外的 raw 地址写进表（--allow-raw-fallback）"),
        ("保留策略", "同题多条会话全部保留（每题一行），不去重" if args.all_links else "每题只保留第一条链接"),
        ("缺失问题", "、".join(missing) or "无"),
        ("链接说明", "千问无公开分享接口；链接为该账号内的会话 URL（chat_url），仅供账号内访问"),
        ("校验", validate_note),
    ]:
        ws2.append([k, v])
    ws2.column_dimensions["A"].width = 18
    ws2.column_dimensions["B"].width = 80

    xlsx_path = out / f"{args.prefix}.xlsx"
    wb.save(xlsx_path)

    if args.emit_missing:
        missing_set = set(missing)
        Path(args.emit_missing).write_text(
            json.dumps([q for q in questions if q["id"] in missing_set], ensure_ascii=False, indent=1),
            encoding="utf-8",
        )

    print(json.dumps({
        "questions": len(questions),
        "link_rows": sum(1 for r in rows if r[6]),
        "questions_with_link": len(questions) - len(missing),
        "multi_link_questions": multi,
        "source_count": source_count,
        "missing": missing,
        "csv": str(csv_path),
        "xlsx": str(xlsx_path),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
