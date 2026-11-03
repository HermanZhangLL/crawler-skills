#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


SENSITIVE_KEYS = {
    "nick_name",
    "nickname",
    "avatar_url",
    "avatar_uri",
    "tiny_url",
    "sec_sender",
    "sender_id",
    "receiver_id",
    "user_id",
    "creatorID",
    "creator_id",
    "session_key",
    "cookie",
    "cookies",
    "authorization",
    "access_token",
    "refresh_token",
    "session_id",
    "tea_uuid",
    "open_id",
    "sec_uid",
    "password",
    "secret",
}


def redact_value(value: object) -> object:
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        out: dict[str, object] = {}
        for key, item in value.items():
            if key in SENSITIVE_KEYS:
                out[key] = "[REDACTED]"
            else:
                out[key] = redact_value(item)
        return out
    return value


def redact_json_file(path: Path) -> tuple[Path, bool]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return path, False
    redacted = redact_value(data)
    redacted["redacted"] = True
    path.write_text(json.dumps(redacted, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path, True


def collect_json_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() == ".json" else []
    if path.is_dir():
        return sorted(
            [
                item
                for item in path.rglob("*.json")
                if "report" not in item.parts and "report.html" != item.name
            ]
        )
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description="Redact sensitive fields from Doubao crawl JSON files.")
    parser.add_argument("path", help="Run directory, doubao-crawl.json, or a raw sample JSON file.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    root = Path(args.path).resolve()
    if not root.exists():
        raise SystemExit(f"Path not found: {root}")

    files = collect_json_files(root)
    processed: list[str] = []
    skipped: list[str] = []
    for file in files:
        try:
            target, ok = redact_json_file(file)
        except (json.JSONDecodeError, OSError) as error:
            skipped.append(f"{file}: {error}")
            continue
        if ok:
            processed.append(str(target))

    result = {"ok": not skipped, "processed": processed, "skipped": skipped}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"Redacted {len(processed)} JSON file(s).")
        for item in processed:
            print(f"  {item}")
        for item in skipped:
            print(f"  SKIP {item}")
    raise SystemExit(0 if not skipped else 1)


if __name__ == "__main__":
    main()
