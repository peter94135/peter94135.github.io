/* =====================================================================
 * Stock Watchlist
 * (Merged in from the former stand-alone "Stock Theme Dashboard".)
 *   - themes + ticker lists live in Firestore  dashboards/main
 *   - quotes come from Yahoo Finance through the Cloudflare Worker proxy
 *     (falls back to public CORS proxies)
 *   - only the selected theme is fetched; quotes are cached in localStorage
 * Loaded lazily: nothing is fetched until the Watchlist page is opened.
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
  const CLOUD_DOC = "dashboards/main";
  const WORKER_URL = "https://yf-proxy.peter94135.workers.dev";
  // Google-sign-in UIDs allowed to edit (must match the Firestore write rules).
  const OWNER_UIDS = [
    "JN5nkZ6t8TcEc6AJNvnISvdWKDt1",
    "arxW8uOFEQTwBb8o3XKkOnsGu5H3",
  ];
  // Used only until the cloud copy arrives (or if Firestore is unreachable).
  const FALLBACK_THEMES = {
    "半導體設備": ["LRCX", "AMAT", "ASML", "KLAC", "8035.T", "6857.T", "3131.TWO"],
    "記憶體/SSD/HDD": ["MU", "000660.KS", "005930.KS", "WDC", "STX", "2408.TW"],
    "高速傳輸": ["CRDO", "ALAB", "3665.TW", "TEL", "APH"],
  };
  const PROXIES = [
    u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  ];
  const LS = { themes: "wl_themes_v1", names: "wl_names_v1", data: "wl_data_v1", pref: "wl_pref_v1" };

  /* ---------- state ---------- */
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let themes = load(LS.themes) || structuredClone(FALLBACK_THEMES);
  let names = load(LS.names) || {};
  let dataMap = load(LS.data) || {};
  let pref = Object.assign({ active: null, view: "cards", sort: { key: "day", dir: -1 }, collapsed: {} }, load(LS.pref) || {});

  let db = null, auth = null, user = null;
  let cloudReady = false, cloudLoaded = false, suppressCloud = false, cloudTimer = null;
  let started = false, refreshSeq = 0;

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Firestore does not preserve map key order, so sort tabs for a stable layout.
  const themeKeys = () => Object.keys(themes).sort((a, b) => a.localeCompare(b, "zh-Hant"));

  function activeTheme() {
    const keys = themeKeys();
    if (!keys.length) return null;
    if (!pref.active || !themes[pref.active]) { pref.active = keys[0]; savePref(); }
    return pref.active;
  }
  const canEdit = () => cloudLoaded && user && OWNER_UIDS.includes(user.uid);
  const savePref = () => store(LS.pref, pref);

  function saveThemes() {
    store(LS.themes, themes);
    store(LS.names, names);
    if (!cloudReady || suppressCloud || !canEdit()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => {
      db.doc(CLOUD_DOC).set({ themes, names, updated: Date.now() }, { merge: true })
        .catch(e => console.warn("Cloud save failed:", e.message));
    }, 600);
  }

  /* ---------- Firebase ---------- */
  let fbInit = false;
  function initFirebase() {
    if (fbInit || typeof firebase === "undefined") return;
    fbInit = true;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      auth = firebase.auth();
      cloudReady = true;
      // Editing works when a signed-in owner session persists in this browser.
      auth.onAuthStateChanged(u => { user = u; if (started) render(); });
      db.doc(CLOUD_DOC).onSnapshot(snap => {
        cloudLoaded = true;
        if (!snap.exists) { if (stStarted) stOnThemes(); return; }
        const d = snap.data() || {};
        suppressCloud = true;
        if (d.themes) themes = d.themes;
        if (d.names) names = Object.assign({}, names, d.names);
        store(LS.themes, themes); store(LS.names, names);
        suppressCloud = false;
        if (started) {
          render();
          const cur = activeTheme();
          if (cur && themes[cur].some(s => !dataMap[s] || dataMap[s].last == null)) refresh();
        }
        if (stStarted) stOnThemes();
      }, err => { console.warn("Firestore listen failed:", err.message); if (stStarted) stOnThemes(); });
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

  async function fetchChart(sym) {
    const out = { symbol: sym, error: false };
    try {
      const j = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d`);
      const res = j.chart.result[0], m = res.meta;
      const ts = res.timestamp || [];
      const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0].close) || [];
      const last = m.regularMarketPrice;
      const nowSec = m.regularMarketTime || Math.floor(Date.now() / 1000);
      const firstClose = closes.find(c => c != null);
      // Previous close = last daily close before the current trading day.
      // (meta.chartPreviousClose is the close *before the 1y range*, not yesterday.)
      const gmt = m.gmtoffset || 0;
      const dayStart = Math.floor((nowSec + gmt) / 86400) * 86400 - gmt;
      let prev = null;
      for (let i = 0; i < ts.length; i++) {
        if (closes[i] == null) continue;
        if (ts[i] < dayStart) prev = closes[i]; else break;
      }
      if (prev == null) prev = m.previousClose ?? null;
      const ref = daysAgo => {
        const target = nowSec - daysAgo * 86400;
        let best = null;
        for (let i = 0; i < ts.length; i++) {
          if (closes[i] == null) continue;
          if (ts[i] <= target) best = closes[i]; else break;
        }
        return best ?? firstClose;
      };
      const pct = r => (r ? (last - r) / r : null);
      Object.assign(out, {
        last, currency: m.currency, volume: m.regularMarketVolume,
        day: pct(prev), week: pct(ref(7)), month: pct(ref(30)), year: pct(firstClose),
      });
      if (m.longName || m.shortName) names[sym] = { name: m.longName || m.shortName, currency: m.currency };
    } catch (e) { out.error = true; }
    out.name = (names[sym] && names[sym].name) || sym;
    return out;
  }

  async function fetchFundamentals(symbols) {
    const res = {};
    if (!symbols.length) return res;
    try {
      const j = await fetchJSON(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`);
      for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
        res[q.symbol] = { pe: q.trailingPE ?? null, cap: q.marketCap ?? null, name: q.longName || q.shortName, currency: q.currency };
      }
    } catch (e) { /* leave blank */ }
    return res;
  }

  function mergeFund(sym, f) {
    if (!f) return;
    const d = dataMap[sym] || (dataMap[sym] = { symbol: sym });
    d.pe = f.pe; d.cap = f.cap;
    if (f.currency && !d.currency) d.currency = f.currency;
    if ((!names[sym] || !names[sym].name) && f.name) names[sym] = { name: f.name, currency: f.currency };
    if (!d.name || d.name === sym) d.name = (names[sym] && names[sym].name) || sym;
  }

  async function refresh() {
    const cur = activeTheme();
    const all = cur ? [...new Set(themes[cur])] : [];
    if (!all.length) { render(); return; }
    const myId = ++refreshSeq;
    const fundP = fetchFundamentals(all);
    const queue = [...all];
    async function worker() {
      while (queue.length) {
        if (myId !== refreshSeq) return;
        const sym = queue.shift();
        const prevPE = dataMap[sym] || {};
        dataMap[sym] = Object.assign(await fetchChart(sym), { pe: prevPE.pe, cap: prevPE.cap });
        if (myId === refreshSeq) render();
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    const fund = await fundP;
    all.forEach(s => mergeFund(s, fund[s]));
    store(LS.data, dataMap); store(LS.names, names);
    if (myId !== refreshSeq) return;
    render();
  }

  /* ---------- formatting ---------- */
  const fmtPrice = v => (v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const fmtPct = v => (v == null || isNaN(v) ? "—" : (v > 0 ? "+" : "") + (v * 100).toFixed(2) + "%");
  const fmtVol = v => (v == null || isNaN(v) ? "—" : v >= 1e6 ? (v / 1e6).toFixed(2) + " M" : Math.round(v).toLocaleString("en-US"));
  function fmtCap(v, cur) {
    if (v == null || isNaN(v)) return "—";
    const s = v >= 1e12 ? (v / 1e12).toFixed(2) + " T" : v >= 1e9 ? (v / 1e9).toFixed(2) + " B" : v >= 1e6 ? (v / 1e6).toFixed(2) + " M" : Math.round(v).toLocaleString("en-US");
    return s + (cur ? " " + cur : "");
  }
  const dir = v => (v > 0 ? "up" : v < 0 ? "down" : "flat");
  function tvUrl(sym) {
    const base = sym.replace(/\..*/, "");
    let path = base;
    if (sym.endsWith(".TWO")) path = "TPEX-" + base;
    else if (sym.endsWith(".TW")) path = "TWSE-" + base;
    else if (sym.endsWith(".T")) path = "TSE-" + base;
    else if (sym.endsWith(".KS")) path = "KRX-" + base;
    else if (sym.endsWith(".KQ")) path = "KRX-" + base;
    else if (sym.endsWith(".HK")) path = "HKEX-" + base;
    return "https://www.tradingview.com/symbols/" + encodeURIComponent(path) + "/";
  }

  /* ---------- rendering ---------- */
  const COLS = [
    { key: "name", label: "Name", left: true },
    { key: "last", label: "Last" },
    { key: "volume", label: "Volume" },
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
    { key: "year", label: "Year" },
    { key: "pe", label: "P/E" },
    { key: "cap", label: "Market Cap" },
  ];

  function render() {
    document.body.classList.toggle("readonly", !canEdit());
    renderTabs();
    const body = $("wlBody");
    const cur = activeTheme();
    document.querySelectorAll("#page-watchlist .seg__btn").forEach(b => b.classList.toggle("active", b.dataset.view === pref.view));
    if (!cur) { body.innerHTML = `<div class="wl-empty">No themes yet.</div>`; setSummary([]); return; }
    const rows = themes[cur].map(s => ({ sym: s, d: dataMap[s] || { symbol: s } }));
    setSummary(rows);
    if (!rows.length) { body.innerHTML = `<div class="wl-empty">No stocks in this theme yet.</div>`; return; }
    body.innerHTML = pref.view === "table" ? tableHTML(cur, rows) : cardsHTML(rows);
  }

  function renderTabs() {
    const cur = activeTheme();
    $("wlTabs").innerHTML = themeKeys().map(t =>
      `<button class="sector-tab${t === cur ? " active" : ""}" data-theme="${esc(t)}" type="button">${esc(t)}<span class="tcount">${themes[t].length}</span></button>`
    ).join("");
  }

  function setSummary(rows) {
    let up = 0, down = 0, flat = 0;
    rows.forEach(({ d }) => { if (d.day > 0) up++; else if (d.day < 0) down++; else if (d.day === 0) flat++; });
    $("wlUp").textContent = up; $("wlDown").textContent = down; $("wlFlat").textContent = flat;
  }

  function cardHTML(sym, d) {
    const name = d.name || (names[sym] && names[sym].name) || "";
    const body = d.error && d.last == null
      ? `<div class="tc-err">Failed to load</div>`
      : `<div class="tc-price">${fmtPrice(d.last)}</div><span class="tc-change">${fmtPct(d.day)}</span>`;
    return `<a class="ticker-card ${dir(d.day)}" href="${tvUrl(sym)}" target="_blank" rel="noopener" title="Open ${esc(sym)} in TradingView">
      <button class="tc-del" data-del="${esc(sym)}" type="button" title="Remove">✕</button>
      <div class="tc-symbol">${esc(sym)}</div>
      <div class="tc-name">${esc(name && name !== sym ? name : "")}&nbsp;</div>
      ${body}</a>`;
  }

  function cardsHTML(rows) {
    const byDay = (a, b) => (b.d.day ?? -Infinity) - (a.d.day ?? -Infinity);
    const ups = rows.filter(r => r.d.day > 0).sort(byDay);
    const downs = rows.filter(r => r.d.day < 0).sort((a, b) => a.d.day - b.d.day);
    const rest = rows.filter(r => !(r.d.day > 0) && !(r.d.day < 0));
    const zone = (key, cls, label, list) => {
      if (!list.length) return "";
      const collapsed = pref.collapsed[key] ? " collapsed" : "";
      return `<div class="ticker-zone ${cls}${collapsed}" data-zone="${key}">
        <div class="tz-head"><span class="tz-caret">▼</span>${label}<span class="tz-count">${list.length}</span></div>
        <div class="tz-grid">${list.map(r => cardHTML(r.sym, r.d)).join("")}</div></div>`;
    };
    return `<div class="tz-wrap">${zone("up", "tz-up", "上漲", ups)}${zone("down", "tz-down", "下跌", downs)}${zone("flat", "tz-flat", "平盤 / 讀取中", rest)}</div>`;
  }

  function tableHTML(theme, rows) {
    const s = pref.sort;
    rows = rows.slice().sort((a, b) => {
      if (s.key === "name") {
        const va = (a.d.name || a.sym).toLowerCase(), vb = (b.d.name || b.sym).toLowerCase();
        return va < vb ? -s.dir : va > vb ? s.dir : 0;
      }
      const va = a.d[s.key], vb = b.d[s.key];
      if (va == null) return 1; if (vb == null) return -1;
      return (va - vb) * s.dir;
    });
    const head = COLS.map(c => `<th class="${c.left ? "left" : ""}" data-sort="${c.key}">${c.label}${s.key === c.key ? `<span class="arrow">${s.dir < 0 ? "▼" : "▲"}</span>` : ""}</th>`).join("");
    const body = rows.map(({ sym, d }) => {
      const cur = (names[sym] && names[sym].currency) || d.currency;
      const nameCell = `<td class="left"><button class="tc-del" data-del="${esc(sym)}" type="button" title="Remove">✕</button><a class="sym" href="${tvUrl(sym)}" target="_blank" rel="noopener">${esc(sym)}</a><span class="cname">${esc(d.name && d.name !== sym ? d.name : "")}</span></td>`;
      if (d.error && d.last == null) return `<tr>${nameCell}<td colspan="${COLS.length - 1}" style="text-align:left;color:var(--down)">Failed to load</td></tr>`;
      return `<tr>${nameCell}
        <td class="last">${fmtPrice(d.last)}</td><td>${fmtVol(d.volume)}</td>
        <td class="${dir(d.day)}">${fmtPct(d.day)}</td><td class="${dir(d.week)}">${fmtPct(d.week)}</td>
        <td class="${dir(d.month)}">${fmtPct(d.month)}</td><td class="${dir(d.year)}">${fmtPct(d.year)}</td>
        <td>${d.pe != null ? d.pe.toFixed(2) : "—"}</td><td>${fmtCap(d.cap, cur)}</td></tr>`;
    }).join("");
    return `<div class="tscroll"><table class="wl-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  /* ---------- actions ---------- */
  function selectTheme(t) {
    if (pref.active === t) return;
    pref.active = t; savePref(); render(); refresh();
  }

  async function addTicker() {
    const inp = $("wlAddInput");
    const cur = activeTheme();
    const s = inp.value.trim().toUpperCase();
    if (!s || !cur || !canEdit()) return;
    inp.value = "";
    if (themes[cur].includes(s)) return;
    themes[cur].push(s); saveThemes(); render();
    dataMap[s] = await fetchChart(s);
    mergeFund(s, (await fetchFundamentals([s]))[s]);
    store(LS.data, dataMap); saveThemes(); render();
  }

  function removeTicker(sym) {
    const cur = activeTheme();
    if (!cur || !canEdit()) return;
    themes[cur] = themes[cur].filter(x => x !== sym); saveThemes(); render();
  }

  function renameTheme() {
    const old = activeTheme();
    if (!old || !canEdit()) return;
    const nn = (prompt("New theme name:", old) || "").trim();
    if (!nn || nn === old) return;
    if (themes[nn]) { alert("A theme with that name already exists."); return; }
    const obj = {};
    for (const k of Object.keys(themes)) obj[k === old ? nn : k] = themes[k];
    themes = obj; pref.active = nn; savePref(); saveThemes(); render();
  }

  function deleteTheme() {
    const t = activeTheme();
    if (!t || !canEdit() || !confirm(`Delete theme “${t}”?`)) return;
    delete themes[t]; pref.active = null; savePref(); saveThemes(); render(); refresh();
  }

  /* ---------- wiring ---------- */
  function wire() {
    $("wlTabs").addEventListener("click", e => {
      const b = e.target.closest("[data-theme]");
      if (b) selectTheme(b.dataset.theme);
    });
    $("wlBody").addEventListener("click", e => {
      const del = e.target.closest("[data-del]");
      if (del) { e.preventDefault(); e.stopPropagation(); removeTicker(del.dataset.del); return; }
      const head = e.target.closest(".tz-head");
      if (head) {
        const key = head.parentElement.dataset.zone;
        pref.collapsed[key] = !pref.collapsed[key]; savePref();
        head.parentElement.classList.toggle("collapsed");
        return;
      }
      const th = e.target.closest("th[data-sort]");
      if (th) {
        const k = th.dataset.sort;
        pref.sort = { key: k, dir: pref.sort.key === k ? -pref.sort.dir : (k === "name" ? 1 : -1) };
        savePref(); render();
      }
    });
    document.querySelectorAll("#page-watchlist .seg__btn").forEach(b => b.addEventListener("click", () => {
      pref.view = b.dataset.view; savePref(); render();
    }));
    $("wlAddBtn").addEventListener("click", addTicker);
    $("wlAddInput").addEventListener("keydown", e => { if (e.key === "Enter") addTicker(); });
    $("wlRename").addEventListener("click", renameTheme);
    $("wlDelTheme").addEventListener("click", deleteTheme);
  }

  function start() {
    if (started) return;
    started = true;
    wire();
    render();
    initFirebase();
    refresh();
  }

  /* =====================================================================
   * Theme Strength (題材強弱)
   *   Ranks every watchlist theme by price momentum. Each theme's return over
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
  const allSymbols = () => [...new Set(Object.values(themes).flat())];
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
    return { d: r(pts[pts.length - 2][1]), w: r(ref(7)), m: r(ref(30)), q: r(ref(91)), y: r(pts[0][1]) };
  }

  async function fetchSpark(syms) {
    const j = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(syms.join(","))}&range=1y&interval=1d`);
    if (j && j.spark && j.spark.error) throw new Error(j.spark.error.description || "spark error");
    const out = {};
    for (const s of syms) {
      const e = j && j[s];
      if (!e || !e.timestamp || !e.close) continue;
      const r = returnsFromSeries(e.timestamp, e.close);
      if (r) out[s] = r;
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
    const rows = themeKeys().map(name => {
      const syms = [...new Set(themes[name])];
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
    const list = [...new Set(themes[theme] || [])].map(sym => ({ sym, v: stData.q[sym] || {} }))
      .sort((a, b) => (b.v[k] ?? -Infinity) - (a.v[k] ?? -Infinity));
    const rows = list.map(({ sym, v }) => {
      const nm = (names[sym] && names[sym].name) || "";
      return `<tr><td class="left"><a class="sym" href="${tvUrl(sym)}" target="_blank" rel="noopener">${esc(sym)}</a><span class="cname">${esc(nm && nm !== sym ? nm : "")}</span></td>
        ${WINDOWS.map(w => `<td class="${dir(v[w])}">${fmtPct1(v[w])}</td>`).join("")}</tr>`;
    }).join("");
    return `<div class="st-members">
      <div class="tscroll"><table class="wl-table st-table"><thead><tr><th class="left">個股（依${k === "w" && dim === "score" ? "週" : DIMS.find(d => d.key === k).label}漲跌排序）</th>${WINDOWS.map(w => `<th>${DIMS.find(d => d.key === w).label}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
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
        if (started) selectTheme(t); else { pref.active = t; savePref(); }
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
