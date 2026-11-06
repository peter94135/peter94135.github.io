# News data — format and rules

The site's news pages read JSON files from the **`news-data`** branch of this repo:

| Page (site hash)              | File                     | Newest-first by |
|-------------------------------|--------------------------|-----------------|
| 供應鏈瓶頸新聞 (`#supply`)       | `news/supply-chain.json` | `date`          |
| 產業消息 (`#industry`)          | `news/industry.json`     | `event_date`    |
| 財報電話會議分析 (`#earnings`)   | `news/earnings.json`     | `date`          |
| 年報重點 (`#annual`)            | `news/annual-reports.json` | `_date`       |
| 每日軍武合約 (`#defense`)        | `news/defense.json`      | `event_date`    |
| 產業動態 (`#dynamics`)          | `news/industry-dynamics.json` | `event_date` |
| 軍武動態 (`#military`)          | `news/military.json`     | `event_date`    |

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

## 6. `news/industry-dynamics.json` — 產業動態

A complete record is in `tools/news/examples/industry-dynamics.example.json`.

Major **industry events across technology sectors**, not only watchlist companies: contract awards, government
funding, capacity expansions/cuts, commercial deployments, technology milestones, supply agreements, partnerships,
M&A/investments, regulation, permits, production disruptions, pricing/supply shifts. This differs from `industry.json`
(產業消息), which tracks supply-chain changes of watchlist companies. Do not put the same story in both files.

```json
{
  "id": "IN-20261107-001",                           // IN-<YYYYMMDD of event_date>-<NNN>, unique
  "event_date": "2026-11-07",
  "published_at": "2026-11-07T09:00:00+08:00",       // source publication time
  "industry": "data_center",                         // enum below
  "industries_secondary": ["power_grid_utilities"],
  "event_type": "capacity_expansion",                // enum below
  "event_type_secondary": [],
  "importance_score": 84,                            // 65–100; below 65 → leave the event out
  "importance_tier": "high",                         // critical (≥90) | high (78–89) | relevant (65–77)
  "evidence_level": "confirmed",                     // confirmed | reported | inferred | rumor
  "title_zh": "…", "title_original": "…",
  "summary_zh": "2–4 句事實摘要",
  "why_it_matters": "1–2 句：對價值鏈 / 上市公司的影響",
  "themes": ["AI data center", "liquid cooling"],     // short English or Chinese phrases
  "regions": ["US"],
  "tickers": ["VRT"],                                // Yahoo symbols of directly involved listed companies
  "companies": [{ "name": "Vertiv", "ticker": "VRT", "country": "US", "role": "supplier",
                  "impact_direction": "positive", "impact_mechanism": "一句話說明" }],
  "content_nodes": [                                 // 3–6 nodes; node_type enum below
    { "node_type": "event_facts", "title_zh": "事件核心", "summary_zh": "…", "bullets": ["…"], "evidence": "confirmed" }
  ],
  "supply_chain": { "upstream": [], "component": [], "supplier": [], "customer": [], "end_market": [] },
  "products": [], "metrics": [{ "name": "…", "value": 120, "unit": "MW", "period": "2026" }],
  "milestones": [{ "date": "2027-03", "label_zh": "…", "status": "planned" }],
  "watch_items": [{ "question_zh": "…", "indicator": "…" }],
  "financial_data": { "amount": 1500000000, "currency": "USD" },   // optional
  "search_keywords": ["…"],
  "sources": [{ "publisher": "Reuters", "url": "https://…", "is_primary": true }],
  "updated_at": "2026-11-07T00:05:00Z"
}
```
`industry` enum: `semiconductor_manufacturing`, `electronics_chip_design`, `data_center`, `robotics_automation`,
`power_grid_utilities`, `power_generation`, `nuclear`, `solar_storage`, `ev_battery`, `space`, `mining`, `defense`,
`telecom`, `other`.
`event_type` enum: `contract_award`, `government_funding`, `capacity_expansion`, `capacity_reduction`,
`commercial_deployment`, `technology_milestone`, `supply_agreement`, `partnership_joint_venture`,
`merger_acquisition_investment`, `regulatory_policy`, `permit_authorization`, `production_disruption`, `pricing_supply_shift`.
`content_nodes[].node_type` enum: `event_facts`, `technology_mechanism`, `value_chain_position`, `investment_impact`,
`beneficiaries`, `affected_parties`, `timeline_milestones`, `kpi_watch`, `risks_unknowns`, `policy_mechanism`.
`companies[].impact_direction`: `positive` | `negative` | `mixed` | `neutral`. Unlisted companies get `"ticker": null`.

## 7. `news/military.json` — 軍武動態

A complete record is in `tools/news/examples/military.example.json`.

Global **military activity**: weapon unveilings, tests, first flights, sea trials, fielding, deployments, exercises,
combat use/losses, program milestones/delays/cancellations, service entry/retirement, military cooperation,
infrastructure, incidents. No contract money here — contracts go to `defense.json`.

```json
{
  "id": "jp-2026-11-06-type-12-ssm-test",           // <country lowercased>-<YYYY-MM-DD>-<ascii-slug>, unique
  "event_date": "2026-11-06",
  "event_end_date": null,                            // multi-day events
  "publication_date": "2026-11-06",
  "country": "JP",                                   // acting country, ISO 3166-1 alpha-2
  "countries_involved": ["JP"],
  "service": "Army",                                 // Army | Navy | Air Force | Marine Corps | Space Force | Coast Guard | Joint | Other
  "agency": "Japan Ground Self-Defense Force",
  "event_type": "weapon_test",                       // enum below
  "event_status": "completed",                       // planned | ongoing | completed
  "event_phase": "test",
  "theater": "Indo-Pacific",
  "title": "English title", "title_zh": "中文標題", "title_original": "source-language title",
  "summary": "1–3 sentences", "summary_zh": "1–3 句中文摘要；僅媒體來源者以「【未查證】」開頭",
  "why_it_matters_zh": "1–2 句",
  "systems": [{ "canonical_name": "Type 12 SSM (upgraded)", "name_zh": "12 式反艦飛彈（改良型）",
                "category": "missile", "operator_country": "JP" }],
  "programs": [], "units": [{ "name": "…", "country": "JP", "service": "Army" }],
  "exercise":   { "exercise_name": "…", "host_country": "JP", "participant_countries": ["JP","US"],
                  "start_date": "2026-11-01", "end_date": "2026-11-10", "scale": "…", "live_fire": true },
  "deployment": { "deployment_type": "…", "destination": "…", "start_date": "…", "end_date": null, "stated_purpose": "…" },
  "test":       { "test_type": "…", "result": "success|failure|partial|unknown", "objective_zh": "…" },
  "locations": [{ "name": "Shizuoka (Higashi-Fuji)", "country_code": "JP", "precision": "facility",
                  "geometry": { "type": "Point", "coordinates": [138.8, 35.3] },   // [lon, lat]
                  "geocode_confidence": "high", "map_display_allowed": true }],
  "map": { "marker_category": "weapon_test", "active_from": "2026-11-06", "active_until": "2026-11-06" },
  "importance": { "score": 60 },                     // 0–100
  "tags": ["type-12", "anti-ship-missile"],
  "quality": { "verification_status": "official_confirmed", "needs_review": false, "issues": [] },
  "sources": [{ "publisher": "Japan Ministry of Defense", "url": "https://…", "official": true }],
  "updated_at": "2026-11-07T00:05:00Z"
}
```
Only include the `exercise` / `deployment` / `test` / `combat` / `milestone` / `incident` blocks that apply.
`event_type` enum: `weapon_unveiling`, `prototype_rollout`, `first_flight`, `sea_trial`, `weapon_test`, `evaluation_trial`,
`certification`, `operational_fielding`, `readiness_milestone`, `deployment`, `exercise`, `combat_use`, `combat_loss`,
`program_launch`, `program_milestone`, `program_delay`, `program_restructure`, `program_cancellation`, `service_entry`,
`retirement`, `doctrine_strategy`, `military_cooperation`, `force_structure`, `military_infrastructure`,
`intelligence_assessment`, `incident_accident`, `capability_acquisition`, `other_military_news`.
`map.marker_category` uses the same enum (usually equal to `event_type`).
`quality.verification_status`: `official_confirmed`, `multi_source_confirmed`, `single_reliable_source`, `claim_only`,
`conflicting`, `unresolved`. Media-only items: `needs_review: true` and the 【未查證】 prefix.
`systems[].category`: `aircraft`, `helicopter`, `missile`, `munition`, `air_defense`, `ground_vehicle`, `artillery`, `naval`,
`submarine`, `drone`, `counter_uas`, `radar_sensor`, `electronic_warfare`, `space`, `cyber`, `c4isr`, `engine_propulsion`,
`directed_energy`, `hypersonic`, `nuclear`, `small_arms`, `weapon_component`, `infrastructure`, `support`, `unknown`.
**Locations:** only places the source discloses publicly (base, port, city, sea area); never estimate positions of
units in the field. `precision`: `facility` | `city` | `admin1` | `country` | `sea_region` | `theater`. Coarse places
(country / sea region / theater) get `geocode_confidence: "low"` and are drawn as a faded halo.
Exercises and deployments must carry dates (`exercise.start_date`/`end_date` or `map.active_from`/`active_until`) so the
map can tell 進行中 / 即將開始 / 已結束.

