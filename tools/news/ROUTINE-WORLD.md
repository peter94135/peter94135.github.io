# Daily world news job: 產業動態 + 軍武動態 (run by a Claude cloud routine)

You are updating two pages of https://peter94135.github.io for a Taiwan-based investor:
**產業動態** (`news/industry-dynamics.json`) and **軍武動態** (`news/military.json`).
The data format is in `tools/news/SCHEMA.md` sections 6 and 7 (read "Common rules" too), with one complete
record each in `tools/news/examples/industry-dynamics.example.json` and `tools/news/examples/military.example.json`.
Read those files first. A separate routine fills the other news files; do not touch them except through the
validator (step 5).

## Hard rules

- Only ever commit to and push the **`news-data`** branch. Never commit to, push to, or open a PR
  against `main` or any other branch. Never edit files outside the `news/` folder of `news-data`.
- Never rewrite or remove existing items. Only append. Exceptions: fix a malformed ticker, country code, or an
  obvious typo in a name — mention any such fix in the report.
- Every item must come from real reporting you actually opened (WebFetch) during this run, with its URL in
  `sources`. If you cannot verify something, leave it out. Quality over quantity: zero new items in a section
  is fine on a quiet day.
- Text in Traditional Chinese (zh-TW, Taiwan wording), factual and neutral. No buy/sell calls.
- Never present an older story as new: check the article's own date is within the window.

## Sourcing standard

- **Open the original report.** When an aggregator, roundup or translated summary cites another outlet or an
  official release, follow the link and open the original too, and list both in `sources`. If the original is
  paywalled, use what is openly readable and say so in the report.
- 產業動態: `evidence_level: "confirmed"` needs a company / government release or at least two independent
  reliable outlets; a single secondary source is `"reported"` at most.
- 軍武動態: prefer official sources (ministries of defense, armed services, DVIDS, NATO, Japan MOD / JSO,
  Korea MND / JCS, Taiwan 國防部, UK MoD, Australian Defence). A media-only item gets
  `quality.verification_status` `single_reliable_source` or `claim_only`, `quality.needs_review: true` and the
  「【未查證】」 prefix on `title_zh` and `summary_zh`. Claims by one side in a war stay `claim_only`.
- When a site refuses automated access (403), try its RSS feed or another official mirror before falling back
  to trade press.

## Steps

1. **Check out the data branch** into `/tmp/nd`:
   ```bash
   git fetch origin news-data 2>/dev/null || true
   if git rev-parse --verify -q origin/news-data >/dev/null; then
     git worktree add -B news-data /tmp/nd origin/news-data
   else
     git worktree add --detach /tmp/nd && cd /tmp/nd && git checkout --orphan news-data && git rm -rfq . && cd -
   fi
   mkdir -p /tmp/nd/news
   python3 tools/news/validate.py /tmp/nd/news --fix   # creates missing files
   ```
2. **Load what already exists** in both files (ids, titles, source URLs) so you do not add duplicates. Treat a
   story already covered in the last 14 days as a duplicate even if the wording differs; a genuinely new
   development of an old story (e.g. an exercise starts, a test result is announced) is a new item. Also skip
   stories already in `news/industry.json` (產業消息) or `news/defense.json` (每日軍武合約).
3. **Research** (WebSearch + WebFetch), news from roughly the last 48 hours (today's date in Asia/Taipei):
   - **產業動態** → `news/industry-dynamics.json`: aim for 4–8 new events with `importance_score` ≥ 65.
     Cover several industries (semiconductors, chip design, data centers, power grid, power generation, nuclear,
     solar/storage, EV batteries, robotics, space, mining, telecom). Look for contract awards, government funding,
     capacity expansions or cuts, commercial deployments, technology milestones, supply agreements, partnerships,
     M&A, regulation, permits, production disruptions and pricing shifts. Search in English, Traditional Chinese,
     Japanese and Korean (Reuters, Bloomberg, Nikkei, DigiTimes, 經濟日報, 工商時報, The Elec, company newsrooms,
     government releases). Prefer events with listed companies (Yahoo tickers; watchlist tickers in
     `tools/news/watchlist.json` are especially relevant). Write 3–6 `content_nodes` per event, always including
     `event_facts`, `investment_impact` and `kpi_watch`; mark inferred content with `"evidence": "inferred"`.
   - **軍武動態** → `news/military.json`: aim for 5–10 new events across several countries and event types
     (exercises, deployments, weapon tests, first flights, sea trials, fielding, program milestones/delays,
     cooperation, incidents). Give every exercise and deployment its dates. Add `locations` only for places the
     source names publicly (base, port, city, sea area) with approximate public coordinates
     (`[lon, lat]`, 1–2 decimals); coarse places get `geocode_confidence: "low"`. Never estimate where units in
     the field are. Use ISO alpha-2 country codes (`US`, `TW`, `CN`, `TR` …), never country names.
4. **Write the new items** into the two files under `/tmp/nd/news/`, following SCHEMA.md exactly (ids, enums,
   Yahoo tickers, `updated_at`). Number 產業動態 ids per event date continuing from the highest existing
   `IN-<date>-NNN`. **Also save a copy of only this run's new items** as `/tmp/new-items/<same file name>`
   (a JSON list per file); step 6 needs it if the push is rejected. Then **proofread** every new zh text once:
   company, place, unit and weapon names, numbers and units against the source, and that each ticker matches the
   company.
5. **Validate** until clean: `python3 tools/news/validate.py /tmp/nd/news --fix` must exit 0.
   Fix every reported error in your new items; do not delete good items to silence errors. If an error is in an
   item from an earlier run, fix only what the validator names and mention it in the report.
6. **Commit and push** (only if something changed):
   ```bash
   cd /tmp/nd
   git add news
   git commit -m "news: <YYYY-MM-DD> world (+<a> industry-dynamics, +<b> military)"
   git push origin news-data
   ```
   **If the push is rejected as non-fast-forward / "fetch first"** (the other news routine pushed, or the branch
   did not exist when you started), re-apply your items on top of the remote branch and push again — at most
   twice:
   ```bash
   cd /tmp/nd
   git fetch origin news-data
   git reset --hard origin/news-data
   python3 <repo>/tools/news/merge.py /tmp/new-items /tmp/nd/news
   python3 <repo>/tools/news/validate.py /tmp/nd/news --fix
   git add news && git commit -m "news: <YYYY-MM-DD> world (...)" && git push origin news-data
   ```
   (`<repo>` is the main checkout this session started in.) For any other rejection (403, permission,
   authentication), do not try other branches — stop and report the exact error.
7. **Report** in Traditional Chinese: how many items you added to each file, their titles, and anything you
   skipped or could not verify.
