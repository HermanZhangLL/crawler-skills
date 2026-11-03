#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REDACT_SCRIPT = ROOT / "scripts" / "redact_run.py"


def main() -> None:
    with tempfile.TemporaryDirectory() as temp:
        run_dir = Path(temp) / "run"
        raw_dir = run_dir / "raw"
        raw_dir.mkdir(parents=True)
        dataset = {
            "schema_version": "doubao-crawler-web/v1",
            "run": {"run_id": "r-secret"},
            "samples": [
                {
                    "sample_id": "q01-r01",
                    "ok": True,
                    "result": {
                        "share_info": {"user": {"nick_name": "Herman6056", "avatar_url": "https://avatar/1"}},
                        "message_list": [{"sec_sender": "MS4wLjABAAAAsecret", "sender_id": "2996590763578064"}],
                        "answer": {"text": "公开内容"},
                    },
                }
            ],
        }
        (run_dir / "doubao-crawl.json").write_text(json.dumps(dataset, ensure_ascii=False), encoding="utf-8")
        raw = {
            "ok": True,
            "question": "问题",
            "timing": {"asked_at": "2026-08-03T10:00:00+08:00"},
            "share_info": {"user": {"nick_name": "Herman6056"}},
        }
        (raw_dir / "q01-r01.json").write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")

        python = sys.executable
        result = subprocess.run(
            [python, str(REDACT_SCRIPT), str(run_dir), "--json"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stderr

        redacted = json.loads((run_dir / "doubao-crawl.json").read_text(encoding="utf-8"))
        text = json.dumps(redacted, ensure_ascii=False)
        assert redacted["redacted"] is True
        assert "Herman6056" not in text
        assert "MS4wLjABAAAAsecret" not in text
        assert "2996590763578064" not in text
        assert "[REDACTED]" in text
        assert "公开内容" in text

        raw_redacted = json.loads((raw_dir / "q01-r01.json").read_text(encoding="utf-8"))
        assert raw_redacted["redacted"] is True
        assert "Herman6056" not in json.dumps(raw_redacted, ensure_ascii=False)

        # Idempotent second run still succeeds.
        result2 = subprocess.run(
            [python, str(REDACT_SCRIPT), str(run_dir), "--json"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result2.returncode == 0, result2.stderr
        payload = json.loads(result2.stdout)
        assert len(payload["processed"]) >= 2

    print("redact run regression: PASS")


if __name__ == "__main__":
    main()
