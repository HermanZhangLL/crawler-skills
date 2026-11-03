#!/usr/bin/env python3
import argparse
import json
import sys
from collections import OrderedDict
from pathlib import Path


def load_dataset(args):
    if args.dataset:
        return json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    return json.loads(sys.stdin.read())


def thread_ok(sample, share_id, thread_url):
    if not sample.get("ok"):
        return "否"
    if share_id or thread_url:
        return "是"
    return ""


def main():
    parser = argparse.ArgumentParser(description="Generate question -> share link Excel from doubao-crawl.json")
    parser.add_argument("dataset", nargs="?", help="doubao-crawl.json; omit to read JSON from stdin")
    parser.add_argument("--out", required=True, help="output .xlsx path")
    args = parser.parse_args()

    data = load_dataset(args)
    rows = []
    for sample in data.get("samples", []):
        result = sample.get("result") or {}
        page = result.get("page") or {}
        timing = result.get("timing") or {}
        share_id = page.get("share_id") or ""
        thread_url = page.get("thread_url") or ""
        if not (share_id or thread_url):
            continue
        share_info = result.get("share_info") or {}
        rows.append({
            "序号": len(rows) + 1,
            "sample_id": sample.get("sample_id", ""),
            "question_id": sample.get("question_id", ""),
            "问题": sample.get("question") or result.get("question") or "",
            "轮次": sample.get("repeat_index", ""),
            "thread_url": thread_url,
            "share_id": share_id,
            "share_title": page.get("title") or share_info.get("share_name") or "",
            "asked_at": timing.get("asked_at") or sample.get("started_at") or "",
            "share_time": timing.get("share_time") or "",
            "ok": thread_ok(sample, share_id, thread_url),
            "status": sample.get("status") or "",
        })

    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit(f"openpyxl is required: {exc}") from exc

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "分享链接"
    headers = ["序号", "sample_id", "question_id", "问题", "轮次", "thread_url", "share_id", "share_title", "asked_at", "share_time", "ok", "status"]
    ws.append(headers)
    for row in rows:
        ws.append([row[h] for h in headers])
    for cell in ws[1]:
        cell.font = openpyxl.styles.Font(bold=True)
    ws.column_dimensions["D"].width = 50
    ws.column_dimensions["F"].width = 60
    ws.column_dimensions["I"].width = 26
    ws.column_dimensions["J"].width = 26

    by_question = OrderedDict()
    for row in rows:
        by_question.setdefault(row["问题"], []).append(row)
    ws2 = wb.create_sheet("按问题汇总")
    ws2.append(["问题", "分享链接数", "有效链接数", "第一条分享链接"])
    for question, qrows in by_question.items():
        ok_count = sum(1 for r in qrows if r["ok"] == "是")
        ws2.append([question, len(qrows), ok_count, qrows[0]["thread_url"] or f"https://www.doubao.com/thread/{qrows[0]['share_id']}"])
    ws2.column_dimensions["A"].width = 50
    ws2.column_dimensions["D"].width = 60

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(json.dumps({"ok": True, "rows": len(rows), "questions": len(by_question), "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()