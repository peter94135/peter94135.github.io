# News data — format and rules

The site's three news pages read JSON files from the **`news-data`** branch of this repo:

| Page (site hash)              | File                     | Newest-first by |
|-------------------------------|--------------------------|-----------------|
| 供應鏈瓶頸新聞 (`#supply`)       | `news/supply-chain.json` | `date`          |
| 產業消息 (`#industry`)          | `news/industry.json`     | `event_date`    |
| 財報電話會議分析 (`#earnings`)   | `news/earnings.json`     | `date`          |

Each file is `{ "updated": "<ISO-8601 UTC>", "items": [ ... ] }`.
The `news-data` branch holds **only** these files (it is an orphan branch, unrelated to `main`).
`tools/news/validate.py` (on `main`) checks and normalises them; run it before every commit.

## Common rules

- All prose (headlines, summaries, notes) in **Traditional Chinese (zh-TW)**, Taiwan wording.
  Proper nouns may stay in English. `title_original` keeps the source language.
- Tickers use **Yahoo Finance** symbols: `NVDA`, `2330.TW` (TWSE), `6488.TWO` (TPEx), `8035.T`,
  `000660.KS` (KOSPI), `095340.KQ` (KOSDAQ), `0700.HK`, `ASML.AS`. Never `2330-TW`, `TPE:2330`, etc.
  Prefer tickers listed in `tools/news/watchlist.json`; other listed companies are fine when central to the story.
- Only real, verifiable news. Every item needs at least one working source URL that you actually opened.
  Do not invent numbers, quotes or dates; leave optional fields out instead of guessing.
- Dates are `YYYY-MM-DD` (the date the news/event happened, Asia/Taipei).
- Never rewrite or delete existing items, except to fix a broken ticker. Append new ones.
- `updated_at` on each item: ISO-8601 UTC time you wrote it.

## 1. `news/supply-chain.json` — 供應鏈瓶頸新聞

Supply-chain **bottlenecks**: shortages, export bans, capacity limits, price spikes of materials or components
(e.g. tin, gallium, HBM, CoWoS, T-glass, transformers, rare earths).

```json
{
  "id": "2026-11-06-indonesia-tin-export-ban",      // YYYY-MM-DD-<ascii-slug>, unique
  "date": "2026-11-06",
  "headline": "印尼考慮全面禁止錫礦出口，逼下游焊料、封裝產業當地設廠",
  "content": "2–4 句事實摘要（誰、什麼、數字、時間）。",
  "sentiment": "bearish",                           // bullish | bearish | neutral (for the affected industry)
  "credibility": "中",                               // 高 | 中 | 低
  "tickers": ["TINS.JK", "2313.TW"],
  "tags": ["錫", "焊料短缺", "印尼出口管制"],
  "chain": {                                         // optional; each side optional
    "upstream":   [{ "name": "印尼(PT Timah等)", "note": "全球約3成供給" }],
    "midstream":  [{ "name": "焊料與錫化學品廠", "note": "保供壓力" }],
    "downstream": [{ "name": "半導體封裝與PCB組裝廠", "note": "成本上升" }]
  },
  "alternatives": [                                  // optional
    { "name": "印尼原礦出口", "share": "約30%", "incumbent": true, "note": "現行主要來源" },
    { "name": "緬甸佤邦 / 剛果礦源", "share": "次要", "note": "難以填補缺口" }
  ],
  "effect":  "下游影響（1–3 句）",
  "signals": "財報 / 逐字稿 / 報價等可驗證線索（optional）",
  "advise":  "投資觀察建議（中性用語，非買賣建議）",
  "sources": [{ "title": "MINING.COM", "url": "https://..." }],
  "updated_at": "2026-11-06T23:05:00Z"
}
```

## 2. `news/industry.json` — 產業消息

Company-level supply-chain **events** relevant to watchlist names.

```json
{
  "id": "SC-20261106-001",                           // SC-YYYYMMDD-NNN (NNN = 001.. per day), unique
  "event_date": "2026-11-06",
  "published_at": "2026-11-06",
  "title_zh": "三星6兆韓元溫陽HBM新廠動土在即，平澤P5獲准三廠體改建",
  "title_original": "Samsung to Break Ground on KRW 6T Onyang HBM Fab ...",
  "summary_zh": "3–5 句事實摘要。",
  "why_it_matters": "為何重要（對供需、價格、市占、哪些公司受惠或受害）。",
  "event_type": "capacity",                          // see enum below
  "event_type_secondary": ["permit_regulatory"],     // optional, same enum
  "importance_tier": "high",                         // critical | high | relevant
  "importance_score": 79,                            // 0–100
  "evidence_level": "reported",                      // confirmed | reported | inferred | rumor
  "tickers": ["005930.KS"],
  "companies": [{ "name": "Samsung Electronics", "ticker": "005930.KS", "exchange": "KRX", "country": "KR", "role": "supplier" }],
  "supply_chain": {                                  // optional; arrays of short strings ("component" may be a string)
    "upstream": ["silicon wafer"], "component": "HBM / DRAM", "supplier": ["Samsung Electronics"],
    "customer": ["NVIDIA", "AMD"], "end_market": ["AI infrastructure"]
  },
  "change": { "type": "capacity_expansion", "before": "...", "after": "..." },   // optional
  "financial_data": {                                // optional; numbers as numbers, unknown → omit
    "amount": 6000000000000, "currency": "KRW", "capacity_change_pct": 50,
    "price_change_pct": null, "revenue_exposure_pct": null, "contract_duration_years": null, "effective_date": "2026-09-01"
  },
  "themes": ["HBM", "memory", "advanced packaging"],
  "regions": ["KR"],                                 // ISO country codes
  "products": ["HBM", "DRAM"], "materials": [],
  "search_keywords": ["samsung", "三星", "hbm", "高頻寬記憶體", "005930.ks"],   // lowercase, zh + en, 10–30 terms
  "sources": [{ "publisher": "BusinessKorea", "url": "https://...", "source_type": "news", "is_primary": true }],
  "updated_at": "2026-11-06T23:05:00Z"
}
```

`event_type` enum: `supplier_change`, `supply_agreement`, `capacity`, `raw_material_bom`,
`supply_disruption`, `trade_policy`, `strategic_investment`, `permit_regulatory`.
`companies[].role` enum: `supplier`, `customer`, `new_supplier`, `incumbent_supplier`, `investor`,
`investee`, `regulator`, `disruptor`, `affected_party`.

## 3. `news/earnings.json` — 財報電話會議分析

One item per company per quarter, for **watchlist companies** that held an earnings call / 法說會.

```json
{
  "id": "031980-kq-2026-q2",                         // <ticker lowercased, "." → "-">-<year>-q<n>, unique
  "ticker": "031980.KQ",
  "company": "PSK Holdings Inc.",
  "year": "2026",                                    // fiscal year as reported
  "quarter": "Q2",                                   // Q1–Q4
  "date": "2026-08-24",                              // call date
  "summary": "一句話總結本次財報電話會議。",
  "highlights": [                                    // 5–8 points, each with a sentiment
    { "text": "Q2營收473億韓元、營業利益138億韓元，季增69%與50%，但低於市場預期。", "sentiment": "neutral" },
    { "text": "...", "sentiment": "bullish" },
    { "text": "...", "sentiment": "bearish" }
  ],
  "watch": ["後續要追蹤的事項（3–6 項）"],
  "sources": [{ "title": "Company IR — Q2 2026 results", "url": "https://..." }],
  "updated_at": "2026-11-06T23:05:00Z"
}
```
