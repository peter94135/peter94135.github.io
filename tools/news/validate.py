#!/usr/bin/env python3
"""Validate and normalise the news JSON files (see tools/news/SCHEMA.md).

Usage:
    python3 tools/news/validate.py <data-dir>          # check only
    python3 tools/news/validate.py <data-dir> --fix    # also sort newest-first, drop exact
                                                       # duplicate ids, stamp "updated", rewrite

<data-dir> is the folder that holds supply-chain.json, industry.json and earnings.json
(e.g. the news/ folder of a news-data branch checkout). Missing files are created empty.
Exit code 1 if any error remains. Standard library only.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TICKER = re.compile(r"^[0-9A-Z][0-9A-Z.\-&]*$")
SENTS = {"bullish", "bearish", "neutral"}
EVENT_TYPES = {"supplier_change", "supply_agreement", "capacity", "raw_material_bom",
               "supply_disruption", "trade_policy", "strategic_investment", "permit_regulatory"}
TIERS = {"critical", "high", "relevant"}
EVIDENCE = {"confirmed", "reported", "inferred", "rumor"}
ROLES = {"supplier", "customer", "new_supplier", "incumbent_supplier", "investor", "investee",
         "regulator", "disruptor", "affected_party"}

FILES = {
    "supply-chain.json": "date",
    "industry.json": "event_date",
    "earnings.json": "date",
}


def req_str(it, key, errs, where):
    v = it.get(key)
    if not isinstance(v, str) or not v.strip():
        errs.append(f"{where}: missing/empty '{key}'")
        return None
    return v


def check_date(it, key, errs, where):
    v = req_str(it, key, errs, where)
    if v and not DATE.match(v):
        errs.append(f"{where}: '{key}' must be YYYY-MM-DD, got {v!r}")


def check_tickers(lst, errs, where):
    if not isinstance(lst, list):
        errs.append(f"{where}: 'tickers' must be a list")
        return
    for t in lst:
        if not isinstance(t, str) or not TICKER.match(t):
            errs.append(f"{where}: bad ticker {t!r} (use Yahoo form, e.g. 2330.TW)")


def check_sources(it, errs, where, url_key="url"):
    src = it.get("sources")
    if not isinstance(src, list) or not src:
        errs.append(f"{where}: needs at least one source")
        return
    for s in src:
        if not isinstance(s, dict) or not str(s.get(url_key, "")).startswith("http"):
            errs.append(f"{where}: source without http(s) url: {s!r}")


def check_supply(it, errs, where):
    req_str(it, "id", errs, where)
    check_date(it, "date", errs, where)
    req_str(it, "headline", errs, where)
    req_str(it, "content", errs, where)
    if it.get("sentiment") not in SENTS:
        errs.append(f"{where}: sentiment must be one of {sorted(SENTS)}")
    if it.get("credibility") not in (None, "高", "中", "低"):
        errs.append(f"{where}: credibility must be 高/中/低")
    check_tickers(it.get("tickers", []), errs, where)
    check_sources(it, errs, where)


def check_industry(it, errs, where):
    v = req_str(it, "id", errs, where)
    if v and not re.match(r"^SC-\d{8}-\d{3}$", v):
        errs.append(f"{where}: id must look like SC-YYYYMMDD-NNN")
    check_date(it, "event_date", errs, where)
    req_str(it, "title_zh", errs, where)
    req_str(it, "summary_zh", errs, where)
    if it.get("event_type") not in EVENT_TYPES:
        errs.append(f"{where}: event_type must be one of {sorted(EVENT_TYPES)}")
    for t in it.get("event_type_secondary", []) or []:
        if t not in EVENT_TYPES:
            errs.append(f"{where}: bad event_type_secondary {t!r}")
    if it.get("importance_tier") not in TIERS:
        errs.append(f"{where}: importance_tier must be one of {sorted(TIERS)}")
    sc = it.get("importance_score")
    if sc is not None and not (isinstance(sc, (int, float)) and 0 <= sc <= 100):
        errs.append(f"{where}: importance_score must be a number 0-100")
    if it.get("evidence_level") not in EVIDENCE:
        errs.append(f"{where}: evidence_level must be one of {sorted(EVIDENCE)}")
    check_tickers(it.get("tickers", []), errs, where)
    for c in it.get("companies", []) or []:
        if c.get("role") and c["role"] not in ROLES:
            errs.append(f"{where}: bad company role {c['role']!r}")
        if c.get("ticker") and not TICKER.match(c["ticker"]):
            errs.append(f"{where}: bad company ticker {c['ticker']!r}")
    check_sources(it, errs, where)


def check_earnings(it, errs, where):
    v = req_str(it, "id", errs, where)
    t = req_str(it, "ticker", errs, where)
    if t:
        check_tickers([t], errs, where)
    y = req_str(it, "year", errs, where)
    q = req_str(it, "quarter", errs, where)
    if q and q not in ("Q1", "Q2", "Q3", "Q4"):
        errs.append(f"{where}: quarter must be Q1-Q4")
    if v and t and y and q:
        want = f"{t.lower().replace('.', '-')}-{y}-{q.lower()}"
        if v != want:
            errs.append(f"{where}: id should be {want!r}")
    check_date(it, "date", errs, where)
    req_str(it, "summary", errs, where)
    hls = it.get("highlights")
    if not isinstance(hls, list) or not hls:
        errs.append(f"{where}: needs highlights")
    else:
        for h in hls:
            if not isinstance(h, dict) or not h.get("text") or h.get("sentiment") not in SENTS:
                errs.append(f"{where}: highlight needs text + sentiment: {h!r}")
    check_sources(it, errs, where)


CHECKS = {"supply-chain.json": check_supply, "industry.json": check_industry, "earnings.json": check_earnings}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    root = Path(sys.argv[1])
    fix = "--fix" in sys.argv[2:]
    root.mkdir(parents=True, exist_ok=True)
    total_errs = 0
    for name, date_key in FILES.items():
        path = root / name
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                print(f"[{name}] invalid JSON: {e}")
                total_errs += 1
                continue
        else:
            data = {"updated": None, "items": []}
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            print(f"[{name}] top level must be {{'updated', 'items': [...]}}")
            total_errs += 1
            continue
        errs, seen, unique = [], set(), []
        for i, it in enumerate(items):
            where = f"[{name}] item {i} ({it.get('id', '?') if isinstance(it, dict) else '?'})"
            if not isinstance(it, dict):
                errs.append(f"{where}: not an object")
                continue
            if it.get("id") in seen:
                if fix:
                    continue
                errs.append(f"{where}: duplicate id")
            seen.add(it.get("id"))
            CHECKS[name](it, errs, where)
            unique.append(it)
        for e in errs:
            print(e)
        total_errs += len(errs)
        print(f"[{name}] {len(unique)} items, {len(errs)} error(s)")
        if fix:
            unique.sort(key=lambda x: (str(x.get(date_key, "")), str(x.get("id", ""))), reverse=True)
            out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "items": unique}
            path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    sys.exit(1 if total_errs else 0)


if __name__ == "__main__":
    main()
