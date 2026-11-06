# peter94135.github.io

My personal academic website, hosted on GitHub Pages → **https://peter94135.github.io**

## Structure

```
.
├── index.html      # Single-page site: sidebar nav + pages (Home / Experience / Publications / Awards / Stock Watchlist / Theme Strength)
├── style.css       # Wood-tone glassmorphism theme (light + dark tokens at the top)
├── script.js       # Hash routing (#home, #watchlist …), sidebar folders, theme toggle
├── stocks.js       # Stock Watchlist + Theme Strength (themes from Firestore, quotes via Cloudflare Worker → Yahoo Finance)
├── assets/         # Images (profile.jpg, cv.pdf)
└── .nojekyll        # Tells GitHub Pages to serve files as-is
```

## How to edit

All text lives in `index.html`. Each page is a `<section class="page" id="page-…">`;
add a sidebar link with `data-page="…"` and register the id in `PAGES` in `script.js`.

- **Profile photo:** put a square image at `assets/profile.jpg` (falls back to "TH" initials).
- **Colors:** edit the tokens at the top of `style.css` (`:root` = light, `[data-theme="dark"]` = dark).

## Stock Watchlist

`stocks.js` keeps the themes and tickers in Firestore (`dashboards/main`, project `stock-dashboard-c595d`).
The former stand-alone stock dashboard is merged into this page (auto-refresh, card / table views, theme editing).
Signing in with a Google account listed in `OWNER_UIDS` unlocks add/remove ticker and theme editing.
Quotes go through the Cloudflare Worker `yf-proxy` (fallback: public CORS proxies); only the selected theme is fetched.

## Theme Strength (題材強弱)

`#strength` ranks every watchlist theme by momentum. All tickers are fetched in batches of 20 with
Yahoo's `v8/finance/spark` endpoint (≈30 requests for ~600 tickers) and cached in `localStorage` for 15 minutes.
A theme's return per window (day / week / month / quarter / year) is the **median** of its members;
"綜合" is a weighted percentile rank across windows (10 / 30 / 30 / 20 / 10 %).
The quadrant chart plots month return (x) vs week return (y): Leading / Improving / Weakening / Lagging.

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
