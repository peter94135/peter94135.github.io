#!/usr/bin/env python3
"""Append this run's new items onto the latest news-data files.

Used when `git push origin news-data` is rejected because the branch moved (another run pushed
first, or the branch did not exist when this run started).

Usage:
    python3 tools/news/merge.py <new-items-dir> <news-dir>

<new-items-dir> holds one JSON file per news file (same names, e.g. supply-chain.json), each
either a list of items or {"items": [...]} — the items this run wants to add.
<news-dir> is the news/ folder of a checkout reset to origin/news-data.
Items whose id already exists in <news-dir> are skipped (the remote copy wins).
Afterwards run: python3 tools/news/validate.py <news-dir> --fix
"""
import json
import sys
from pathlib import Path


def items_of(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("items", []) if isinstance(data, dict) else data


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    new_dir, news_dir = Path(sys.argv[1]), Path(sys.argv[2])
    news_dir.mkdir(parents=True, exist_ok=True)
    for src in sorted(new_dir.glob("*.json")):
        dst = news_dir / src.name
        current = json.loads(dst.read_text(encoding="utf-8")) if dst.exists() else {"updated": None, "items": []}
        have = {it.get("id") for it in current.get("items", [])}
        added = [it for it in items_of(src) if it.get("id") not in have]
        current["items"] = current.get("items", []) + added
        dst.write_text(json.dumps(current, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"[{src.name}] +{len(added)} (skipped {len(items_of(src)) - len(added)} already present)")


if __name__ == "__main__":
    main()
