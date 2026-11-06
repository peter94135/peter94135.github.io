/* =====================================================================
 * Stock Watchlist — sector → subsector → ticker layout, ported from
 * hgvf.github.io (with the owner's permission), including its sectors,
 * subsectors, tickers and notes.
 *   - the whole tree lives in ONE Firestore doc: dashboards/watchlist
 *       { sectors: [{ id, name, overview: [sym…],
 *                     subsectors: [{ id, name, notes(md),
 *                                    tickers: [{ symbol, name, market }],
 *                                    research: [{ title, content(md) }] }] }] }
 *   - prices: Yahoo "spark" batch endpoint (20 symbols / request) through the
 *     Cloudflare Worker; P/E, market cap and volume from the v7 quote endpoint
 *   - nothing is fetched until the Watchlist or Theme Strength page is opened
 * ===================================================================== */
(function () {
  "use strict";

  /* ---------- config ---------- */
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCwf3ys8CFegSKqoElMPNi0ZJ51KANZYAE",
    authDomain: "stock-dashboard-c595d.firebaseapp.com",
    projectId: "stock-dashboard-c595d",
    storageBucket: "stock-dashboard-c595d.firebasestorage.app",
    messagingSenderId: "759320799290",
    appId: "1:759320799290:web:e15000031890438f3aad03",
  };
  const TREE_DOC = "dashboards/watchlist";
  const WORKER_URL = "https://yf-proxy.peter94135.workers.dev";
  const PROXIES = [
    u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  ];
  const LS = { tree: "wl_tree_v1", fund: "wl_fund_v1", pref: "wl_pref_v2" };
  const QUOTE_FRESH = 2 * 60 * 1000;      // re-fetch prices older than this when a tab is opened
  const FUND_FRESH = 6 * 60 * 60 * 1000;  // P/E / market cap change slowly

  /* ---------- state ---------- */
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let tree = load(LS.tree);                 // cached copy of the Firestore doc
  let fund = load(LS.fund) || {};           // sym → { pe, cap, cur, vol, name, t }
  let pref = Object.assign({ active: null, view: "change", collapsed: [] }, load(LS.pref) || {});
  let tickerNames = {};                     // sym → name from the tree
  let newsIdx = {};                         // sym → { supply, industry, earnings } latest news item (news.js)

  let db = null, cloudReady = false, cloudLoaded = false;
  let started = false, refreshSeq = 0;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const savePref = () => store(LS.pref, pref);

  const sectors = () => (tree && Array.isArray(tree.sectors) ? tree.sectors : []);
  const sectorSymbols = s => [...new Set([
    ...(s.overview || []),
    ...(s.subsectors || []).flatMap(sub => (sub.tickers || []).map(t => t.symbol)),
  ])];
  const nameOf = sym => tickerNames[sym] || (fund[sym] && fund[sym].name) || "";
  const quoteOf = sym => (stData.q[sym] || {});

  function indexNames() {
    tickerNames = {};
    for (const s of sectors()) for (const sub of s.subsectors || []) for (const t of sub.tickers || []) {
      if (t.name && !tickerNames[t.symbol]) tickerNames[t.symbol] = t.name;
    }
  }
  indexNames();

  function activeSector() {
    const list = sectors();
    if (!list.length) return null;
    let s = list.find(x => x.id === pref.active);
    if (!s) { s = list[0]; pref.active = s.id; savePref(); }
    return s;
  }

  // Shared with news.js (重點新聞 collection + names on trend cards).
  window.siteFirestore = () => {
    if (typeof firebase === "undefined") return null;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return firebase.firestore();
  };
  window.siteTickerName = sym => nameOf(sym);

  /* ---------- Firebase (read-only) ---------- */
  let fbInit = false;
  function initFirebase() {
    if (fbInit || typeof firebase === "undefined") return;
    fbInit = true;
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      cloudReady = true;
      db.doc(TREE_DOC).onSnapshot(snap => {
        cloudLoaded = true;
        const d = snap.exists ? snap.data() : null;
        if (d && Array.isArray(d.sectors)) {
          tree = { sectors: d.sectors };
          store(LS.tree, tree);
          indexNames();
        }
        if (started) { renderAll(); refresh(); }
        if (stStarted) stOnThemes();
      }, err => {
        console.warn("Firestore listen failed:", err.message);
        cloudLoaded = true;
        if (started) renderAll();
        if (stStarted) stOnThemes();
      });
    } catch (e) { console.warn("Firebase init failed:", e.message); }
  }

  /* ---------- fetching ---------- */
  async function fetchJSON(url) {
    const attempts = [WORKER_URL + "/?url=" + encodeURIComponent(url), ...PROXIES.map(p => p(url))];
    for (const a of attempts) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 9000);
        const r = await fetch(a, { cache: "no-store", signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) continue;
        return JSON.parse(await r.text());
      } catch (e) { /* try next */ }
    }
    throw new Error("fetch failed");
  }

  async function fetchFundamentals(symbols) {
    const res = {};
    try {
      const j = await fetchJSON(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`);
      for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
        res[q.symbol] = {
          pe: q.trailingPE ?? null, cap: q.marketCap ?? null, cur: q.currency || "",
          vol: q.regularMarketVolume ?? null, name: q.shortName || q.longName || "", t: Date.now(),
        };
      }
    } catch (e) { /* leave blank */ }
    return res;
  }

  // Run `fn` over `items` in chunks of `size`, `workers` at a time.
  async function inChunks(items, size, workers, fn) {
    const queue = [];
    for (let i = 0; i < items.length; i += size) queue.push(items.slice(i, i + size));
    await Promise.all(Array.from({ length: workers }, async () => {
      while (queue.length) await fn(queue.shift());
    }));
  }

  async function refresh() {
    const sec = activeSector();
    if (!sec) return;
    const myId = ++refreshSeq;
    const syms = sectorSymbols(sec);
    const now = Date.now();
    const stale = syms.filter(s => !stData.q[s] || !stData.q[s].t || now - stData.q[s].t > QUOTE_FRESH);
    const noFund = syms.filter(s => !fund[s] || now - fund[s].t > FUND_FRESH);
    const fundP = inChunks(noFund, 40, 2, async c => { Object.assign(fund, await fetchFundamentals(c)); });
    await inChunks(stale, 20, 4, async c => {
      let res = null;
      for (let a = 0; a < 2 && !res; a++) { try { res = await fetchSpark(c); } catch (e) { /* retry */ } }
      if (!res) return;
      const t = Date.now();
      for (const [s, v] of Object.entries(res)) stData.q[s] = Object.assign(v, { t });
      if (myId === refreshSeq) paintPrices();
    });
    store(ST_LS.data, stData);
    await fundP;
    store(LS.fund, fund);
    if (myId === refreshSeq) paintPrices();
  }

  /* ---------- formatting (as on hgvf.github.io) ---------- */
  function tradingViewUrl(symbol) {
    const tv = s => "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(s);
    const m = symbol.match(/^(.+)\.([A-Z]+)$/);
    if (!m) return tv(symbol);
    const ex = { TWO: "TPEX", TW: "TWSE", KQ: "KRX", KS: "KRX", T: "TSE", SS: "SSE", SZ: "SZSE", HK: "HKEX",
      AS: "EURONEXT", PA: "EURONEXT", BR: "EURONEXT", LS: "EURONEXT", IR: "EURONEXT", DE: "XETR", MI: "MIL",
      MC: "BME", L: "LSE", ST: "OMX", CO: "OMX", HE: "OMX", OL: "OSL", VX: "SIX", SW: "SIX" }[m[2]];
    return tv(ex ? `${ex}:${m[1]}` : symbol);
  }
  const changeClass = v => (v == null || isNaN(v) ? "neutral" : v > 0 ? "positive" : v < 0 ? "negative" : "neutral");
  const fmtChg = v => (v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%");
  function formatPrice(price, symbol) {
    if (price == null || isNaN(price)) return "—";
    // Whole-unit markets: TW, JP, KR, CN A-shares, HK
    if (/\.(TW|TWO|T|KS|KQ|SS|SZ|HK)$/.test(symbol)) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCap(v, cur) {
    if (v == null || isNaN(v)) return "—";
    const s = v >= 1e12 ? (v / 1e12).toFixed(2) + "T" : v >= 1e9 ? (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v).toLocaleString("en-US");
    return s + (cur ? " " + cur : "");
  }
  const fmtVolume = v => (!v ? "—" : v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(v));
  const INDICATOR = { positive: "var(--positive)", negative: "var(--negative)", neutral: "var(--neutral)" };
  const dir = v => (v > 0 ? "up" : v < 0 ? "down" : "flat");   // Theme Strength colours

  let mdReady = false;
  function md(text) {
    if (!text) return "";
    if (window.marked) {
      if (!mdReady) { window.marked.use({ breaks: true }); mdReady = true; }
      return window.marked.parse(text).replace(/<img /g, '<img loading="lazy" ');
    }
    return esc(text).replace(/\n/g, "<br>");
  }

  /* ---------- rendering ---------- */
  function renderAll() {
    renderTabs();
    renderBar();
    renderContent();
  }

  function renderTabs() {
    const cur = activeSector();
    $("wlTabs").innerHTML = sectors().map(s =>
      `<button class="sector-tab${cur && s.id === cur.id ? " active" : ""}" data-sector="${esc(s.id)}" type="button" role="tab">${esc(s.name)}</button>`
    ).join("");
  }

  // 供 / 產 / 法 tags → the latest related item on each news page (as on hgvf.github.io).
  const NEWS_TAGS = [
    ["supply", "供", "tg-supply", "相關供應鏈瓶頸新聞，前往最新一篇"],
    ["industry", "產", "tg-industry", "相關產業消息，前往最新一則"],
    ["earnings", "法", "tg-earnings", "法說會（財報電話會議）紀錄，前往最新一季"],
  ];
  function tickerCardHTML(sym) {
    const q = quoteOf(sym);
    const cls = changeClass(q.d);
    const ev = newsIdx[sym] || {};
    const tags = NEWS_TAGS.filter(([k]) => ev[k]).map(([k, label, tcls, tip]) =>
      `<a class="tc-tag ${tcls}" href="#${k}&item=${encodeURIComponent(ev[k].id)}" title="${tip}${ev[k].date ? `（最新：${esc(ev[k].date)}）` : ""}">${label}</a>`).join("");
    return `<div class="ticker-card" style="--indicator-color:${INDICATOR[cls]}">
      <a class="tc-main" href="${tradingViewUrl(sym)}" target="_blank" rel="noopener" title="Open in TradingView">
        <span class="tc-symbol">${esc(sym)}</span><span class="tc-name">${esc(nameOf(sym))}&nbsp;</span>
        <span class="tc-price">${formatPrice(q.last, sym)}</span><span class="tc-change ${cls}">${fmtChg(q.d)}</span></a>
      ${tags ? `<div class="tc-tags">${tags}</div>` : ""}</div>`;
  }

  function renderBar() {
    const bar = $("wlBar");
    const sec = activeSector();
    if (!sec) {
      bar.innerHTML = `<div class="wl-empty">${cloudLoaded || !cloudReady ? "No watchlist data." : "Loading…"}</div>`;
      return;
    }
    const unique = sectorSymbols(sec);
    let up = 0, down = 0, flat = 0;
    unique.forEach(s => { const d = quoteOf(s).d; if (d > 0) up++; else if (d < 0) down++; else flat++; });
    const view = pref.view === "subsector" ? "subsector" : "change";
    let html = `<div class="ticker-summary">
      <span class="ts-label">總覽</span>
      <span class="ts-stat ts-up">上漲 <strong>${up}</strong></span>
      <span class="ts-stat ts-down">下跌 <strong>${down}</strong></span>
      ${flat ? `<span class="ts-stat ts-flat">平盤 <strong>${flat}</strong></span>` : ""}
      ${unique.length ? `<div class="ticker-legend">
        <button class="tl-btn" data-action="toggle-legend" type="button" aria-label="標籤說明" title="標籤說明">ⓘ 標籤</button>
        <div class="tl-pop">
          <span class="tl-row"><span class="tc-tag tg-supply">供</span> 相關供應鏈瓶頸新聞 · 點擊前往最新一篇</span>
          <span class="tl-row"><span class="tc-tag tg-industry">產</span> 相關產業消息 · 點擊前往最新一則</span>
          <span class="tl-row"><span class="tc-tag tg-earnings">法</span> 法說會紀錄 · 點擊前往最新一季</span>
        </div></div>` : ""}
      ${unique.length ? `<div class="ticker-viewtoggle" role="tablist">
        <button class="tvt-btn${view === "change" ? " active" : ""}" data-view="change" type="button">依漲跌</button>
        <button class="tvt-btn${view === "subsector" ? " active" : ""}" data-view="subsector" type="button">依題材</button></div>` : ""}
    </div>`;
    if (unique.length) {
      const zone = (title, syms, kind, extra = "") => {
        if (!syms.length) return "";
        const key = `${view}::${title}`;
        const collapsed = pref.collapsed.includes(key) ? " collapsed" : "";
        return `<div class="ticker-zone tz-${kind}${extra}${collapsed}" data-key="${esc(key)}">
          <div class="tz-head" role="button" tabindex="0" title="點擊收合 / 展開"><span class="tz-caret" aria-hidden="true">▾</span><span class="tz-title">${esc(title)}</span><span class="tz-count">${syms.length}</span></div>
          <div class="tz-grid">${syms.map(tickerCardHTML).join("")}</div></div>`;
      };
      const chg = s => quoteOf(s).d;
      let zones = "";
      if (view === "subsector") {
        const seen = new Set();
        const byChg = (a, b) => (chg(b) ?? -Infinity) - (chg(a) ?? -Infinity);
        for (const sub of sec.subsectors || []) {
          const syms = [...new Set((sub.tickers || []).map(t => t.symbol))].filter(s => !seen.has(s));
          syms.forEach(s => seen.add(s));
          zones += zone(sub.name, syms.sort(byChg), "theme");
        }
        zones += zone("精選 / 其他", unique.filter(s => !seen.has(s)).sort(byChg), "theme", " tz-other");
      } else {
        const gainers = unique.filter(s => chg(s) > 0).sort((a, b) => chg(b) - chg(a));
        const losers = unique.filter(s => chg(s) < 0).sort((a, b) => chg(a) - chg(b));
        const neutrals = unique.filter(s => !chg(s));
        zones = zone("上漲", gainers, "up") + zone("下跌", losers, "down") + zone("平盤 / 無資料", neutrals, "flat");
      }
      html += `<div class="ticker-zones">${zones}</div>`;
    }
    bar.innerHTML = html;
  }

  function watchlistTableHTML(tickers) {
    const cols = ["Name", "Last", "Day%", "Wk%", "Mo%", "Yr%", "P/E", "Mkt Cap", "Volume"];
    const rows = tickers.map(t => {
      const q = quoteOf(t.symbol), f = fund[t.symbol] || {};
      return `<tr>
        <td><div class="wl-name-cell"><a class="wl-symbol" href="${tradingViewUrl(t.symbol)}" target="_blank" rel="noopener">${esc(t.symbol)}</a><span class="wl-fullname">${esc(t.name || nameOf(t.symbol))}</span></div></td>
        <td>${formatPrice(q.last, t.symbol)}</td>
        <td class="chg-${changeClass(q.d)}">${fmtChg(q.d)}</td>
        <td class="chg-${changeClass(q.w)}">${fmtChg(q.w)}</td>
        <td class="chg-${changeClass(q.m)}">${fmtChg(q.m)}</td>
        <td class="chg-${changeClass(q.y)}">${fmtChg(q.y)}</td>
        <td>${f.pe ? f.pe.toFixed(2) : "—"}</td>
        <td>${fmtCap(f.cap, f.cur)}</td>
        <td>${fmtVolume(f.vol)}</td></tr>`;
    }).join("");
    return `<table class="wl-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderContent() {
    const box = $("wlContent");
    const sec = activeSector();
    if (!sec) { box.innerHTML = ""; return; }
    box.innerHTML = (sec.subsectors || []).map((sub, i) => {
      const tickers = sub.tickers || [];
      const research = (sub.research || []).map(n => `<div class="research-card glass-card">
          <div class="research-header" role="button" tabindex="0"><span class="research-title">${esc(n.title || "Note")}</span><span class="research-toggle" aria-hidden="true">▼</span></div>
          <div class="research-body">${md(n.content)}</div></div>`).join("");
      return `<div class="subsector-block">
        <h3 class="subsector-title">${esc(sub.name)}</h3>
        <div class="subsector-grid">
          <div class="glass-card notes-card"><p class="card-title">Notes</p><div class="notes-body">${md(sub.notes)}</div></div>
          ${tickers.length ? `<div class="glass-card wl-card"><p class="card-title">Watchlist</p><div class="wl-table-wrapper" data-sub="${i}">${watchlistTableHTML(tickers)}</div></div>` : ""}
        </div>
        ${research ? `<div class="research-section">${research}</div>` : ""}
      </div>`;
    }).join("");
  }

  // Price update: repaint the ticker bar and the tables only (keeps open research notes open).
  function paintPrices() {
    renderBar();
    const sec = activeSector();
    if (!sec) return;
    document.querySelectorAll("#wlContent .wl-table-wrapper[data-sub]").forEach(w => {
      const sub = (sec.subsectors || [])[+w.dataset.sub];
      if (sub) w.innerHTML = watchlistTableHTML(sub.tickers || []);
    });
  }

  /* ---------- actions ---------- */
  function selectSector(id) {
    if (pref.active === id) return;
    pref.active = id; savePref();
    renderAll();
    window.scrollTo(0, 0);
    refresh();
  }

  function wire() {
    $("wlTabs").addEventListener("click", e => {
      const b = e.target.closest("[data-sector]");
      if (b) selectSector(b.dataset.sector);
    });
    $("wlBar").addEventListener("click", e => {
      const lg = e.target.closest('[data-action="toggle-legend"]');
      if (lg) { lg.parentElement.classList.toggle("open"); return; }
      const v = e.target.closest("[data-view]");
      if (v) { pref.view = v.dataset.view; savePref(); renderBar(); return; }
      const head = e.target.closest(".tz-head");
      if (head) {
        const zone = head.parentElement, key = zone.dataset.key;
        const collapsed = zone.classList.toggle("collapsed");
        pref.collapsed = pref.collapsed.filter(k => k !== key);
        if (collapsed) pref.collapsed.push(key);
        savePref();
      }
    });
    const toggleResearch = e => {
      const h = e.target.closest(".research-header");
      if (h) h.closest(".research-card").classList.toggle("open");
    };
    $("wlContent").addEventListener("click", toggleResearch);
    document.addEventListener("click", e => {
      if (!e.target.closest(".ticker-legend")) document.querySelectorAll(".ticker-legend.open").forEach(x => x.classList.remove("open"));
    });
    $("wlContent").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleResearch(e); } });
  }

  function start() {
    if (started) return;
    started = true;
    wire();
    renderAll();
    initFirebase();
    refresh();
    // news.js loads after this file, so wait for the DOM before asking it for the tag index.
    const loadNewsIdx = () => {
      if (window.newsTickerIndex) window.newsTickerIndex().then(m => { newsIdx = m; renderBar(); }).catch(() => {});
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadNewsIdx);
    else loadNewsIdx();
  }

  /* =====================================================================
   * Theme Strength (題材強弱)
   *   Ranks every Watchlist sector (大類, all of its tickers) by price momentum. Each theme's return over
   *   a window is the MEDIAN of its members (robust to a single +300% name).
   *   "綜合" = weighted percentile rank across windows; mid-term (week/month)
   *   is weighted highest so rotation shows up, the 1-year window lowest.
   *   Prices come from Yahoo's batch "spark" endpoint (20 symbols / request),
   *   so all ~600 tickers update in a few seconds.
   * ===================================================================== */
  const ST_LS = { data: "st_data_v1", pref: "st_pref_v1" };
  const DIMS = [
    { key: "score", label: "綜合" },
    { key: "d", label: "日" },
    { key: "w", label: "週" },
    { key: "m", label: "月" },
    { key: "q", label: "季" },
    { key: "y", label: "年" },
  ];
  const WINDOWS = ["d", "w", "m", "q", "y"];
  const WEIGHTS = { d: 0.1, w: 0.3, m: 0.3, q: 0.2, y: 0.1 };
  const ST_STALE = 15 * 60 * 1000;   // auto-update when cached prices are older than this
  const QUADS = {
    lead: { label: "強勢", en: "Leading", color: "var(--up)" },
    improve: { label: "轉強", en: "Improving", color: "var(--accent-2)" },
    weaken: { label: "轉弱", en: "Weakening", color: "var(--accent)" },
    lag: { label: "弱勢", en: "Lagging", color: "var(--down)" },
  };

  let stData = load(ST_LS.data) || { t: 0, q: {} };
  let stPref = Object.assign({ dim: "score", open: null }, load(ST_LS.pref) || {});
  let stStarted = false, stBusy = false, stAutoDone = false, stRows = [];
  const stSavePref = () => store(ST_LS.pref, stPref);

  const median = a => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y), h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const allSymbols = () => [...new Set(sectors().flatMap(sectorSymbols))];
  const quadOf = r => (r.m >= 0 ? (r.w >= 0 ? "lead" : "weaken") : (r.w >= 0 ? "improve" : "lag"));

  // Returns over each window from a daily close series (last bar = latest price).
  function returnsFromSeries(ts, closes) {
    const pts = [];
    for (let i = 0; i < ts.length; i++) if (closes[i] != null && isFinite(closes[i])) pts.push([ts[i], closes[i]]);
    if (pts.length < 2) return null;
    const [tLast, last] = pts[pts.length - 1];
    const ref = days => {
      const target = tLast - days * 86400;
      let best = pts[0][1];
      for (const [t, c] of pts) { if (t <= target) best = c; else break; }
      return best;
    };
    const r = base => (base ? last / base - 1 : null);
    return { last, d: r(pts[pts.length - 2][1]), w: r(ref(7)), m: r(ref(30)), q: r(ref(91)), y: r(pts[0][1]) };
  }

  async function fetchSpark(syms) {
    const j = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms.join(","))}&range=1y&interval=1d`);
    if (j && j.spark && j.spark.error) throw new Error(j.spark.error.description || "spark error");
    const out = {};
    for (const s of syms) {
      const e = j && j[s];
      if (!e || !e.timestamp || !e.close) continue;
      const r = returnsFromSeries(e.timestamp, e.close);
      if (r) { r.t = Date.now(); out[s] = r; }
    }
    return out;
  }

  async function stRefresh() {
    if (stBusy) return;
    const syms = allSymbols();
    if (!syms.length) { $("stStatus").textContent = "No themes"; stRender(); return; }
    stBusy = true;
    $("stRefresh").disabled = true;
    const chunks = [];
    for (let i = 0; i < syms.length; i += 20) chunks.push(syms.slice(i, i + 20));
    const q = {};
    let done = 0, failed = 0;
    const status = () => { $("stStatus").innerHTML = `<span class="loading">Updating … ${Math.min(done * 20, syms.length)}/${syms.length}</span>`; };
    status();
    const queue = [...chunks];
    async function worker() {
      while (queue.length) {
        const c = queue.shift();
        let res = null;
        for (let attempt = 0; attempt < 2 && !res; attempt++) {
          try { res = await fetchSpark(c); } catch (e) { /* retry once */ }
        }
        if (res) Object.assign(q, res); else failed++;
        done++; status();
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    // Keep older quotes for anything that failed this round.
    stData = { t: Date.now(), q: Object.assign({}, stData.q, q) };
    store(ST_LS.data, stData);
    stBusy = false;
    $("stRefresh").disabled = false;
    stRender();
    const got = syms.filter(s => q[s]).length;
    $("stStatus").textContent = `Updated ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} · ${got}/${syms.length} tickers` + (failed ? ` · ${failed} batch(es) failed` : "");
  }

  function themeStats() {
    const rows = sectors().map(sec => {
      const name = sec.name, syms = sectorSymbols(sec);
      const vals = syms.map(s => stData.q[s]).filter(Boolean);
      const r = { name, n: syms.length, got: vals.length };
      for (const k of WINDOWS) {
        const arr = vals.map(v => v[k]).filter(v => v != null && isFinite(v));
        r[k] = median(arr);
        r[k + "Up"] = arr.filter(v => v > 0).length;
        r[k + "N"] = arr.length;
      }
      return r;
    }).filter(r => r.got);
    // 綜合: percentile rank of each window across themes, weighted.
    const pct = {};
    for (const k of WINDOWS) {
      const list = rows.filter(r => r[k] != null).sort((a, b) => a[k] - b[k]);
      list.forEach((r, i) => { (pct[r.name] || (pct[r.name] = {}))[k] = list.length > 1 ? i / (list.length - 1) : 0.5; });
    }
    for (const r of rows) {
      let sum = 0, wsum = 0;
      for (const k of WINDOWS) if (pct[r.name] && pct[r.name][k] != null) { sum += WEIGHTS[k] * pct[r.name][k]; wsum += WEIGHTS[k]; }
      r.score = wsum ? (sum / wsum) * 100 : null;
    }
    return rows;
  }

  /* ---------- rendering ---------- */
  const fmtPct1 = v => (v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%");

  function stRender() {
    if (!stStarted) return;
    stRows = themeStats();
    $("stDims").innerHTML = DIMS.map(d => `<button class="seg__btn${d.key === stPref.dim ? " active" : ""}" data-dim="${d.key}" type="button">${d.label}</button>`).join("");
    const meta = $("stMeta");
    const nSym = allSymbols().length;
    meta.textContent = stRows.length
      ? `${stRows.length} 個題材 · ${nSym} 檔個股` + (stData.t ? ` · 價格時間 ${new Date(stData.t).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}` : "")
      : "";
    stRenderQuad();
    stRenderList();
  }

  function stRenderQuad() {
    const box = $("stQuad");
    const rows = stRows.filter(r => r.m != null && r.w != null);
    if (!rows.length) { box.innerHTML = `<div class="wl-empty">${stBusy ? "Loading prices…" : "No price data yet — press Update."}</div>`; return; }
    const W = Math.max(300, Math.round(box.clientWidth || 640));
    const H = Math.round(Math.min(460, Math.max(300, W * 0.62)));
    const pad = { l: 46, r: 16, t: 18, b: 34 };
    // Fit the data (always keeping the 0 axes in view) instead of a symmetric range,
    // so a market-wide move doesn't squash every theme into one corner.
    const range = (vals, minSpan) => {
      let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
      const span = Math.max(minSpan, hi - lo), padv = span * 0.12;
      if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
      return [Math.min(lo - padv, -padv * 0.6), Math.max(hi + padv, padv * 0.6)];
    };
    const [xLo, xHi] = range(rows.map(r => r.m), 0.04);
    const [yLo, yHi] = range(rows.map(r => r.w), 0.02);
    const X = v => pad.l + ((v - xLo) / (xHi - xLo)) * (W - pad.l - pad.r);
    const Y = v => pad.t + ((yHi - v) / (yHi - yLo)) * (H - pad.t - pad.b);
    const cx = X(0), cy = Y(0);
    const fs = W < 480 ? 10 : 11.5;
    const nMax = Math.max(...rows.map(r => r.n));
    const rad = r => (W < 480 ? 3.5 : 4.5) + 4 * Math.sqrt(r.n / nMax);

    let s = `<svg class="st-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Theme momentum quadrant: month return vs week return">`;
    // quadrant tints + corner labels
    const qx0 = pad.l, qx1 = W - pad.r, qy0 = pad.t, qy1 = H - pad.b;
    s += `<rect x="${cx}" y="${qy0}" width="${qx1 - cx}" height="${cy - qy0}" class="st-q st-q--lead"/>`;
    s += `<rect x="${qx0}" y="${cy}" width="${cx - qx0}" height="${qy1 - cy}" class="st-q st-q--lag"/>`;
    const corner = (x, y, anchor, q) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="st-corner" fill="${QUADS[q].color}">${QUADS[q].label} ${QUADS[q].en}</text>`;
    s += corner(qx1 - 6, qy0 + 14, "end", "lead") + corner(qx0 + 6, qy0 + 14, "start", "improve");
    s += corner(qx1 - 6, qy1 - 7, "end", "weaken") + corner(qx0 + 6, qy1 - 7, "start", "lag");
    // axes
    s += `<line x1="${qx0}" x2="${qx1}" y1="${cy}" y2="${cy}" class="st-axis"/><line x1="${cx}" x2="${cx}" y1="${qy0}" y2="${qy1}" class="st-axis"/>`;
    s += `<text x="${qx0}" y="${H - 10}" class="st-tick">${fmtPct1(xLo)}</text><text x="${qx1}" y="${H - 10}" text-anchor="end" class="st-tick">${fmtPct1(xHi)}</text>`;
    s += `<text x="${(qx0 + qx1) / 2}" y="${H - 10}" text-anchor="middle" class="st-axis-label">月漲跌（中期） →</text>`;
    s += `<text x="${pad.l - 6}" y="${qy0 + 4}" text-anchor="end" class="st-tick">${fmtPct1(yHi)}</text><text x="${pad.l - 6}" y="${qy1}" text-anchor="end" class="st-tick">${fmtPct1(yLo)}</text>`;
    s += `<text transform="translate(13 ${(qy0 + qy1) / 2}) rotate(-90)" text-anchor="middle" class="st-axis-label">週漲跌（短期） →</text>`;

    // points, then labels with simple collision avoidance
    const placed = [];
    const textW = t => [...t].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? fs : fs * 0.58), 0);
    const hit = b => placed.some(p => b.x < p.x + p.w && b.x + b.w > p.x && b.y < p.y + p.h && b.y + b.h > p.y);
    const sorted = rows.slice().sort((a, b) => b.n - a.n);
    let dots = "", labels = "";
    for (const r of sorted) {
      const x = X(r.m), y = Y(r.w), q = quadOf(r), rr = rad(r);
      const open = stPref.open === r.name ? " st-dot--open" : "";
      dots += `<g class="st-dot${open}" data-theme="${esc(r.name)}"><title>${esc(r.name)}\n週 ${fmtPct1(r.w)} · 月 ${fmtPct1(r.m)} · ${r.n} 檔</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr.toFixed(1)}" fill="${QUADS[q].color}"/></g>`;
      placed.push({ x: x - rr, y: y - rr, w: rr * 2, h: rr * 2 });
    }
    for (const r of sorted) {
      const x = X(r.m), y = Y(r.w), rr = rad(r), w = textW(r.name), h = fs + 2;
      const cands = [
        { x: x + rr + 3, y: y - h / 2, a: "start" },
        { x: x - rr - 3 - w, y: y - h / 2, a: "end" },
        { x: x - w / 2, y: y - rr - 2 - h, a: "middle" },
        { x: x - w / 2, y: y + rr + 2, a: "middle" },
      ];
      let c = cands.find(b => !hit({ x: b.x, y: b.y, w, h }) && b.x >= 2 && b.x + w <= W - 2 && b.y >= 2 && b.y + h <= H - 2);
      if (!c) continue;   // too crowded: name still shown on hover / in the ranking
      placed.push({ x: c.x, y: c.y, w, h });
      const tx = c.a === "start" ? c.x : c.a === "end" ? c.x + w : c.x + w / 2;
      labels += `<text x="${tx.toFixed(1)}" y="${(c.y + h - 3).toFixed(1)}" text-anchor="${c.a}" class="st-label" data-theme="${esc(r.name)}" style="font-size:${fs}px">${esc(r.name)}</text>`;
    }
    s += dots + labels + `</svg>`;
    box.innerHTML = s;
  }

  function barHTML(r, dim, maxAbs) {
    const v = r[dim];
    if (v == null) return `<div class="st-bar"></div>`;
    if (dim === "score") {
      return `<div class="st-bar st-bar--score"><span style="width:${v.toFixed(1)}%"></span></div>`;
    }
    const w = Math.min(50, (Math.abs(v) / maxAbs) * 50);
    const side = v >= 0 ? `left:50%` : `right:50%`;
    return `<div class="st-bar st-bar--div"><i></i><span class="${v >= 0 ? "up" : "down"}" style="${side};width:${w.toFixed(1)}%"></span></div>`;
  }

  function stRenderList() {
    const box = $("stList");
    if (!stRows.length) { box.innerHTML = ""; return; }
    const dim = stPref.dim;
    const rows = stRows.slice().sort((a, b) => (b[dim] ?? -Infinity) - (a[dim] ?? -Infinity));
    const maxAbs = dim === "score" ? 100 : Math.max(1e-6, ...rows.map(r => Math.abs(r[dim] ?? 0)));
    const bk = dim === "score" ? "w" : dim;   // breadth window
    const dimLabel = DIMS.find(d => d.key === dim).label;
    const head = `<div class="st-row st-row--head">
      <span>#</span><span>題材</span><span>${dimLabel}${dim === "score" ? "分數" : "漲跌（中位數）"}</span>
      <span class="st-num">上漲比例</span>
      ${WINDOWS.map(k => `<span class="st-num st-c-win st-c-${k}${k === dim ? " is-sel" : ""}">${DIMS.find(d => d.key === k).label}</span>`).join("")}
      <span class="st-num st-c-win st-c-score${dim === "score" ? " is-sel" : ""}">綜合</span></div>`;
    const body = rows.map((r, i) => {
      const q = quadOf(r);
      const val = dim === "score" ? (r.score == null ? "—" : r.score.toFixed(0)) : fmtPct1(r[dim]);
      const valCls = dim === "score" ? "" : dir(r[dim]);
      const open = stPref.open === r.name;
      const breadth = r[bk + "N"] ? `${r[bk + "Up"]}/${r[bk + "N"]}` : "—";
      return `<div class="st-item${open ? " open" : ""}" data-row="${esc(r.name)}">
        <button class="st-row" type="button" data-toggle="${esc(r.name)}" aria-expanded="${open}">
          <span class="st-rank">${i + 1}</span>
          <span class="st-name"><i class="st-qdot" style="background:${QUADS[q].color}" title="${QUADS[q].label}"></i>${esc(r.name)}<small>${r.n}</small></span>
          <span class="st-barcell">${barHTML(r, dim, maxAbs)}<b class="${valCls}">${val}</b></span>
          <span class="st-num st-breadth">${breadth}</span>
          ${WINDOWS.map(k => `<span class="st-num st-c-win st-c-${k} ${dir(r[k])}${k === dim ? " is-sel" : ""}">${fmtPct1(r[k])}</span>`).join("")}
          <span class="st-num st-c-win st-c-score${dim === "score" ? " is-sel" : ""}">${r.score == null ? "—" : r.score.toFixed(0)}</span>
        </button>
        ${open ? stMembersHTML(r.name, dim) : ""}
      </div>`;
    }).join("");
    box.innerHTML = head + body;
  }

  function stMembersHTML(theme, dim) {
    const k = dim === "score" ? "w" : dim;
    const sec = sectors().find(s => s.name === theme);
    const list = (sec ? sectorSymbols(sec) : []).map(sym => ({ sym, v: stData.q[sym] || {} }))
      .sort((a, b) => (b.v[k] ?? -Infinity) - (a.v[k] ?? -Infinity));
    const rows = list.map(({ sym, v }) => {
      const nm = nameOf(sym);
      return `<tr><td class="left"><a class="sym" href="${tradingViewUrl(sym)}" target="_blank" rel="noopener">${esc(sym)}</a><span class="cname">${esc(nm && nm !== sym ? nm : "")}</span></td>
        ${WINDOWS.map(w => `<td class="${dir(v[w])}">${fmtPct1(v[w])}</td>`).join("")}</tr>`;
    }).join("");
    return `<div class="st-members">
      <div class="tscroll"><table class="st-table"><thead><tr><th class="left">個股（依${k === "w" && dim === "score" ? "週" : DIMS.find(d => d.key === k).label}漲跌排序）</th>${WINDOWS.map(w => `<th>${DIMS.find(d => d.key === w).label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <a class="text-link st-open-wl" href="#watchlist" data-wl="${esc(theme)}">在 Watchlist 開啟「${esc(theme)}」 →</a>
    </div>`;
  }

  function stToggle(name, scroll) {
    stPref.open = stPref.open === name ? null : name; stSavePref();
    stRenderQuad(); stRenderList();
    if (scroll && stPref.open) {
      const el = document.querySelector(`.st-item[data-row="${CSS.escape(name)}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Called when the cloud copy of the themes arrives (or fails to).
  function stOnThemes() {
    stRender();
    if (!stAutoDone) {
      const syms = allSymbols();
      const missing = syms.some(s => !stData.q[s]);
      if (Date.now() - stData.t > ST_STALE || missing) { stAutoDone = true; stRefresh(); }
      else stAutoDone = true;
    }
  }

  function stWire() {
    $("stRefresh").addEventListener("click", stRefresh);
    $("stDims").addEventListener("click", e => {
      const b = e.target.closest("[data-dim]");
      if (!b) return;
      stPref.dim = b.dataset.dim; stSavePref(); stRender();
    });
    $("stQuad").addEventListener("click", e => {
      const g = e.target.closest("[data-theme]");
      if (g) stToggle(g.dataset.theme, true);
    });
    $("stList").addEventListener("click", e => {
      const wl = e.target.closest("[data-wl]");
      if (wl) {
        const t = wl.dataset.wl;
        const sec = sectors().find(s => s.name === t);
        if (sec) { if (started) selectSector(sec.id); else { pref.active = sec.id; savePref(); } }
        return;   // the href navigates to #watchlist
      }
      const row = e.target.closest("[data-toggle]");
      if (row) stToggle(row.dataset.toggle, false);
    });
    let rz = null;
    window.addEventListener("resize", () => {
      clearTimeout(rz);
      rz = setTimeout(() => { if (location.hash === "#strength") stRenderQuad(); }, 150);
    });
  }

  function stStart() {
    if (stStarted) { stRenderQuad(); return; }   // re-measure width on revisit
    stStarted = true;
    stWire();
    stRender();
    initFirebase();
    if (cloudLoaded || !cloudReady) stOnThemes();
    else setTimeout(() => { if (!stAutoDone) stOnThemes(); }, 5000);   // Firestore slow: use cached themes
  }

  /* ---------- lazy start ---------- */
  document.addEventListener("pagechange", e => {
    if (e.detail === "watchlist") start();
    if (e.detail === "strength") stStart();
  });
  if (location.hash === "#watchlist") start();
  if (location.hash === "#strength") stStart();
})();
