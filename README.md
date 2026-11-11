# peter94135.github.io

My personal academic website, hosted on GitHub Pages → **https://peter94135.github.io**

## Structure

```
.
├── index.html      # Single-page site: sidebar nav + pages (Home / Experience / Publications / Awards)
├── style.css       # Wood-tone glassmorphism theme (light + dark tokens at the top)
├── script.js       # Hash routing (#home, #experience …), sidebar folders, theme switch
├── assets/         # Images (profile.jpg, cv.pdf)
└── .nojekyll       # Tells GitHub Pages to serve files as-is
```

## Side Projects

- **Stock Dashboard** → https://peter94135.github.io/stock-dashboard/ (repo
  [peter94135/stock-dashboard](https://github.com/peter94135/stock-dashboard)): stock watchlist, theme strength and
  the daily AI news pages. It lived in this repo until 2026-11-11; old links such as `#watchlist` or `#supply&item=…`
  are redirected there by `script.js`. The old `news-data` branch here is no longer updated.

## How to edit

After changing any local `.js` / `.css` file, bump the `?v=` version on its tags in `index.html`
(all local assets share one version), otherwise browsers may combine cached old files with new ones.

All text lives in `index.html`. Each page is a `<section class="page" id="page-…">`;
add a sidebar link with `data-page="…"` and register the id in `PAGES` in `script.js`.

- **Profile photo:** put a square image at `assets/profile.jpg` (falls back to "TH" initials).
- **Colors:** edit the tokens at the top of `style.css` (`:root` = light, `[data-theme="dark"]` = dark).

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
