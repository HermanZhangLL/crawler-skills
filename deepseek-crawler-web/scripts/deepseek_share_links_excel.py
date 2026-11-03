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


def main():
    parser = argparse.ArgumentParser(description="Generate question -> share link Excel from deepseek-crawl.json")
    parser.add_argument("dataset", nargs="?", help="deepseek-crawl.json; omit to read JSON from stdin")
    parser.add_argument("--out", required=True, help="output .xlsx path")
    args = parser.parse_args()

    data = load_dataset(args)
    rows = []
    for sample in data.get("samples", []):
        result = sample.get("result") or {}
        share = result.get("share") or {}
        share_id = share.get("share_id")
        if not share_id:
            continue
        ok = share.get("share_ok")
        if ok is True or ok == 1 or str(ok).lower() == "true":
            ok_label = "是"
        else:
            ok_label = "否" if ok is not None else ""
        rows.append({
            "序号": len(rows) + 1,
            "sample_id": sample.get("sample_id", ""),
            "question_id": sample.get("question_id", ""),
            "问题": sample.get("question") or result.get("question") or "",
            "轮次": sample.get("repeat_index", ""),
            "share_id": share_id,
            "分享链接": share.get("url") or f"https://chat.deepseek.com/share/{share_id}",
            "share_ok": ok_label,
        })

    try:
        import openpyxl
    except ImportError as exc:
        raise SystemExit(f"openpyxl is required: {exc}") from exc

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "分享链接"
    headers = ["序号", "sample_id", "question_id", "问题", "轮次", "share_id", "分享链接", "share_ok"]
    ws.append(headers)
    for row in rows:
        ws.append([row[h] for h in headers])
    for cell in ws[1]:
        cell.font = openpyxl.styles.Font(bold=True)
    ws.column_dimensions["D"].width = 50
    ws.column_dimensions["G"].width = 60

    by_question = OrderedDict()
    for row in rows:
        by_question.setdefault(row["问题"], []).append(row)
    ws2 = wb.create_sheet("按问题汇总")
    ws2.append(["问题", "分享链接数", "有效链接数", "第一条分享链接"])
    for question, qrows in by_question.items():
        ok_count = sum(1 for r in qrows if r["share_ok"] == "是")
        ws2.append([question, len(qrows), ok_count, qrows[0]["分享链接"]])
    ws2.column_dimensions["A"].width = 50
    ws2.column_dimensions["D"].width = 60

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(json.dumps({"ok": True, "rows": len(rows), "questions": len(by_question), "out": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
