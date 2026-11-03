#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BASELINE_SCRIPT = ROOT / "scripts" / "analyze_geo_baseline.py"


def sample_record(question: str, answer: str, suggest: list[str], asked_at: str) -> dict:
    return {
        "ok": True,
        "question": question,
        "answer": {"text": answer, "brief": "摘要：" + question},
        "references": {
            "items": [
                {
                    "number": 1,
                    "source": "保定日报",
                    "domain": "epaper.bdall.com",
                    "title": "和光书苑工程播报",
                    "date": "2026-07-01T00:00:00+08:00",
                    "url": "https://epaper.bdall.com/x",
                    "summary": "工程进度",
                }
            ],
            "full": [
                {
                    "index": "1",
                    "title": "和光书苑工程播报",
                    "sitename": "保定日报",
                    "url": "https://epaper.bdall.com/x",
                    "doc_id": "doc-1",
                    "domain": "epaper.bdall.com",
                    "publish_time_second": "2026-07-01T00:00:00+08:00",
                }
            ],
        },
        "timing": {"asked_at": asked_at, "completed_at": asked_at},
        "suggest_questions": suggest,
        "failure_reason": "",
        "transport": "opencli-browser-ui",
        "search_blocks": [{"summary": "搜索 1 个关键词", "queries": ["和光书苑 交房"]}],
        "message_list": [],
        "share_info": None,
    }


def make_dataset(temp: Path) -> Path:
    dataset = {
        "schema_version": "doubao-crawler-web/v1",
        "run": {
            "run_id": "baseline-test",
            "started_at": "2026-08-04T00:00:00+08:00",
            "finished_at": "2026-08-04T00:30:00+08:00",
            "engine": "doubao",
            "transport": "opencli-browser-ui",
        },
        "input": {
            "question_count": 2,
            "global_repeat": 1,
            "questions": [
                {"id": "q01", "question": "保定市区买小高层，推荐个新交付或即将交付的小区", "repeat": 1},
                {"id": "q02", "question": "和光书苑什么时候交房，是否有延期风险", "repeat": 1},
            ],
        },
        "plan": [
            {"sample_id": "q01-r01", "question_id": "q01", "question": "保定市区买小高层，推荐个新交付或即将交付的小区", "repeat_index": 1},
            {"sample_id": "q02-r01", "question_id": "q02", "question": "和光书苑什么时候交房，是否有延期风险", "repeat_index": 1},
        ],
        "samples": [
            {
                "sample_id": "q01-r01",
                "question_id": "q01",
                "question": "保定市区买小高层，推荐个新交付或即将交付的小区",
                "repeat_index": 1,
                "ok": True,
                "result": sample_record(
                    "保定市区买小高层，推荐个新交付或即将交付的小区",
                    "推荐和光书苑，2026年12月交房，低密小高层。",
                    ["和光书苑对比紫华学府，有什么优劣势？", "保定东部还有哪些新交付小区？"],
                    "2026-08-04T10:00:00+08:00",
                ),
            },
            {
                "sample_id": "q02-r01",
                "question_id": "q02",
                "question": "和光书苑什么时候交房，是否有延期风险",
                "repeat_index": 1,
                "ok": True,
                "result": sample_record(
                    "和光书苑什么时候交房，是否有延期风险",
                    "和光书苑合同约定2026年12月31日交房，目前全线封顶，延期风险较低。",
                    ["和光书苑的学区是哪？"],
                    "2026-08-04T10:05:00+08:00",
                ),
            },
        ],
        "totals": {},
    }
    path = temp / "doubao-crawl.json"
    path.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def run_baseline(dataset: Path, out_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(BASELINE_SCRIPT),
            str(dataset),
            "--target-entity",
            "和光书苑",
            "--entity-type",
            "product",
            "--out-dir",
            str(out_dir),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        dataset = make_dataset(temp)
        out_dir = temp / "report"
        result = run_baseline(dataset, out_dir)
        assert result.returncode == 0, result.stderr[-2000:]
        html = out_dir / "和光书苑_豆包Web基线测评报告.html"
        md = out_dir / "和光书苑_豆包Web基线测评报告.md"
        assert html.exists(), "HTML not generated"
        assert md.exists(), "Markdown not generated"
        text = html.read_text(encoding="utf-8")
        for marker in ["一、总览", "二、逐题分析", "三、信源分析", "推荐追问", "四、关键发现", "五、行动建议", "和光书苑"]:
            assert marker in text, f"missing marker: {marker}"
        assert "epaper.bdall.com" in text, "source domain missing"
        assert "和光书苑对比紫华学府" in text, "suggest questions missing"

        # fixture smoke: output must exist for the bundled thread fixture
        fixture = ROOT / "fixtures" / "sample-doubao-thread-crawl.json"
        fixture_out = temp / "fixture-report"
        result2 = run_baseline(fixture, fixture_out)
        assert result2.returncode == 0, result2.stderr[-2000:]
        assert any(fixture_out.glob("*.html")), "fixture HTML not generated"

    print("geo baseline report regression: PASS")


if __name__ == "__main__":
    main()
