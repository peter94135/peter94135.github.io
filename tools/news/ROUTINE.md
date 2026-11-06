# Daily news job (run by a Claude cloud routine)

You are updating the news pages of https://peter94135.github.io — 供應鏈瓶頸新聞, 產業消息,
財報電話會議分析, 每日軍武合約 and 年報重點 — for a Taiwan-based investor who follows the companies in `tools/news/watchlist.json`.
The data format and writing rules are in `tools/news/SCHEMA.md`. Read both files first.

## Hard rules

- Only ever commit to and push the **`news-data`** branch. Never commit to, push to, or open a PR
  against `main` or any other branch. Never edit files outside the `news/` folder of `news-data`.
- Never rewrite or remove existing items. Only append. Exceptions: fix a malformed ticker, or an obvious
  typo in a name (e.g. 「虎口」→「湖口」) — mention any such fix in the report.
- Every item must come from real reporting you actually opened (WebFetch) during this run, with its URL in
  `sources`. If you cannot verify something, leave it out. Quality over quantity: zero new items in a
  section is fine on a quiet day.
- Text in Traditional Chinese (zh-TW), factual and neutral. No buy/sell calls.

## Sourcing standard

- **Open the original report.** When an aggregator or roundup (TrendForce news roundups, translated
  summaries, newsletters) cites another outlet, follow the link and open that original article too, and list
  both in `sources`. If the original is paywalled, use what is openly readable and say so in the report.
- A supply-chain or industry item backed only by a single secondary/aggregated source gets
  `credibility: "中"` (supply chain) or `evidence_level: "reported"` (industry) at most, never higher.
- Prefer at least two independent sources for `credibility: "高"` / `evidence_level: "confirmed"`.
- Never present an older story as new: check the article's own date is within the window.

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
2. **Load what already exists** (ids, headlines, source URLs, for earnings the `ticker+year+quarter`
   and for annual reports the `_ticker+_year` combinations; for defense the contract numbers) so you do not add duplicates. Treat a story already covered in the last 14 days as a
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
   - **Defense contracts** → `news/defense.json`: aim for 4–10 new contract events from the last 48 hours.
     Official sources first, trying the next one when a site refuses automated access (defense.gov often
     returns 403):
     1. U.S. DoD daily contracts: https://www.defense.gov/News/Contracts/ , then its RSS feed
        https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=400&Site=945&max=10
     2. U.S. federal award data (official, JSON): `POST https://api.usaspending.gov/api/v2/search/spending_by_award/`
        filtered to awarding agency "Department of Defense", contract award types A–D and the last 3 days
        (use `curl` from Bash; cite the award page `https://www.usaspending.gov/award/<generated_internal_id>`).
     3. DSCA major arms sales (https://www.dsca.mil/press-media/major-arms-sales), 國防部 / 國防採購,
        Japan ATLA, Korea DAPA, UK MoD, NATO NSPA.
     4. Trade press that republishes the official text or reports deals: GovConWire, Defense Daily,
        Breaking Defense, Defense News, Naval News, Janes. When an item rests on these alone, it is media-only. Prefer events whose
     contractor (or parent) is a listed company, especially watchlist tickers in the 軍工 / 太空 sectors.
     Media-only items: prefix `title_zh` and `summary_zh` with 「【未查證】」 and set `quality.needs_review: true`.
     Template: `tools/news/examples/defense.example.json`.
   - **Annual reports** → `news/annual-reports.json`: add **at most one** company per run. Pick a watchlist
     company whose latest annual report (10-K / 20-F / 年報 / 有価証券報告書 / 사업보고서) has been published and is not
     yet in the file (match `_ticker` + `_year`); prefer large companies appearing in several watchlist sectors.
     Open the filing itself (SEC EDGAR, MOPS 公開資訊觀測站, EDINET, DART or the company IR site) and fill the
     schema from it with page references, using `tools/news/examples/annual-report.example.json` as the template.
     If you cannot open the filing, skip this section for today.
4. **Write the new items** into the files under `/tmp/nd/news/`, following SCHEMA.md exactly
   (ids, enums, Yahoo tickers, `updated_at`). **Also save a copy of only this run's new items** as
   `/tmp/new-items/<same file name>` (a JSON list per file) — step 6 needs it if the push is rejected.
   Then **proofread** every new zh text once: company, place and product names (e.g. 湖口 not 虎口,
   台光電 / 台燿 / 聯茂), numbers and units against the source, and that each ticker matches the company
   (check `tools/news/watchlist.json`).
5. **Validate** until clean: `python3 tools/news/validate.py /tmp/nd/news --fix` must exit 0.
   Fix every reported error; do not delete good items to silence errors.
6. **Commit and push** (only if something changed):
   ```bash
   cd /tmp/nd
   git add news
   git commit -m "news: <YYYY-MM-DD> (+<a> supply, +<b> industry, +<c> earnings, +<d> defense, +<e> annual)"
   git push origin news-data
   ```
   **If the push is rejected as non-fast-forward / "fetch first"** (another run pushed, or the branch did
   not exist when you started), re-apply your items on top of the remote branch and push again — at most
   twice:
   ```bash
   cd /tmp/nd
   git fetch origin news-data
   git reset --hard origin/news-data
   python3 <repo>/tools/news/merge.py /tmp/new-items /tmp/nd/news
   python3 <repo>/tools/news/validate.py /tmp/nd/news --fix
   git add news && git commit -m "news: <YYYY-MM-DD> (...)" && git push origin news-data
   ```
   (`<repo>` is the main checkout this session started in.) For any other rejection (403, permission,
   authentication), do not try other branches — stop and report the exact error.
7. **Report** in Traditional Chinese: how many items you added to each file, their headlines, and anything
   you skipped or could not verify.
