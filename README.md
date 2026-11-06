# peter94135.github.io

My personal academic website, hosted on GitHub Pages → **https://peter94135.github.io**

## Structure

```
.
├── index.html      # Single-page site: sidebar nav + pages (Home / Experience / Publications / Awards / Stock Watchlist / Theme Strength)
├── style.css       # Wood-tone glassmorphism theme (light + dark tokens at the top)
├── script.js       # Hash routing (#home, #watchlist …), sidebar folders, theme toggle
├── stocks.js       # Stock Watchlist + Theme Strength (themes from Firestore, quotes via Cloudflare Worker → Yahoo Finance)
├── news.js / news.css  # News pages: 供應鏈瓶頸新聞 / 產業消息 / 重點新聞 / 財報電話會議分析
├── annual.js       # 年報重點 (ported from hgvf.github.io annualview.js)
├── defense.js / defense.css  # 每日軍武合約 (ported from hgvf.github.io defenseview.js)
├── dynamics.js     # 產業動態 (ported from hgvf.github.io industrynews.js)
├── military.js     # 軍武動態 with world map (ported from hgvf.github.io militarynews.js)
├── facet.js        # 多維複選搜尋 shared by 產業動態 / 軍武動態 (from hgvf.github.io facetsearch.js)
├── worldnews.css   # Styles for 產業動態 / 軍武動態 (from hgvf.github.io css/news.css)
├── data/world-countries.json  # Simplified Natural Earth country outlines for the 軍武動態 map
├── intel.js / intel.css      # 產業情報站 (ported from hgvf.github.io intel.js + inteldesk.js)
├── strength.js / strength.css  # 題材強弱 (ported from hgvf.github.io strength.js)
├── facts.js        # 事實追蹤 store (★ bookmarks; Firestore dashboards/facts)
├── factsview.js / facts.css  # 事實追蹤 page (ported from hgvf.github.io factsview.js)
├── tools/news/     # Daily news jobs: ROUTINE.md + ROUTINE-WORLD.md (instructions), SCHEMA.md, validate.py, merge.py, watchlist.json
├── assets/         # Images (profile.jpg, cv.pdf)
└── .nojekyll        # Tells GitHub Pages to serve files as-is
```

## How to edit

After changing any local `.js` / `.css` file, bump the `?v=` version on its tags in `index.html`
(all local assets share one version), otherwise browsers may combine cached old files with new ones.

All text lives in `index.html`. Each page is a `<section class="page" id="page-…">`;
add a sidebar link with `data-page="…"` and register the id in `PAGES` in `script.js`.

- **Profile photo:** put a square image at `assets/profile.jpg` (falls back to "TH" initials).
- **Colors:** edit the tokens at the top of `style.css` (`:root` = light, `[data-theme="dark"]` = dark).

## Stock Watchlist

The Watchlist layout and its data (sectors → subsectors → tickers, Markdown notes and research notes)
are copied, with permission, from [hgvf.github.io](https://hgvf.github.io).
The whole tree lives in one Firestore doc, `dashboards/watchlist` (project `stock-dashboard-c595d`):

```
{ sectors: [{ id, name, overview: [symbol…],
              subsectors: [{ id, name, notes, tickers: [{ symbol, name, market }],
                             research: [{ title, content }] }] }] }
```

The page only reads it (no sign-in). Prices come from Yahoo's `v8/finance/spark` (20 symbols / request) and
P/E, market cap and volume from `v7/finance/quote`, both through the Cloudflare Worker `yf-proxy`
(fallback: public CORS proxies). The previous theme list is still in `dashboards/main`, unused.

## Theme Strength (題材強弱)

`strength.js` (ported with permission from hgvf.github.io) ranks the watchlist's **126 subsectors** by the median
day / week / month / quarter / year return of their members, plus a weighted "綜合" (15 / 35 / 35 / 15 % of
day / week / month / year); the quadrant chart uses an outlier-trimmed mean. ↻ Update fetches every watchlist
ticker through the shared quote engine in `stocks.js` (`window.siteQuoteAll`, Yahoo spark, 20 per request).
Themes whose members appear in 供應鏈瓶頸新聞 (last 30 days) or 財報電話會議分析 (last 90 days) get a
⛓ / ▤ badge, red when any of those items is bearish.

## News pages (供應鏈瓶頸新聞 / 產業消息 / 產業動態 / 軍武動態 / 財報電話會議分析 / 年報重點 / 每日軍武合約)

Layout copied with permission from hgvf.github.io. A Claude cloud routine runs every day, follows
`tools/news/ROUTINE.md`, researches the news, appends items to `news/*.json` (supply-chain, industry, earnings,
defense, annual-reports) on the orphan
**`news-data`** branch and pushes it. A second routine (08:00 Taipei) follows `tools/news/ROUTINE-WORLD.md` and fills
`industry-dynamics.json` (產業動態) and `military.json` (軍武動態, shown on a world map; exercises and deployments are
marked 進行中 / 即將開始 / 已結束 against today's date). The site reads those files from
`raw.githubusercontent.com/.../refs/heads/news-data/news/` (no Firestore, no secrets).
Format: `tools/news/SCHEMA.md` (full example records in `tools/news/examples/`); check with `python3 tools/news/validate.py <dir> [--fix]`.
`tools/news/watchlist.json` is a snapshot of the watchlist tickers — regenerate it when the watchlist changes.
**產業情報站 (`#intel`)**: hand-written intel notes stored in Firestore `dashboards/intel` (public read; only the
owner's saved Google session can add/edit — the 「＋ 新增情報」 button appears only then). Each ticker in a note adds to
the 訊<n> badge on Watchlist cards; its ★ bookmarks go to 事實追蹤.

**事實追蹤 (`#facts`)**: ★ on 財報電話會議分析 highlights / watch points and on 產業情報站 bullets saves a tracked
fact to Firestore `dashboards/facts` (public read, owner-only writes, localStorage mirror). The page tracks each
fact's state, progress updates, a verification checklist and the price since tracking began.

**重點新聞 (`#highlights`)**: the 🔖 button on 供應鏈瓶頸新聞 / 產業消息 rows collects an item. The list lives in
Firestore `dashboards/highlights` (public read), mirrored in localStorage; it is written to Firestore only when the
owner's saved Google session is present in the browser (the auth SDK is loaded without any sign-in UI).

Local preview with other data: `http://localhost:8000/?newsdata=/some-folder/#supply`.

## Deploy

This repo is a GitHub Pages *user site*. After pushing to the `main` branch,
the site is published automatically at `https://peter94135.github.io`
(enable Pages under Settings → Pages → Branch: `main` if it isn't already).

## Local preview

Open `index.html` directly in a browser, or run a local server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```
