/* =====================================================================
 * News pages — 供應鏈瓶頸新聞 / 產業消息 / 財報電話會議分析
 * Layout and card renderers ported (with permission) from hgvf.github.io.
 *
 * Data: JSON files written once a day by a Claude cloud routine and pushed to
 * the `news-data` branch of this repo (see tools/news/SCHEMA.md):
 *   news/supply-chain.json   { updated, items: [...] }   newest first
 *   news/industry.json
 *   news/earnings.json
 * Read through raw.githubusercontent.com (CORS-enabled), lazily per page.
 * ===================================================================== */
(function () {
  "use strict";

  // Local preview can point at other data: http://localhost:8011/?newsdata=/news-test/#supply
  const DATA_BASE = (location.hostname === "localhost" && new URLSearchParams(location.search).get("newsdata"))
    || "https://raw.githubusercontent.com/peter94135/peter94135.github.io/refs/heads/news-data/news/";
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtDate = d => String(d || "").slice(0, 10);
  function chartUrl(symbol) {
    const tv = s => "https://www.tradingview.com/chart/?symbol=" + encodeURIComponent(s);
    const m = String(symbol).match(/^(.+)\.([A-Z]+)$/);
    if (!m) return tv(symbol);
    const ex = { TWO: "TPEX", TW: "TWSE", KQ: "KRX", KS: "KRX", T: "TSE", SS: "SSE", SZ: "SZSE", HK: "HKEX",
      AS: "EURONEXT", PA: "EURONEXT", DE: "XETR", MI: "MIL", MC: "BME", L: "LSE", ST: "OMX", CO: "OMX",
      HE: "OMX", OL: "OSL", SW: "SIX", JK: "IDX" }[m[2]];
    return tv(ex ? `${ex}:${m[1]}` : symbol);
  }
  const SENT = {
    bullish: { label: "偏多 Bullish", cls: "pos" },
    bearish: { label: "偏空 Bearish", cls: "neg" },
    neutral: { label: "中性 Neutral", cls: "neu" },
  };
  const sent = v => SENT[v] || SENT.neutral;
  const tickerLink = t => `<a class="rp-ticker" href="${esc(chartUrl(t))}" target="_blank" rel="noopener" title="在 TradingView 看 ${esc(t)} 線圖">${esc(t)}</a>`;

  const loaded = {};
  function loadItems(file) {
    if (!loaded[file]) {
      const bucket = Math.floor(Date.now() / 600000);   // 10-min cache buckets
      loaded[file] = fetch(`${DATA_BASE}${file}.json?t=${bucket}`, { cache: "no-store" }).then(async r => {
        if (r.status === 404) return { updated: null, items: [] };
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        items.forEach((it, i) => { if (!it.id) it.id = `${file}-${i}`; });
        return { updated: j.updated || null, items };
      });
      loaded[file].catch(() => { delete loaded[file]; });
    }
    return loaded[file];
  }

  // Shared with annual.js / defense.js (ported pages).
  window.newsLib = { esc, chartUrl, loadItems, fmtDate, sent, fetchSeries: (...a) => fetchSeries(...a) };

  // For the Watchlist ticker cards (供 / 產 / 法 tags): symbol → latest related item per page.
  // { "NVDA": { supply: { id, date }, industry: {...}, earnings: {...} } }
  window.newsTickerIndex = async function () {
    const idx = {};
    const add = (sym, kind, it, date) => {
      if (!sym) return;
      const e = idx[sym] || (idx[sym] = {});
      if (!e[kind] || String(date) > String(e[kind].date)) e[kind] = { id: it.id, date: String(date || "") };
    };
    const [sc, ind, ec] = await Promise.all(["supply-chain", "industry", "earnings"].map(f => loadItems(f).catch(() => ({ items: [] }))));
    sc.items.forEach(it => (it.tickers || []).forEach(t => add(t, "supply", it, it.date)));
    ind.items.forEach(it => new Set([...(it.tickers || []), ...((it.companies || []).map(c => c.ticker))]).forEach(t => add(t, "industry", it, it.event_date)));
    ec.items.forEach(it => add(it.ticker, "earnings", it, it.date));
    return idx;
  };

  function deepLink() {
    const p = new URLSearchParams(location.hash.slice(1).split("&").slice(1).join("&"));
    return { item: p.get("item"), ticker: p.get("ticker") };
  }

  /* ---------------- 重點新聞 collection (as collect.js on hgvf.github.io) ----------------
   * One shared list in Firestore doc dashboards/highlights (public read), mirrored in
   * localStorage for an instant first paint. Writes reach Firestore only when the site
   * owner's Google session is present in this browser; otherwise picks stay local and are
   * uploaded the next time the owner is signed in here. */
  const HL_DOC = "dashboards/highlights", HL_KEY = "hl_collected_v1", HL_EVT = "hl-collect-change";
  const SOURCE_LABEL = { "supply-chain": "供應鏈瓶頸", "industry-news": "產業消息" };
  const readHL = () => { try { const a = JSON.parse(localStorage.getItem(HL_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  let hlCache = readHL(), hlCloudIds = new Set(), hlRef = null, hlSynced = false;
  const hlKey = id => String(id).replace(/[/.~*[\]]/g, "_").slice(0, 1400);
  function hlBroadcast() {
    hlCache.sort((a, b) => (b._collected_at || 0) - (a._collected_at || 0));
    try { localStorage.setItem(HL_KEY, JSON.stringify(hlCache)); } catch (e) { /* quota */ }
    window.dispatchEvent(new CustomEvent(HL_EVT));
  }
  const canWrite = () => { try { return !!(firebase.auth && firebase.auth().currentUser); } catch (e) { return false; } };
  function hlWrite(snap) {
    if (!hlRef || !canWrite()) return;
    const { _source, _collected_at, _trend_tickers, ...item } = snap;
    const rec = { item, source: _source || "supply-chain", collected_at: _collected_at || Date.now() };
    if (Array.isArray(_trend_tickers)) rec.trend_tickers = _trend_tickers;
    hlRef.set({ items: { [hlKey(snap.id)]: rec } }, { merge: true }).catch(e => console.warn("collect save failed:", e.message));
  }
  function hlDelete(id) {
    if (!hlRef || !canWrite() || !hlCloudIds.has(id)) return;
    hlRef.update(new firebase.firestore.FieldPath("items", hlKey(id)), firebase.firestore.FieldValue.delete())
      .catch(e => console.warn("collect remove failed:", e.message));
  }
  function hlSync() {
    if (hlSynced) return;
    const db = window.siteFirestore && window.siteFirestore();
    if (!db) return;
    hlSynced = true;
    hlRef = db.doc(HL_DOC);
    hlRef.onSnapshot(snap => {
      const recs = (snap.exists && snap.data().items) || {};
      const cloud = Object.values(recs).map(d => Object.assign({}, d.item || {}, {
        _source: d.source || "supply-chain", _collected_at: d.collected_at || 0,
      }, Array.isArray(d.trend_tickers) ? { _trend_tickers: d.trend_tickers } : {}));
      hlCloudIds = new Set(cloud.map(x => x.id));
      const localOnly = hlCache.filter(x => !hlCloudIds.has(x.id));
      hlCache = [...cloud, ...localOnly];
      hlBroadcast();
      localOnly.forEach(hlWrite);
    }, e => console.warn("collect sync failed:", e.message));
    try {
      firebase.auth().onAuthStateChanged(u => { if (u) hlCache.filter(x => !hlCloudIds.has(x.id)).forEach(hlWrite); });
    } catch (e) { /* auth SDK not loaded */ }
  }
  const isCollected = id => hlCache.some(x => x.id === id);
  function toggleCollected(item, source) {
    if (isCollected(item.id)) {
      hlCache = hlCache.filter(x => x.id !== item.id); hlBroadcast(); hlDelete(item.id);
      return false;
    }
    const snap = Object.assign({}, item, { _source: source, _collected_at: Date.now() });
    hlCache = [snap, ...hlCache]; hlBroadcast(); hlWrite(snap);
    return true;
  }
  function setTrendTickers(id, arr) {
    const it = hlCache.find(x => x.id === id);
    if (!it) return;
    it._trend_tickers = arr; hlBroadcast(); hlWrite(it);
  }
  const BOOKMARK = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.2L5 20.5v-16a1 1 0 0 1 1-1z"/></svg>`;

  /* ---------------- 供應鏈瓶頸新聞 detail (scdetail) ---------------- */
  const CRED = { "高": "pos", "中": "neu", "低": "neg" };
  const credBadge = v => (v ? `<span class="rp-cred ${CRED[v] || "neu"}">可信度：${esc(v)}</span>` : "");
  const textCard = (cls, icon, label, val) => (val ? `<div class="rp-subcard ${cls}"><div class="rp-subcard-head">${icon} ${label}</div><div class="rp-subcard-body">${esc(val)}</div></div>` : "");
  function tagsCard(tags) {
    if (!tags || !tags.length) return "";
    return `<div class="rp-subcard rp-tags"><div class="rp-subcard-head">🏷️ 瓶頸關鍵字 / 題材</div>
      <div class="rp-chiprow">${tags.map(t => `<span class="rp-chipk">${esc(t)}</span>`).join("")}</div></div>`;
  }
  function scChainCard(ch) {
    if (!ch) return "";
    const seg = (label, arr) => (arr && arr.length)
      ? `<div class="rp-chain-seg"><span class="rp-chain-label">${label}</span><div class="rp-chain-items">${
          arr.map(o => `<div class="rp-chain-item"><b>${esc(o.name)}</b>${o.note ? `<span>${esc(o.note)}</span>` : ""}</div>`).join("")}</div></div>`
      : "";
    const body = seg("上游", ch.upstream) + seg("中游", ch.midstream) + seg("下游", ch.downstream);
    return body ? `<div class="rp-subcard rp-chain"><div class="rp-subcard-head">🔗 供應鏈上中下游影響</div>${body}</div>` : "";
  }
  function altCard(alts) {
    if (!alts || !alts.length) return "";
    const rows = alts.map(a => `<div class="rp-alt-row ${a.incumbent ? "inc" : ""}">
      <span class="rp-alt-name">${esc(a.name)}${a.incumbent ? ' <span class="rp-alt-tag">現任</span>' : ""}</span>
      <span class="rp-alt-share">${esc(a.share || "—")}</span>
      ${a.note ? `<span class="rp-alt-note">${esc(a.note)}</span>` : ""}</div>`).join("");
    return `<div class="rp-subcard rp-alt"><div class="rp-subcard-head">🔄 替代品 / 公司 · 市占</div><div class="rp-alt-list">${rows}</div></div>`;
  }
  function scDetail(it) {
    const s = sent(it.sentiment);
    const sources = (it.sources || []).length
      ? `<div class="news-src">來源：${it.sources.map(o => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title || o.url)}</a>`).join("")}</div>`
      : "";
    return `<article class="rv-detail ${s.cls}">
      <div class="rv-detail-meta">
        <span class="rp-date">${esc(fmtDate(it.date))}</span>
        ${(it.tickers || []).map(tickerLink).join("")}
        <span class="sent-tag ${s.cls}">${s.label}</span>
        ${credBadge(it.credibility)}
      </div>
      <h2 class="rv-detail-title">${esc(it.headline)}</h2>
      <p class="rv-detail-body">${esc(it.content)}</p>
      ${tagsCard(it.tags)}
      ${scChainCard(it.chain)}
      ${altCard(it.alternatives)}
      ${textCard("rp-effect", "⛓️", "下游影響", it.effect)}
      ${textCard("rp-signals", "🔍", "財報 / 逐字稿線索", it.signals)}
      ${textCard("rp-advise", "💡", "投資建議", it.advise)}
      ${sources}
    </article>`;
  }

  /* ---------------- 產業消息 detail (industrydetail) ---------------- */
  const EVENT_TYPE_LABEL = {
    supplier_change: "供應商變動", supply_agreement: "供應協議", capacity: "產能",
    raw_material_bom: "原料 / BOM", supply_disruption: "供應中斷", trade_policy: "貿易 / 關稅",
    strategic_investment: "戰略投資", permit_regulatory: "許可 / 法規",
  };
  const TIER_LABEL = { critical: "關鍵 Critical", high: "重要 High", relevant: "相關 Relevant" };
  const TIER_CLASS = { critical: "tier-critical", high: "tier-high", relevant: "tier-relevant" };
  const TIER_ORDER = { critical: 0, high: 1, relevant: 2 };
  const EVIDENCE_LABEL = { confirmed: "已確認", reported: "已報導", inferred: "推論", rumor: "傳聞" };
  const ROLE_LABEL = {
    supplier: "供應商", customer: "客戶", new_supplier: "新供應商", incumbent_supplier: "現任供應商",
    investor: "投資方", investee: "被投資", regulator: "監管機關", disruptor: "破壞者", affected_party: "受影響方",
  };
  const eventTypeLabel = t => EVENT_TYPE_LABEL[t] || t || "—";
  const tierClass = t => TIER_CLASS[t] || "tier-relevant";

  function inChangeCard(ch) {
    if (!ch || (!ch.before && !ch.after)) return "";
    const type = ch.type ? `<span class="in-change-type">${esc(ch.type)}</span>` : "";
    return `<div class="rp-subcard in-change"><div class="rp-subcard-head">🔀 供應鏈變化 ${type}</div>
      <div class="in-change-flow">
        <div class="in-change-side"><span class="in-change-lbl">變化前</span><span>${esc(ch.before || "—")}</span></div>
        <span class="in-change-arrow">→</span>
        <div class="in-change-side after"><span class="in-change-lbl">變化後</span><span>${esc(ch.after || "—")}</span></div>
      </div></div>`;
  }
  function inChainCard(sc) {
    if (!sc) return "";
    const arr = v => (Array.isArray(v) ? v : (v ? [v] : []));
    const row = (label, items) => (items.length
      ? `<div class="in-chain-row"><span class="in-chain-lbl">${label}</span>
          <span class="in-chain-vals">${items.map(x => `<span class="rp-chipk">${esc(x)}</span>`).join("")}</span></div>`
      : "");
    const body = row("上游", arr(sc.upstream)) + row("元件", arr(sc.component)) + row("供應商", arr(sc.supplier))
      + row("客戶", arr(sc.customer)) + row("終端市場", arr(sc.end_market));
    return body ? `<div class="rp-subcard rp-chain"><div class="rp-subcard-head">🔗 供應鏈鏈路</div>${body}</div>` : "";
  }
  function companiesCard(companies) {
    if (!companies || !companies.length) return "";
    const rows = companies.map(c => {
      const role = c.role ? `<span class="in-role">${esc(ROLE_LABEL[c.role] || c.role)}</span>` : "";
      const geo = [c.exchange, c.country].filter(Boolean).join(" · ");
      return `<div class="in-co-row"><span class="in-co-name">${esc(c.name || "")}</span>
        ${c.ticker ? tickerLink(c.ticker) : ""}${role}${geo ? `<span class="in-co-geo">${esc(geo)}</span>` : ""}</div>`;
    }).join("");
    return `<div class="rp-subcard rp-alt"><div class="rp-subcard-head">🏢 相關公司 / 角色</div><div class="in-co-list">${rows}</div></div>`;
  }
  function chipsCard(icon, label, items, cls = "") {
    const list = (items || []).filter(Boolean);
    if (!list.length) return "";
    return `<div class="rp-subcard rp-tags"><div class="rp-subcard-head">${icon} ${label}</div>
      <div class="rp-chiprow">${list.map(t => `<span class="rp-chipk ${cls}">${esc(t)}</span>`).join("")}</div></div>`;
  }
  function financialCard(f) {
    if (!f) return "";
    const has = v => v != null && v !== "";
    const money = (v, cur) => (has(v) ? `${cur || "USD"} ${isNaN(+v) ? v : Number(v).toLocaleString("en-US")}` : null);
    const rows = [
      ["金額", money(f.amount, f.currency)],
      ["產能變動", has(f.capacity_change_pct) ? `${f.capacity_change_pct}%` : null],
      ["價格變動", has(f.price_change_pct) ? `${f.price_change_pct}%` : null],
      ["營收曝險", has(f.revenue_exposure_pct) ? `${f.revenue_exposure_pct}%` : null],
      ["合約年限", has(f.contract_duration_years) ? `${f.contract_duration_years} 年` : null],
      ["生效日", f.effective_date || null],
    ].filter(r => r[1] != null);
    if (!rows.length) return "";
    return `<div class="rp-subcard rp-effect"><div class="rp-subcard-head">💰 財務數據</div>
      <div class="in-fin-grid">${rows.map(([k, v]) => `<div class="in-fin-item"><span class="in-fin-k">${esc(k)}</span><span class="in-fin-v">${esc(v)}</span></div>`).join("")}</div></div>`;
  }
  function inSourcesCard(sources) {
    if (!sources || !sources.length) return "";
    const links = sources.map(o => {
      const badge = o.is_primary ? `<span class="in-src-primary">主要</span>` : "";
      const type = o.source_type ? `<span class="in-src-type">${esc(o.source_type)}</span>` : "";
      return `<a class="in-src-link" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.publisher || o.title || o.url)}${type}${badge}</a>`;
    }).join("");
    return `<div class="news-src in-src">來源：${links}</div>`;
  }
  function inDetail(ev) {
    const tier = ev.importance_tier || "relevant";
    const tcls = tierClass(tier);
    return `<article class="rv-detail in-detail ${tcls}">
      <div class="rv-detail-meta in-meta">
        <span class="rp-date">${esc(fmtDate(ev.event_date))}</span>
        <span class="in-etype">${esc(eventTypeLabel(ev.event_type))}</span>
        ${(ev.event_type_secondary || []).map(t => `<span class="in-etype in-etype-sec">${esc(eventTypeLabel(t))}</span>`).join("")}
        ${(ev.tickers || []).map(tickerLink).join("")}
        ${(ev.regions || []).map(r => `<span class="in-region">${esc(r)}</span>`).join("")}
        <span class="in-tier ${tcls}">${esc(TIER_LABEL[tier] || tier)}${ev.importance_score != null ? ` · ${esc(ev.importance_score)}` : ""}</span>
        ${ev.evidence_level ? `<span class="in-evi in-evi-${esc(ev.evidence_level)}">${esc(EVIDENCE_LABEL[ev.evidence_level] || ev.evidence_level)}</span>` : ""}
      </div>
      <h2 class="rv-detail-title">${esc(ev.title_zh || ev.title_original || "")}</h2>
      ${ev.title_original && ev.title_original !== ev.title_zh ? `<p class="in-title-en">${esc(ev.title_original)}</p>` : ""}
      <p class="rv-detail-body">${esc(ev.summary_zh || "")}</p>
      ${ev.why_it_matters ? `<div class="rp-subcard rp-advise"><div class="rp-subcard-head">💡 為何重要</div><div class="rp-subcard-body">${esc(ev.why_it_matters)}</div></div>` : ""}
      ${inChangeCard(ev.change)}
      ${inChainCard(ev.supply_chain)}
      ${companiesCard(ev.companies)}
      ${financialCard(ev.financial_data)}
      ${chipsCard("🏷️", "題材 Themes", ev.themes)}
      ${chipsCard("🧩", "產品 / 材料", [...(ev.products || []), ...(ev.materials || [])])}
      ${chipsCard("🔍", "搜尋關鍵字", ev.search_keywords, "in-kw")}
      ${inSourcesCard(ev.sources)}
    </article>`;
  }

  /* ---------------- 財報電話會議 detail ---------------- */
  // Overall = bullish only if bullish highlights outnumber bearish + neutral (and vice versa).
  function overall(c) {
    let b = 0, r = 0, n = 0;
    (c.highlights || []).forEach(h => { if (h.sentiment === "bullish") b++; else if (h.sentiment === "bearish") r++; else n++; });
    return b > r + n ? "bullish" : r > b + n ? "bearish" : "neutral";
  }
  function hlHTML(h) {
    const hs = sent(h.sentiment);
    const icon = h.sentiment === "bullish" ? "▲" : h.sentiment === "bearish" ? "▼" : "—";
    return `<div class="ec-hl ${hs.cls}"><span class="sent-tag ${hs.cls}">${icon}</span><span class="ec-hl-tx">${esc(h.text)}</span></div>`;
  }
  function ecSources(c) {
    return (c.sources || []).length
      ? `<div class="news-src">來源：${c.sources.map(o => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title || o.url)}</a>`).join("")}</div>`
      : "";
  }
  function ecDetail(c) {
    const s = sent(overall(c));
    const hls = (c.highlights || []).map(hlHTML).join("");
    const watch = (c.watch || []).filter(Boolean);
    return `<article class="rv-detail ${s.cls}">
      <div class="ec-head">
        <span class="ec-ticker">${esc(c.ticker)}</span>
        <span class="ec-company">${esc(c.company || "")}</span>
        <a class="ec-kbtn" href="${esc(chartUrl(c.ticker))}" target="_blank" rel="noopener" title="在 TradingView 看 ${esc(c.ticker)} 線圖">📈 K線</a>
        <span class="ec-qtr">${esc(c.year)} ${esc(c.quarter)}${c.date ? " · " + esc(fmtDate(c.date)) : ""}</span>
      </div>
      ${c.summary ? `<p class="ec-summary">${esc(c.summary)}</p>` : ""}
      ${hls ? `<div class="ec-hls">${hls}</div>` : ""}
      ${watch.length ? `<div class="rp-subcard ec-watch"><div class="rp-subcard-head">🔮 未來重點看點</div><ul class="ec-watch-list">${watch.map(w => `<li><span class="ec-watch-tx">${esc(w)}</span></li>`).join("")}</ul></div>` : ""}
      ${ecSources(c)}
    </article>`;
  }
  function cmpCard(c) {
    const s = sent(overall(c));
    const watch = (c.watch || []).filter(Boolean);
    return `<div class="ec-cmp-card ${s.cls}">
      <div class="ec-cmp-top"><span class="ec-cmp-fy">${esc(c.year)} ${esc(c.quarter)}</span><span class="ec-cmp-date">${c.date ? esc(fmtDate(c.date)) : ""}</span></div>
      ${c.summary ? `<p class="ec-cmp-summary">${esc(c.summary)}</p>` : ""}
      <div class="ec-hls">${(c.highlights || []).map(hlHTML).join("")}</div>
      ${watch.length ? `<div class="ec-cmp-watch"><div class="ec-cmp-watch-h">🔮 未來看點</div><ul class="ec-watch-list">${watch.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    </div>`;
  }

  /* ---------------- master / detail view (reportview + industryview) ---------------- */
  // cfg: dateOf, tickersOf, nodeTitle, dotClass, chipOf, renderDetail, emptyHint,
  //      filters: [{ key, label, values: it => [...], labelOf?, order? }], search: it => text, digest?: items => html
  function mountView(root, items, cfg) {
    let view = "timeline", selectedId = null, calY, calM;
    const f = { q: "" };
    const filters = [
      ...(cfg.filters || []),
      { key: "ticker", label: "Ticker", values: cfg.tickersOf },
      { key: "year", label: "年份", values: it => [String(cfg.dateOf(it)).slice(0, 4)], order: "desc" },
    ];
    filters.forEach(x => { f[x.key] = "__all__"; });

    root.innerHTML = `
      <div class="${cfg.search ? "in-filters" : "rv-controls"}">
        ${cfg.search ? `<label class="in-search">🔍 <input type="search" class="in-search-input" data-role="q" placeholder="關鍵字搜尋（ticker / 公司 / 題材 / 材料…）" spellcheck="false" /></label>` : ""}
        <div class="${cfg.search ? "in-selects" : "rv-sels"}">
          ${filters.map(x => `<label class="rv-ctl">${x.label} <span class="rv-sel-wrap"><select class="rv-select" data-role="${x.key}"></select></span></label>`).join("")}
          ${cfg.search ? `<button class="in-clear" data-role="clear" type="button" title="清除所有篩選">清除</button>` : ""}
        </div>
        ${cfg.search ? "" : `<div class="rv-toggle"><button class="rv-tab active" data-view="timeline" type="button">時間軸</button><button class="rv-tab" data-view="calendar" type="button">月曆</button></div>`}
      </div>
      ${cfg.digest ? `<div class="in-digest" data-role="digest"></div>` : ""}
      ${cfg.search ? `<div class="rv-controls in-viewctl"><div class="rv-toggle"><button class="rv-tab active" data-view="timeline" type="button">時間軸</button><button class="rv-tab" data-view="calendar" type="button">月曆</button></div><span class="in-count" data-role="count"></span></div>` : ""}
      <div class="rv-split"><div class="rv-left"></div><div class="rv-right"></div></div>`;

    const leftEl = root.querySelector(".rv-left"), rightEl = root.querySelector(".rv-right");
    const sel = k => root.querySelector(`[data-role="${k}"]`);
    const emptyRight = () => `<div class="rv-empty rv-empty-right">← ${esc(cfg.emptyHint || "點選左側節點，內容會顯示在這裡")}</div>`;

    function matchesQuery(it) {
      if (!f.q || !cfg.search) return true;
      const hay = cfg.search(it).toLowerCase();
      return f.q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
    }
    const filtered = () => items.filter(it =>
      filters.every(x => f[x.key] === "__all__" || (x.values(it) || []).includes(f[x.key])) && matchesQuery(it));

    function setDefaultCalMonth() {
      const list = filtered();
      const d = list.length && cfg.dateOf(list[0]) ? new Date(fmtDate(cfg.dateOf(list[0])) + "T00:00:00") : new Date();
      calY = d.getFullYear(); calM = d.getMonth();
    }

    function timelineHTML(list) {
      if (!list.length) return `<div class="rv-empty">${items.length ? "符合條件的項目為 0，試著放寬篩選。" : "目前沒有資料。排程每天更新，請稍後再來看看。"}</div>`;
      const groups = {};
      list.forEach(it => { const k = String(cfg.dateOf(it) || "—").slice(0, 7); (groups[k] = groups[k] || []).push(it); });
      return Object.keys(groups).sort().reverse().map(k => {
        const [y, m] = k.split("-");
        const rows = groups[k].map(it => `<div class="rv-row" data-id="${esc(it.id)}" role="button" tabindex="0">
            <span class="rv-dot ${cfg.dotClass(it)}"></span>
            <span class="rv-row-date">${esc(fmtDate(cfg.dateOf(it)).slice(5))}</span>
            <span class="rv-row-title">${esc(cfg.nodeTitle(it))}</span>
            ${cfg.collect ? `<span class="rv-row-collect${isCollected(it.id) ? " on" : ""}" data-collect="${esc(it.id)}" role="button" tabindex="0" title="收藏到重點新聞" aria-label="收藏到重點新聞">${BOOKMARK}</span>` : ""}</div>`).join("");
        return `<section class="rv-month"><h3 class="rv-month-h">${esc(y)} 年 ${esc(String(parseInt(m, 10)))} 月<span class="rv-month-n">${groups[k].length}</span></h3><div class="rv-rows">${rows}</div></section>`;
      }).join("");
    }

    function calendarHTML(list) {
      const prefix = `${calY}-${String(calM + 1).padStart(2, "0")}`;
      const byDay = {};
      list.forEach(it => { const d = fmtDate(cfg.dateOf(it)); if (d.slice(0, 7) === prefix) (byDay[d] = byDay[d] || []).push(it); });
      const startDow = new Date(calY, calM, 1).getDay(), days = new Date(calY, calM + 1, 0).getDate();
      let cells = "";
      for (let i = 0; i < startDow; i++) cells += `<div class="rv-cal-cell empty"></div>`;
      for (let d = 1; d <= days; d++) {
        const its = byDay[`${prefix}-${String(d).padStart(2, "0")}`] || [];
        const chips = its.map(it => `<button class="rv-cal-chip ${cfg.dotClass(it)}" data-id="${esc(it.id)}" title="${esc(cfg.nodeTitle(it))}" type="button">${esc(cfg.chipOf(it))}</button>`).join("");
        cells += `<div class="rv-cal-cell${its.length ? " has" : ""}"><span class="rv-cal-day">${d}</span><div class="rv-cal-chips">${chips}</div></div>`;
      }
      return `<div class="rv-cal"><div class="rv-cal-nav">
          <button class="rv-nav" data-nav="-1" aria-label="上個月" type="button">‹</button>
          <span class="rv-cal-title">${calY} 年 ${calM + 1} 月</span>
          <button class="rv-nav" data-nav="1" aria-label="下個月" type="button">›</button></div>
        <div class="rv-cal-grid">${DOW.map(x => `<div class="rv-cal-dow">${x}</div>`).join("")}${cells}</div></div>`;
    }

    function renderLeft() {
      const list = filtered();
      if (cfg.digest) sel("digest").innerHTML = list.length ? cfg.digest(list) : "";
      if (sel("count")) sel("count").textContent = `${list.length} / ${items.length} 則`;
      root.classList.toggle("rv-cal-mode", view === "calendar");
      leftEl.innerHTML = view === "timeline" ? timelineHTML(list) : calendarHTML(list);
      if (selectedId) leftEl.querySelectorAll(`[data-id="${CSS.escape(selectedId)}"]`).forEach(n => n.classList.add("active"));
    }

    function selectItem(id) {
      selectedId = id;
      const it = items.find(x => x.id === id);
      rightEl.innerHTML = it ? cfg.renderDetail(it) : emptyRight();
      leftEl.querySelectorAll("[data-id]").forEach(n => n.classList.toggle("active", n.dataset.id === id));
      if (cfg.onSelect && it) cfg.onSelect(it);
      if (window.innerWidth <= 900) rightEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (cfg.collect) {
      hlSync();
      window.addEventListener(HL_EVT, () => leftEl.querySelectorAll("[data-collect]").forEach(c => c.classList.toggle("on", isCollected(c.dataset.collect))));
    }
    leftEl.addEventListener("click", e => {
      const col = e.target.closest("[data-collect]");
      if (col) {
        e.stopPropagation();
        const it = items.find(x => x.id === col.dataset.collect);
        if (it) col.classList.toggle("on", toggleCollected(it, cfg.collect));
        return;
      }
      const nav = e.target.closest("[data-nav]");
      if (nav) {
        calM += parseInt(nav.dataset.nav, 10);
        if (calM < 0) { calM = 11; calY--; } else if (calM > 11) { calM = 0; calY++; }
        renderLeft();
        return;
      }
      const node = e.target.closest("[data-id]");
      if (node) selectItem(node.dataset.id);
    });
    leftEl.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const node = e.target.closest(".rv-row[data-id]");
      if (node) { e.preventDefault(); selectItem(node.dataset.id); }
    });
    root.querySelectorAll(".rv-tab").forEach(tab => tab.addEventListener("click", () => {
      view = tab.dataset.view;
      root.querySelectorAll(".rv-tab").forEach(t => t.classList.toggle("active", t === tab));
      if (view === "calendar") setDefaultCalMonth();
      renderLeft();
    }));
    const onFilterChange = () => { if (view === "calendar") setDefaultCalMonth(); renderLeft(); };
    filters.forEach(x => sel(x.key).addEventListener("change", () => { f[x.key] = sel(x.key).value; onFilterChange(); }));
    if (cfg.search) {
      let qTimer = null;
      sel("q").addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.q = sel("q").value.trim(); onFilterChange(); }, 180); });
      sel("clear").addEventListener("click", () => {
        f.q = ""; sel("q").value = "";
        filters.forEach(x => { f[x.key] = "__all__"; sel(x.key).value = "__all__"; });
        onFilterChange();
      });
    }
    if (cfg.digest) sel("digest").addEventListener("click", e => {
      const tk = e.target.closest("[data-tk]");
      if (tk) { f.ticker = tk.dataset.tk; sel("ticker").value = f.ticker; onFilterChange(); }
    });

    // Fill the selects
    filters.forEach(x => {
      let vals = [...new Set(items.flatMap(it => x.values(it) || []).filter(Boolean))];
      if (x.order === "desc") vals.sort().reverse();
      else if (x.sort) vals.sort(x.sort);
      else vals.sort();
      sel(x.key).innerHTML = [`<option value="__all__">全部</option>`,
        ...vals.map(v => `<option value="${esc(v)}">${esc(x.labelOf ? x.labelOf(v) : v)}</option>`)].join("");
    });

    setDefaultCalMonth();
    rightEl.innerHTML = emptyRight();
    renderLeft();
    // Deep link: show everything, open item `id` (or filter by ticker), scroll its row into view.
    function focus({ item, ticker }) {
      if (item && items.some(x => x.id === item)) {
        filters.forEach(x => { f[x.key] = "__all__"; sel(x.key).value = "__all__"; });
        f.q = ""; if (sel("q")) sel("q").value = "";
        if (view === "calendar") setDefaultCalMonth();
        renderLeft();
        selectItem(item);
        const row = leftEl.querySelector(`[data-id="${CSS.escape(item)}"]`);
        if (row && window.innerWidth > 900) row.scrollIntoView({ block: "center" });
      } else if (ticker && items.some(x => (cfg.tickersOf(x) || []).includes(ticker))) {
        f.ticker = ticker; sel("ticker").value = ticker; onFilterChange();
      }
    }
    return { selectItem, focus };
  }


  /* ---------------- 重點新聞 page (as highlight.js on hgvf.github.io) ---------------- */
  const WORKER = "https://yf-proxy.peter94135.workers.dev/?url=";
  const PRICE_KEY = "hl_price_series_v1";
  const RANGES = [{ v: "1mo", label: "1 個月" }, { v: "6mo", label: "6 個月" }, { v: "1y", label: "1 年" }];
  const readPrices = () => { try { return JSON.parse(localStorage.getItem(PRICE_KEY) || "{}") || {}; } catch (e) { return {}; } };
  const writePrices = o => { try { localStorage.setItem(PRICE_KEY, JSON.stringify(o)); } catch (e) { /* quota */ } };
  const hlSource = it => (it && it._source) || "supply-chain";
  const hlDate = it => (it && (it.date || it.event_date)) || "";
  const hlHeadline = it => (it && (it.headline || it.title_zh || it.title_original || it.id)) || "";
  const trendSymbols = it => (Array.isArray(it._trend_tickers) ? it._trend_tickers : [...(it.tickers || [])]);

  // Daily closes for up to 20 symbols per request (Yahoo spark via the Cloudflare Worker).
  async function fetchSeries(symbols, range) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 20) {
      const batch = symbols.slice(i, i + 20);
      const u = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(batch.join(","))}&range=${range}&interval=1d`;
      const r = await fetch(WORKER + encodeURIComponent(u), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      for (const s of batch) {
        const e = j && j[s];
        if (!e || !e.timestamp || !e.close) continue;
        const series = e.timestamp.map((t, k) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: e.close[k] }))
          .filter(p => p.close != null && isFinite(p.close));
        if (series.length) out[s] = { series };
      }
    }
    return out;
  }

  function trendCard(sym, entry) {
    const name = (window.siteTickerName && window.siteTickerName(sym)) || "";
    const head = `<div class="hl-trend-head">
        <a class="hl-trend-sym" href="${esc(chartUrl(sym))}" target="_blank" rel="noopener">${esc(sym)}</a>
        ${name ? `<span class="hl-trend-name">${esc(name)}</span>` : ""}
        <button class="hl-trend-remove" data-remove-ticker="${esc(sym)}" type="button" title="從走勢圖移除此 ticker" aria-label="移除此 ticker">✕</button>
      </div>`;
    const series = (entry && entry.series) || [];
    if (series.length < 2) return `<div class="hl-trend-card empty">${head}<div class="hl-trend-empty">尚無股價資料 — 按「更新全部股價」載入</div></div>`;
    const closes = series.map(p => p.close);
    const first = closes[0], last = closes[closes.length - 1];
    const chg = first ? (last - first) / first * 100 : 0;
    const cls = chg > 0 ? "pos" : chg < 0 ? "neg" : "neu";
    const W = 240, H = 76, pad = 4, lo = Math.min(...closes), hi = Math.max(...closes), span = (hi - lo) || 1;
    const xx = i => pad + (i / (series.length - 1)) * (W - pad * 2);
    const yy = c => pad + (1 - (c - lo) / span) * (H - pad * 2);
    const pts = series.map((p, i) => `${xx(i).toFixed(1)},${yy(p.close).toFixed(1)}`).join(" ");
    const fmtN = v => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `<div class="hl-trend-card">${head}
      <div class="hl-trend-num"><span class="hl-trend-last">${fmtN(last)}</span><span class="hl-trend-chg ${cls}">${chg > 0 ? "+" : ""}${chg.toFixed(2)}%</span></div>
      <div class="hl-trend-chart"><svg viewBox="0 0 ${W} ${H}" class="hl-spark ${cls}" preserveAspectRatio="none">
        <polygon class="hl-spark-area" points="${xx(0).toFixed(1)},${H - pad} ${pts} ${xx(series.length - 1).toFixed(1)},${H - pad}"/>
        <polyline class="hl-spark-line" points="${pts}"/></svg></div>
      <div class="hl-trend-period">${esc(series[0].date)} → ${esc(series[series.length - 1].date)}</div></div>`;
  }

  function mountHighlights(root) {
    hlSync();
    let range = "6mo", selectedId = null, sourceFilter = "__all__";
    root.innerHTML = `
      <div class="hl-bar">
        <label class="hl-ctl">來源 <span class="rv-sel-wrap"><select class="rv-select" data-role="hl-source"></select></span></label>
        <label class="hl-ctl">選新聞 <span class="rv-sel-wrap"><select class="rv-select" data-role="hl-news"></select></span></label>
        <label class="hl-ctl">區間 <span class="rv-sel-wrap"><select class="rv-select" data-role="hl-range">${RANGES.map(r => `<option value="${r.v}">${r.label}</option>`).join("")}</select></span></label>
        <button class="hl-btn" data-role="hl-update" type="button" title="更新所有收藏新聞的相關個股股價">↻ 更新全部股價</button>
        <button class="hl-btn hl-btn-ghost" data-role="hl-remove" type="button" title="從重點移除">移除此則</button>
        <span class="hl-status" data-role="hl-status"></span>
      </div>
      <div class="hl-body" data-role="hl-body"></div>`;
    const q = r => root.querySelector(`[data-role="${r}"]`);
    const sourceSel = q("hl-source"), newsSel = q("hl-news"), rangeSel = q("hl-range");
    const updateBtn = q("hl-update"), removeBtn = q("hl-remove"), statusEl = q("hl-status"), bodyEl = q("hl-body");
    rangeSel.value = range;
    const setStatus = (msg, kind = "") => { statusEl.textContent = msg || ""; statusEl.className = `hl-status ${kind}`; };
    const collected = () => (sourceFilter === "__all__" ? hlCache : hlCache.filter(it => hlSource(it) === sourceFilter));
    const current = () => collected().find(it => it.id === selectedId) || null;

    function rebuildSelects() {
      const counts = {};
      hlCache.forEach(it => { counts[hlSource(it)] = (counts[hlSource(it)] || 0) + 1; });
      sourceSel.innerHTML = [`<option value="__all__">全部來源（${hlCache.length}）</option>`,
        ...Object.keys(SOURCE_LABEL).filter(s => counts[s]).map(s => `<option value="${s}">${SOURCE_LABEL[s]}（${counts[s]}）</option>`)].join("");
      if (![...sourceSel.options].some(o => o.value === sourceFilter)) sourceFilter = "__all__";
      sourceSel.value = sourceFilter;
      const items = collected();
      if (!items.length) {
        newsSel.innerHTML = `<option value="">（尚未收藏任何新聞）</option>`;
        newsSel.disabled = true; selectedId = null;
        return;
      }
      newsSel.disabled = false;
      newsSel.innerHTML = items.map(it => {
        const tag = sourceFilter === "__all__" ? `[${SOURCE_LABEL[hlSource(it)] || hlSource(it)}] ` : "";
        return `<option value="${esc(it.id)}">${esc(tag)}${esc(fmtDate(hlDate(it)))} · ${esc(hlHeadline(it))}</option>`;
      }).join("");
      if (!selectedId || !items.some(it => it.id === selectedId)) selectedId = items[0].id;
      newsSel.value = selectedId;
    }

    function renderBody() {
      const it = current();
      if (!it) {
        bodyEl.innerHTML = `<div class="hl-empty">在「供應鏈瓶頸新聞」或「產業消息」的時間軸上，按每則新聞右邊的 <span class="hl-bookmark-inline">🔖</span> 收藏，就會出現在這裡。</div>`;
        removeBtn.disabled = true; updateBtn.disabled = true;
        return;
      }
      removeBtn.disabled = false; updateBtn.disabled = false;
      const src = hlSource(it);
      const detail = src === "industry-news" ? inDetail(it) : scDetail(it);
      const cache = readPrices();
      const syms = trendSymbols(it);
      bodyEl.innerHTML = `
        <div class="hl-card"><div class="hl-source-badge hl-src-${esc(src)}">來源：${esc(SOURCE_LABEL[src] || src)}</div>${detail}</div>
        <div class="hl-trends-wrap">
          <div class="hl-trends-head">股價走勢 <span class="hl-muted">(${esc(range)})</span></div>
          <div class="hl-trend-add">
            <input class="hl-trend-add-input" data-role="hl-add-input" type="text" placeholder="新增 ticker（如 TSLA、2330.TW）" spellcheck="false" autocapitalize="characters" aria-label="新增 ticker" />
            <button class="hl-trend-add-btn" data-role="hl-add-btn" type="button" title="加入走勢圖">＋ 新增</button>
          </div>
          <div class="hl-trends">${syms.length
            ? syms.map(s => trendCard(s, cache[s] && cache[s].range === range ? cache[s] : null)).join("")
            : `<div class="hl-trend-empty hl-trend-none">此新聞沒有走勢圖 ticker，於上方輸入框新增。</div>`}</div>
        </div>`;
      // Load missing charts for the item on screen without waiting for the button.
      const missing = syms.filter(s => !(cache[s] && cache[s].range === range));
      if (missing.length) loadInto(missing).then(n => { if (n && current() === it) renderBody(); });
    }

    async function loadInto(syms) {
      try {
        const data = await fetchSeries(syms, range);
        const cache = readPrices(), now = Date.now();
        let n = 0;
        for (const s of syms) if (data[s]) { cache[s] = { ...data[s], range, fetched_at: now }; n++; }
        writePrices(cache);
        return n;
      } catch (e) { return 0; }
    }

    async function updatePrices() {
      const syms = [...new Set(hlCache.flatMap(trendSymbols))];
      if (!syms.length) { setStatus("收藏的新聞都沒有相關股票代號", "warn"); return; }
      updateBtn.disabled = true;
      setStatus(`更新中… (${syms.length} 檔)`);
      const n = await loadInto(syms);
      updateBtn.disabled = false;
      renderBody();
      setStatus(n ? `已更新 ${n}/${syms.length} 檔 · ${new Date().toLocaleTimeString("en-GB")}` : "查無股價資料（來源可能暫時無回應）", n ? "ok" : "warn");
    }

    async function addTicker() {
      const it = current();
      const input = bodyEl.querySelector('[data-role="hl-add-input"]');
      const v = ((input && input.value) || "").trim().toUpperCase();
      if (!it || !v) return;
      const list = trendSymbols(it);
      if (list.includes(v)) { setStatus(`${v} 已在走勢圖中`, "warn"); return; }
      setTrendTickers(it.id, [...list, v]);
      setStatus(`載入 ${v} …`);
      const ok = await loadInto([v]);
      renderBody();
      setStatus(ok ? `已新增 ${v}` : `已新增 ${v}（查無股價）`, ok ? "ok" : "warn");
    }

    bodyEl.addEventListener("click", e => {
      const rm = e.target.closest("[data-remove-ticker]");
      if (rm) {
        const it = current();
        if (it) { setTrendTickers(it.id, trendSymbols(it).filter(s => s !== rm.dataset.removeTicker)); setStatus(`已移除 ${rm.dataset.removeTicker}`, "ok"); }
        return;
      }
      if (e.target.closest('[data-role="hl-add-btn"]')) addTicker();
    });
    bodyEl.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.target.closest('[data-role="hl-add-input"]')) { e.preventDefault(); addTicker(); }
    });
    sourceSel.addEventListener("change", () => { sourceFilter = sourceSel.value; selectedId = null; rebuildSelects(); renderBody(); });
    newsSel.addEventListener("change", () => { selectedId = newsSel.value; renderBody(); });
    rangeSel.addEventListener("change", () => { range = rangeSel.value; renderBody(); });
    updateBtn.addEventListener("click", updatePrices);
    removeBtn.addEventListener("click", () => {
      const it = current();
      if (it) { toggleCollected(it, hlSource(it)); setStatus("已從重點移除", "ok"); }
    });
    const refresh = () => { rebuildSelects(); renderBody(); };
    window.addEventListener(HL_EVT, refresh);
    refresh();
    return {
      focus({ item }) {
        if (!item || !hlCache.some(x => x.id === item)) return;
        sourceFilter = "__all__"; selectedId = item; refresh();
      },
    };
  }

  /* ---------------- pages ---------------- */
  const sentDot = v => sent(v).cls;
  const PAGES = {
    highlights: { custom: true, mount: root => mountHighlights(root) },
    supply: {
      file: "supply-chain",
      mount(root, items) {
        return mountView(root, items, {
          dateOf: it => it.date,
          tickersOf: it => it.tickers || [],
          nodeTitle: it => it.headline || "",
          dotClass: it => sentDot(it.sentiment),
          chipOf: it => (it.tickers || [])[0] || "•",
          renderDetail: scDetail,
          collect: "supply-chain",
        });
      },
    },
    industry: {
      file: "industry",
      mount(root, items) {
        return mountView(root, items, {
          dateOf: it => it.event_date,
          tickersOf: it => it.tickers || [],
          nodeTitle: it => it.title_zh || it.title_original || it.id,
          dotClass: it => tierClass(it.importance_tier),
          chipOf: it => (it.tickers && it.tickers[0]) || eventTypeLabel(it.event_type).slice(0, 2),
          renderDetail: inDetail,
          collect: "industry-news",
          emptyHint: "點選左側事件節點，內容會顯示在這裡",
          search: it => [...(it.search_keywords || []), ...(it.tickers || []), it.title_zh, it.title_original, it.summary_zh,
            ...((it.companies || []).map(c => c.name))].filter(Boolean).join(" "),
          filters: [
            { key: "type", label: "事件類型", values: it => [it.event_type], labelOf: eventTypeLabel,
              sort: (a, b) => eventTypeLabel(a).localeCompare(eventTypeLabel(b)) },
            { key: "theme", label: "題材", values: it => it.themes || [] },
            { key: "region", label: "地區", values: it => it.regions || [] },
            { key: "tier", label: "重要性", values: it => [it.importance_tier], labelOf: t => TIER_LABEL[t] || t,
              sort: (a, b) => (TIER_ORDER[a] ?? 9) - (TIER_ORDER[b] ?? 9) },
            { key: "evi", label: "證據", values: it => [it.evidence_level], labelOf: v => EVIDENCE_LABEL[v] || v },
          ],
          digest(list) {
            const tiers = { critical: 0, high: 0, relevant: 0 }, tk = {};
            list.forEach(it => {
              if (tiers[it.importance_tier] != null) tiers[it.importance_tier]++;
              (it.tickers || []).forEach(t => { tk[t] = (tk[t] || 0) + 1; });
            });
            const top = Object.entries(tk).sort((a, b) => b[1] - a[1]).slice(0, 6);
            const pill = k => (tiers[k] ? `<span class="in-dg-pill ${TIER_CLASS[k]}">${TIER_LABEL[k].split(" ")[0]} ${tiers[k]}</span>` : "");
            return `<span class="in-dg-lbl">事件</span><span class="in-dg-count">${list.length}</span>${pill("critical")}${pill("high")}${pill("relevant")}`
              + (top.length ? `<span class="in-dg-sep">·</span><span class="in-dg-lbl">熱門</span>${top.map(([t, n]) => `<button class="in-dg-tk" data-tk="${esc(t)}" type="button" title="篩選 ${esc(t)}">${esc(t)}<span>${n}</span></button>`).join("")}` : "");
          },
        });
      },
    },
    earnings: {
      file: "earnings",
      mount(root, items) {
        const cmpWrap = document.createElement("div");
        root.innerHTML = "";
        const viewRoot = document.createElement("div");
        root.append(viewRoot, cmpWrap);
        const tickers = [...new Set(items.map(c => c.ticker).filter(Boolean))].sort();
        cmpWrap.innerHTML = tickers.length ? `<section class="ec-compare">
            <div class="ec-compare-head"><h3 class="ec-compare-title">近四季比較</h3>
              <label class="rv-ctl">公司 <span class="rv-sel-wrap"><select class="rv-select" data-role="cmp">${tickers.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select></span></label></div>
            <div class="ec-compare-row" data-role="cmprow"></div></section>` : "";
        const cmpSel = cmpWrap.querySelector('[data-role="cmp"]');
        function renderCompare(t) {
          if (!cmpSel) return;
          cmpSel.value = t;
          const calls = items.filter(c => c.ticker === t)
            .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 4).reverse();
          cmpWrap.querySelector('[data-role="cmprow"]').innerHTML = calls.map(cmpCard).join(`<span class="ec-cmp-arrow">→</span>`);
        }
        if (cmpSel) { cmpSel.addEventListener("change", () => renderCompare(cmpSel.value)); renderCompare(items[0] ? items[0].ticker : tickers[0]); }
        return mountView(viewRoot, items, {
          dateOf: it => it.date,
          tickersOf: it => (it.ticker ? [it.ticker] : []),
          nodeTitle: it => `${it.ticker} ${it.company || ""} · ${it.year} ${it.quarter}`,
          dotClass: it => sentDot(overall(it)),
          chipOf: it => it.ticker || "•",
          renderDetail: ecDetail,
          onSelect: it => renderCompare(it.ticker),
        });
      },
    },
  };

  const started = {}, views = {};
  async function start(page) {
    const p = PAGES[page];
    if (!p || started[page]) return;
    started[page] = true;
    const root = document.getElementById("news-" + page);
    const upd = document.getElementById("news-" + page + "-updated");
    if (p.custom) {
      views[page] = p.mount(root);
      views[page].focus(deepLink());
      return;
    }
    root.innerHTML = `<div class="rv-empty">Loading…</div>`;
    try {
      const { updated, items } = await loadItems(p.file);
      if (upd) upd.textContent = updated ? `更新：${new Date(updated).toLocaleString("zh-TW", { hour12: false })}` : "尚無資料";
      views[page] = p.mount(root, items);
      if (views[page]) views[page].focus(deepLink());
    } catch (e) {
      started[page] = false;
      root.innerHTML = `<div class="rv-empty">載入失敗，請稍後再試。（${esc(e.message)}）</div>`;
    }
  }

  document.addEventListener("pagechange", e => {
    if (views[e.detail]) views[e.detail].focus(deepLink());   // already mounted: just follow the link
    else start(e.detail);
  });
  start(location.hash.slice(1).split("&")[0]);
})();
