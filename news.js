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

  async function loadItems(file) {
    const bucket = Math.floor(Date.now() / 600000);   // 10-min cache buckets
    const r = await fetch(`${DATA_BASE}${file}.json?t=${bucket}`, { cache: "no-store" });
    if (r.status === 404) return { updated: null, items: [] };
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    return { updated: j.updated || null, items: Array.isArray(j.items) ? j.items : [] };
  }

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
            <span class="rv-row-title">${esc(cfg.nodeTitle(it))}</span></div>`).join("");
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

    leftEl.addEventListener("click", e => {
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
    return { selectItem };
  }

  /* ---------------- pages ---------------- */
  const sentDot = v => sent(v).cls;
  const PAGES = {
    supply: {
      file: "supply-chain",
      mount(root, items) {
        mountView(root, items, {
          dateOf: it => it.date,
          tickersOf: it => it.tickers || [],
          nodeTitle: it => it.headline || "",
          dotClass: it => sentDot(it.sentiment),
          chipOf: it => (it.tickers || [])[0] || "•",
          renderDetail: scDetail,
        });
      },
    },
    industry: {
      file: "industry",
      mount(root, items) {
        mountView(root, items, {
          dateOf: it => it.event_date,
          tickersOf: it => it.tickers || [],
          nodeTitle: it => it.title_zh || it.title_original || it.id,
          dotClass: it => tierClass(it.importance_tier),
          chipOf: it => (it.tickers && it.tickers[0]) || eventTypeLabel(it.event_type).slice(0, 2),
          renderDetail: inDetail,
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
        mountView(viewRoot, items, {
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

  const started = {};
  async function start(page) {
    const p = PAGES[page];
    if (!p || started[page]) return;
    started[page] = true;
    const root = document.getElementById("news-" + page);
    const upd = document.getElementById("news-" + page + "-updated");
    root.innerHTML = `<div class="rv-empty">Loading…</div>`;
    try {
      const { updated, items } = await loadItems(p.file);
      items.forEach((it, i) => { if (!it.id) it.id = `${p.file}-${i}`; });
      if (upd) upd.textContent = updated ? `更新：${new Date(updated).toLocaleString("zh-TW", { hour12: false })}` : "尚無資料";
      p.mount(root, items);
    } catch (e) {
      started[page] = false;
      root.innerHTML = `<div class="rv-empty">載入失敗，請稍後再試。（${esc(e.message)}）</div>`;
    }
  }

  document.addEventListener("pagechange", e => start(e.detail));
  start(location.hash.slice(1));
})();
