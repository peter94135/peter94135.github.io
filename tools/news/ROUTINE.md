# Daily news job (run by a Claude cloud routine)

You are updating the three news pages of https://peter94135.github.io — 供應鏈瓶頸新聞, 產業消息 and
財報電話會議分析 — for a Taiwan-based investor who follows the companies in `tools/news/watchlist.json`.
The data format and writing rules are in `tools/news/SCHEMA.md`. Read both files first.

## Hard rules

- Only ever commit to and push the **`news-data`** branch. Never commit to, push to, or open a PR
  against `main` or any other branch. Never edit files outside the `news/` folder of `news-data`.
- Never rewrite or remove existing items (except fixing a malformed ticker). Only append.
- Every item must come from real reporting you actually opened (WebFetch) during this run, with its URL in
  `sources`. If you cannot verify something, leave it out. Quality over quantity: zero new items in a
  section is fine on a quiet day.
- Text in Traditional Chinese (zh-TW), factual and neutral. No buy/sell calls.

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
2. **Load what already exists** (ids, headlines, source URLs, and for earnings the `ticker+year+quarter`
   combinations) so you do not add duplicates. Treat a story already covered in the last 14 days as a
   duplicate even if the wording differs.
3. **Research** (WebSearch + WebFetch), news from roughly the last 48 hours (today's date in Asia/Taipei):
   - **Supply-chain bottlenecks** → `news/supply-chain.json`: aim for 3–6 new items. Look for shortages,
     export controls, capacity constraints and price spikes in semiconductors, AI servers, memory, advanced
     packaging, PCB/substrate materials, power equipment, rare earths, metals, shipping. Search in English,
     Traditional Chinese, Japanese and Korean (e.g. DigiTimes, 經濟日報, 工商時報, Nikkei, TrendForce,
     The Elec, Reuters, Bloomberg).
   - **Industry events** → `news/industry.json`: aim for 4–8 new events involving watchlist companies
     (supplier changes, supply agreements, capacity expansions, raw-material/BOM changes, disruptions,
     trade policy, strategic investments, permits). Prefer events where a watchlist ticker is directly
     involved; set `importance_tier`/`importance_score` honestly.
   - **Earnings calls** → `news/earnings.json`: find watchlist companies that held an earnings call /
     法說會 in the last 3 days and are not yet in the file. Pick at most 5, preferring larger companies and
     ones that appear in several watchlist sectors. Use the company's IR release / transcript / reliable
     coverage. Write 5–8 highlights with sentiment and 3–6 watch items.
4. **Write the new items** into the files under `/tmp/nd/news/`, following SCHEMA.md exactly
   (ids, enums, Yahoo tickers, `updated_at`).
5. **Validate** until clean: `python3 tools/news/validate.py /tmp/nd/news --fix` must exit 0.
   Fix every reported error; do not delete good items to silence errors.
6. **Commit and push** (only if something changed):
   ```bash
   cd /tmp/nd
   git add news
   git commit -m "news: <YYYY-MM-DD> (+<a> supply, +<b> industry, +<c> earnings)"
   git push origin news-data
   ```
   If the push is rejected, do not try other branches — report the exact error.
7. **Report** in Traditional Chinese: how many items you added to each file, their headlines, and anything
   you skipped or could not verify.
