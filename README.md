# peter94135.github.io

My personal academic website, hosted on GitHub Pages → **https://peter94135.github.io**

## Structure

```
.
├── index.html      # All page content (About / Research / Publications / Projects / Contact)
├── style.css       # Styling + light/dark theme tokens
├── script.js       # Theme toggle + footer year
├── assets/         # Images (profile.jpg, cv.pdf)
└── .nojekyll        # Tells GitHub Pages to serve files as-is
```

## How to edit

All text lives in `index.html`. Search for the section you want to change
(`<!-- Publications -->`, `<!-- Projects -->`, etc.) and edit the text directly.

- **Profile photo:** put a square image at `assets/profile.jpg`.
- **CV:** put a PDF at `assets/cv.pdf` (or remove the "Download CV" button).
- **Colors:** edit the `--accent` variable near the top of `style.css`.

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
