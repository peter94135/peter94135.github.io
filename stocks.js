/* =====================================================================
 * Stock Watchlist
 * Ported from the "Stock Theme Dashboard" (peter94135/stock-dashboard):
 *   - themes + ticker lists live in Firestore  dashboards/main  (shared with
 *     the full dashboard, so editing either one updates both)
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
  function initFirebase() {
    if (typeof firebase === "undefined") return;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      auth = firebase.auth();
      cloudReady = true;
      auth.onAuthStateChanged(u => { user = u; updateAuthUI(); render(); });
      db.doc(CLOUD_DOC).onSnapshot(snap => {
        cloudLoaded = true;
        if (!snap.exists) { updateAuthUI(); return; }
        const d = snap.data() || {};
        suppressCloud = true;
        if (d.themes) themes = d.themes;
        if (d.names) names = Object.assign({}, names, d.names);
        store(LS.themes, themes); store(LS.names, names);
        suppressCloud = false;
        updateAuthUI();
        render();
        const cur = activeTheme();
        if (cur && themes[cur].some(s => !dataMap[s] || dataMap[s].last == null)) refresh();
      }, err => console.warn("Firestore listen failed:", err.message));
    } catch (e) { console.warn("Firebase init failed:", e.message); }
  }

  function updateAuthUI() {
    const inb = $("wlLogin"), outb = $("wlLogout"), info = $("wlAuth");
    if (!cloudReady) { inb.hidden = outb.hidden = true; info.textContent = ""; return; }
    if (user) {
      inb.hidden = true; outb.hidden = false;
      info.textContent = (user.displayName || user.email || "Signed in") + (canEdit() ? " · Editor" : " · Read-only");
    } else {
      inb.hidden = false; outb.hidden = true; info.textContent = "";
    }
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
    if (!all.length) { $("wlStatus").textContent = cur ? "No stocks in this theme" : "No themes"; render(); return; }
    const myId = ++refreshSeq;
    let done = 0;
    const status = () => { $("wlStatus").innerHTML = `<span class="loading">Updating ${esc(cur)} … ${done}/${all.length}</span>`; };
    status();
    const fundP = fetchFundamentals(all);
    const queue = [...all];
    async function worker() {
      while (queue.length) {
        if (myId !== refreshSeq) return;
        const sym = queue.shift();
        const prevPE = dataMap[sym] || {};
        dataMap[sym] = Object.assign(await fetchChart(sym), { pe: prevPE.pe, cap: prevPE.cap });
        done++;
        if (myId === refreshSeq) { status(); render(); }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    const fund = await fundP;
    all.forEach(s => mergeFund(s, fund[s]));
    store(LS.data, dataMap); store(LS.names, names);
    if (myId !== refreshSeq) return;
    render();
    $("wlStatus").textContent = "Updated " + new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
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
    document.querySelectorAll(".seg__btn").forEach(b => b.classList.toggle("active", b.dataset.view === pref.view));
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

  function addTheme() {
    if (!canEdit()) return;
    const n = (prompt("New theme name (Chinese OK), e.g. AI 伺服器") || "").trim();
    if (!n) return;
    if (themes[n]) { alert("A theme with that name already exists."); return; }
    themes[n] = []; pref.active = n; savePref(); saveThemes(); render();
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
    document.querySelectorAll(".seg__btn").forEach(b => b.addEventListener("click", () => {
      pref.view = b.dataset.view; savePref(); render();
    }));
    $("wlRefresh").addEventListener("click", refresh);
    $("wlAddTheme").addEventListener("click", addTheme);
    $("wlAddBtn").addEventListener("click", addTicker);
    $("wlAddInput").addEventListener("keydown", e => { if (e.key === "Enter") addTicker(); });
    $("wlRename").addEventListener("click", renameTheme);
    $("wlDelTheme").addEventListener("click", deleteTheme);
    $("wlLogin").addEventListener("click", () => {
      if (auth) auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(e => alert("Sign-in failed: " + e.message));
    });
    $("wlLogout").addEventListener("click", () => { if (auth) auth.signOut(); });
  }

  function start() {
    if (started) return;
    started = true;
    wire();
    render();
    initFirebase();
    refresh();
  }

  // Start the first time the Watchlist page is shown.
  document.addEventListener("pagechange", e => { if (e.detail === "watchlist") start(); });
  if (location.hash === "#watchlist") start();
})();
