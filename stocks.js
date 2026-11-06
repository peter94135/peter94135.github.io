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
  let intelCounts = {};                     // sym → number of 產業情報站 notes (intel.js)

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
        window.dispatchEvent(new CustomEvent("site-tree"));
      }, err => {
        console.warn("Firestore listen failed:", err.message);
        cloudLoaded = true;
        if (started) renderAll();
        window.dispatchEvent(new CustomEvent("site-tree"));
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
    const intelN = intelCounts[sym] || 0;
    const tags = NEWS_TAGS.filter(([k]) => ev[k]).map(([k, label, tcls, tip]) =>
      `<a class="tc-tag ${tcls}" href="#${k}&item=${encodeURIComponent(ev[k].id)}" title="${tip}${ev[k].date ? `（最新：${esc(ev[k].date)}）` : ""}">${label}</a>`).join("")
      + (intelN ? `<a class="tc-tag tg-intel" href="#intel&ticker=${encodeURIComponent(sym)}" title="我記錄的產業情報 ${intelN} 則，前往查看">訊<span class="tc-tag-n">${intelN}</span></a>` : "");
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
          <span class="tl-row"><span class="tc-tag tg-intel">訊</span> 我手動記錄的產業情報 · 數字為則數</span>
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
      if (window.intelStore) {
        intelCounts = window.intelStore.counts();
        window.addEventListener(window.intelStore.EVT, () => { intelCounts = window.intelStore.counts(); renderBar(); });
        window.intelStore.sync();
      }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", loadNewsIdx);
    else loadNewsIdx();
  }

  /* =====================================================================
   * Shared quote engine — used by the Watchlist and by strength.js (題材強弱).
   * Prices come from Yahoo's batch "spark" endpoint (20 symbols / request),
   * so all ~680 tickers update in a few seconds. Returns are fractions.
   * ===================================================================== */
  const ST_LS = { data: "st_data_v1" };
  let stData = load(ST_LS.data) || { t: 0, q: {} };
  const allSymbols = () => [...new Set(sectors().flatMap(sectorSymbols))];

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

  // Fetch quotes for every watchlist symbol (+ volume via the quote endpoint).
  // onProgress(done, total) is called as batches arrive.
  let quoteAllP = null;
  window.siteQuoteAll = function (onProgress) {
    if (quoteAllP) return quoteAllP;
    quoteAllP = (async () => {
      const syms = allSymbols();
      let done = 0;
      const fundNeed = syms.filter(s => !fund[s] || Date.now() - fund[s].t > FUND_FRESH);
      const fundP = inChunks(fundNeed, 40, 2, async c => { Object.assign(fund, await fetchFundamentals(c)); });
      await inChunks(syms, 20, 4, async c => {
        let res = null;
        for (let a = 0; a < 2 && !res; a++) { try { res = await fetchSpark(c); } catch (e) { /* retry */ } }
        if (res) Object.assign(stData.q, res);
        done += c.length;
        if (onProgress) onProgress(Math.min(done, syms.length), syms.length);
      });
      stData.t = Date.now();
      store(ST_LS.data, stData);
      await fundP;
      store(LS.fund, fund);
      return { q: stData.q, fund, t: stData.t, total: syms.length };
    })().finally(() => { quoteAllP = null; });
    return quoteAllP;
  };
  // Resolves with the watchlist tree once Firestore has answered (or with the cached copy).
  window.siteTree = function () {
    initFirebase();
    if (cloudLoaded || !cloudReady) return Promise.resolve(tree);
    return new Promise(res => {
      const h = () => { window.removeEventListener("site-tree", h); res(tree); };
      window.addEventListener("site-tree", h);
      setTimeout(h, 6000);   // Firestore slow: use the cached tree
    });
  };

  /* ---------- lazy start ---------- */
  document.addEventListener("pagechange", e => { if (e.detail === "watchlist") start(); });
  if (location.hash === "#watchlist") start();
})();
