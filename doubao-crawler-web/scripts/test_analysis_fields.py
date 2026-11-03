#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANALYZER_PATH = ROOT / "scripts" / "analyze_doubao_results.py"


def load_analyzer():
    spec = importlib.util.spec_from_file_location("analyze_doubao_results", ANALYZER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load analyzer from {ANALYZER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sample_record(question: str, suggest: list[str], asked_at: str) -> dict:
    return {
        "ok": True,
        "question": question,
        "answer": {"text": "回答正文", "brief": "摘要"},
        "references": {"items": []},
        "timing": {"asked_at": asked_at, "completed_at": asked_at},
        "suggest_questions": suggest,
        "failure_reason": "",
        "transport": "doubao-thread-http",
    }


def main() -> None:
    analyzer = load_analyzer()

    # A1: explicitly provided platform targets are no longer dropped.
    explicit = analyzer.dedupe_brand_rows([["Kimi"]], explicit=True)
    assert len(explicit) == 1 and explicit[0]["name"] == "Kimi", explicit
    inferred = analyzer.dedupe_brand_rows([["Kimi"]], explicit=False)
    assert inferred == [], inferred

    # A2: capitalized English brands are no longer blanket noise.
    for name in ["GEOFlow", "Salesforce", "Notion"]:
        assert not analyzer.looks_like_noise_entity(name), name

    # normalize_samples carries timing/suggest/brief/failure_reason.
    data = {
        "schema_version": "doubao-crawler-web/v1",
        "run": {"run_id": "r1", "transport": "doubao-thread-http"},
        "samples": [
            {
                "sample_id": "q01-r01",
                "question_id": "q01",
                "question": "问题A",
                "ok": True,
                "run_id": "r1",
                "result": sample_record(
                    "问题A",
                    ["东湖尚品·云境苑的开发商是谁？", "推荐一些竞秀区的高层小区"],
                    "2026-08-03T10:00:00+08:00",
                ),
            },
            {
                "sample_id": "q02-r01",
                "question_id": "q02",
                "question": "问题B",
                "ok": True,
                "result": sample_record("问题B", [], "2026-08-03T10:05:00+08:00"),
            },
        ],
    }
    samples = analyzer.normalize_samples(data)
    assert samples[0]["suggest_questions"] == [
        "东湖尚品·云境苑的开发商是谁？",
        "推荐一些竞秀区的高层小区",
    ]
    assert samples[0]["brief"] == "摘要"
    assert samples[0]["timing"]["asked_at"] == "2026-08-03T10:00:00+08:00"
    assert samples[0]["run_id"] == "r1"

    # suggest metrics: 1/2 samples have suggestions, target appears in one.
    brands = [{"name": "东湖尚品·云境苑", "aliases": ["东湖尚品·云境苑", "云境苑"]}]
    suggest_metrics = analyzer.compute_suggest_metrics(samples, brands)
    assert suggest_metrics["valid_sample_count"] == 2
    assert suggest_metrics["samples_with_suggest"] == 1
    assert suggest_metrics["suggest_present_rate"] == 0.5
    assert suggest_metrics["avg_suggest_count"] == 1.0
    assert suggest_metrics["suggest_target_mention_rate"] == 0.5

    # timing summary sorts asked_at values.
    timing = analyzer.timing_summary(samples, {"started_at": "2026-08-03T09:00:00+08:00"})
    assert timing["first_asked_at"] == "2026-08-03T10:00:00+08:00"
    assert timing["last_asked_at"] == "2026-08-03T10:05:00+08:00"

    # question metrics expose suggest columns and per-question target.
    plan = [
        {"question_id": "q01", "question": "问题A", "target": "东湖尚品·云境苑"},
        {"question_id": "q02", "question": "问题B", "target": ""},
    ]
    qrows = analyzer.question_metrics(
        samples,
        plan,
        [alias for brand in brands for alias in brand["aliases"]],
    )
    qmap = {row["question_id"]: row for row in qrows}
    assert qmap["q01"]["suggest_present"] == 1
    assert qmap["q01"]["suggest_count"] == 2
    assert qmap["q01"]["suggest_target_mention"] == 1
    assert qmap["q01"]["target"] == "东湖尚品·云境苑"

    # merge_runs prefixes sample ids and records merged run ids.
    with tempfile.TemporaryDirectory() as temp:
        run_a = Path(temp) / "run-a" / "doubao-crawl.json"
        run_b = Path(temp) / "run-b" / "doubao-crawl.json"
        run_a.parent.mkdir(parents=True)
        run_b.parent.mkdir(parents=True)
        base = {
            "schema_version": "doubao-crawler-web/v1",
            "run": {"run_id": "r-a", "started_at": "2026-08-03T10:00:00+08:00", "finished_at": "2026-08-03T10:10:00+08:00"},
            "plan": [{"sample_id": "q01-r01", "question_id": "q01", "question": "问题A", "repeat_index": 1}],
            "samples": [
                {
                    "sample_id": "q01-r01",
                    "question_id": "q01",
                    "question": "问题A",
                    "ok": True,
                    "result": sample_record("问题A", ["追问"], "2026-08-03T10:01:00+08:00"),
                }
            ],
        }
        run_a.write_text(json.dumps(base, ensure_ascii=False), encoding="utf-8")
        base["run"]["run_id"] = "r-b"
        base["samples"][0]["result"]["timing"]["asked_at"] = "2026-08-03T11:01:00+08:00"
        run_b.write_text(json.dumps(base, ensure_ascii=False), encoding="utf-8")
        merged = analyzer.merge_runs(f"{run_a.parent},{run_b.parent}")
        assert merged["run"]["merged_run_ids"] == ["r-a", "r-b"]
        assert len(merged["samples"]) == 2
        assert merged["samples"][0]["sample_id"] == "r-a:q01-r01"
        assert merged["samples"][1]["sample_id"] == "r-b:q01-r01"

    # End-to-end: thread fixture generates a report with suggest/timing sections.
    fixture = ROOT / "fixtures" / "sample-doubao-thread-crawl.json"
    with tempfile.TemporaryDirectory() as temp:
        out_dir = Path(temp) / "report"
        python = sys.executable
        result = subprocess.run(
            [python, str(ANALYZER_PATH), str(fixture), "--out-dir", str(out_dir)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.returncode == 0, result.stderr[-2000:]
        summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
        assert summary["suggest"]["valid_sample_count"] == 1
        assert summary["suggest"]["samples_with_suggest"] == 1
        assert summary["suggest"]["suggest_present_rate"] == 1.0
        assert summary["timing"]["first_asked_at"]
        html = (out_dir / "report.html").read_text(encoding="utf-8")
        assert "推荐追问" in html
        assert "Suggested Follow-ups" in html
        assert (out_dir / "structured-data.xlsx").exists()

    print("analysis fields regression: PASS")


if __name__ == "__main__":
    main()
