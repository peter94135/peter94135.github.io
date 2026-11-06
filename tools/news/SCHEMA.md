# News data — format and rules

The site's three news pages read JSON files from the **`news-data`** branch of this repo:

| Page (site hash)              | File                     | Newest-first by |
|-------------------------------|--------------------------|-----------------|
| 供應鏈瓶頸新聞 (`#supply`)       | `news/supply-chain.json` | `date`          |
| 產業消息 (`#industry`)          | `news/industry.json`     | `event_date`    |
| 財報電話會議分析 (`#earnings`)   | `news/earnings.json`     | `date`          |
| 年報重點 (`#annual`)            | `news/annual-reports.json` | `_date`       |
| 每日軍武合約 (`#defense`)        | `news/defense.json`      | `event_date`    |

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

## 4. `news/annual-reports.json` — 年報重點

One deep read of a company's **annual report** (年報 / 10-K / 20-F / 有価証券報告書 / 사업보고서) per item.
Work only from the filing itself (open the PDF/HTML) and cite page numbers in every `source_reference`.

**Follow `tools/news/examples/annual-report.example.json` exactly** — it is a complete real record (SK hynix FY2025)
and the page renders that shape. Top level:

```json
{
  "id": "000660-ks-2025",              // <_ticker lowercased, "." → "-">-<_year>, unique
  "_ticker": "000660.KS",              // Yahoo symbol
  "_company": "SK海力士股份有限公司",     // zh name
  "_company_en": "SK hynix Inc.",
  "_market": "KR",                     // US | TW | JP | KR | HK | CN | EU ...
  "_industry": "半導體",
  "_year": "2025",                     // fiscal year
  "_date": "2026-03-17",               // filing date (YYYY-MM-DD)
  "_stance": "bullish",                // = data.headline.stance: bullish | slightly_bullish | neutral | slightly_bearish | bearish
  "data": { ...same sections as the example... },
  "sources": [{ "title": "2025 사업보고서 (DART)", "url": "https://..." }],
  "updated_at": "2026-11-06T23:05:00Z"
}
```

`data` sections (all from the example; leave a field `null` / `[]` rather than guess, numbers as numbers or numeric strings):
`schema_version`, `document`, `headline` (title, one_sentence_summary, stance, confidence, main_investment_question,
key_change_vs_prior_year), `company`, `financial_highlights` (income_statement, balance_sheet, cash_flow, liquidity,
capex, dividends), `business_segments`, `revenue_mix`, `product_portfolio`, `customers`, `supply_chain`, `competition`,
`industry_and_market`, `operating_review`, `growth_drivers`, `research_and_development`, `future_strategy`,
`company_challenges`, `risks`, `financial_and_accounting_flags`, `governance_flags`, `investment_view`,
`source_evidence`, `tags`, `data_quality`.

## 5. `news/defense.json` — 每日軍武合約

A complete real record is in `tools/news/examples/defense.example.json`.

Defense **contract events** (awards, modifications, FMS notifications, tenders, deliveries).
Prefer official sources: U.S. DoD daily contracts (defense.gov/News/Contracts), DSCA major arms sales,
Taiwan MND / 國防部, Japan ATLA / MOD, Korea DAPA, UK MoD, NATO NSPA; media reports are allowed but must be flagged.

```json
{
  "id": "us-2026-11-05-lockheed-pac3-mse",           // <country lowercased>-<YYYY-MM-DD>-<ascii-slug>, unique
  "event_date": "2026-11-05",
  "publication_date": "2026-11-05",
  "country": "US",                                   // buyer country, ISO code
  "service": "Army",                                 // Army | Navy | Air Force | Marine Corps | Space Force | Joint | Coast Guard
  "agency": "U.S. Army Contracting Command",
  "event_type": "contract_award",                    // see enum below
  "title": "Lockheed Martin awarded $9.8B for PAC-3 MSE",
  "title_zh": "洛克希德馬丁獲 98 億美元 PAC-3 MSE 飛彈合約",
  "summary": "1–3 sentences (source language ok)",
  "summary_zh": "1–3 句中文摘要；未經官方來源證實的事件以「【未查證】」開頭",
  "contractor": { "name": "Lockheed Martin", "name_raw": "Lockheed Martin Corp., Grand Prairie, Texas",
                  "ticker": "LMT", "public_company": true, "exchange": "NYSE", "parent_company": null,
                  "parent_ticker": null, "country": "US" },
  "contract": { "amount": 9800000000, "currency": "USD", "amount_type": "ceiling|obligated|estimated|unknown",
                "contract_number": "W31P4Q-25-C-0001", "quantity": null, "quantity_unit": null },
  "programs": [{ "canonical_name": "PAC-3 MSE", "name_zh": "愛國者三型飛彈段強化型", "category": "missile" }],
  "action": { "type": "new_procurement", "description_zh": "多年期量產合約" },
  "importance_score": 85,                            // 0–100
  "tags": ["patriot", "missile", "lockheed"],
  "quality": { "needs_review": false, "issues": [] }, // e.g. ["media_only_source", "amount_undisclosed"]
  "sources": [{ "publisher": "U.S. Department of Defense", "url": "https://www.defense.gov/News/Contracts/...",
                "source_type": "official|media_report", "official": true }],
  "updated_at": "2026-11-06T23:05:00Z"
}
```
`event_type` enum: `contract_award`, `contract_modification`, `foreign_military_sale`, `procurement`, `tender`,
`development`, `production`, `delivery`, `upgrade`, `sustainment`, `program_decision`, `test`, `research`, `rfp`.
`programs[].category` (snake_case): `aircraft`, `helicopter`, `drone`, `missile`, `munition`, `air_defense`, `radar_sensor`,
`electronic_warfare`, `naval`, `submarine`, `shipbuilding`, `ground_vehicle`, `artillery`, `small_arms`, `space`,
`satellite`, `cyber`, `c4isr`, `engine_propulsion`, `weapon_component`, `logistics`, `training`, `services`, `construction`, `unknown`.
`contractor.ticker` must be a Yahoo symbol of the contractor (or its listed parent in `parent_ticker`), or `null` if private.
