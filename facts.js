/* 事實追蹤 store — facts.js from hgvf.github.io, copied with the owner's permission.
 * Tracked facts / watch points bookmarked (★) on 財報電話會議分析 and 產業情報站. Changes: classic
 * script; one Firestore doc dashboards/facts ({ facts: { <id>: fact } }, public read), mirrored in
 * localStorage; only the site owner's saved Google session writes (no sign-in UI). */
(function () {
"use strict";
const STATES = {
  pending:     { label: "待驗證", cls: "pending",  open: true  },
  not_started: { label: "尚未開始", cls: "notstart", open: true  },
  on_track:    { label: "進展符合", cls: "ontrack",  open: true  },
  behind:      { label: "落後預期", cls: "behind",   open: true  },
  verified:    { label: "已驗證", cls: "verified",  open: false },
  invalidated: { label: "已失效", cls: "invalid",   open: false },
};
const STATE_ORDER = ["pending", "not_started", "on_track", "behind", "verified", "invalidated"];
function stateInfo(s) { return STATES[s] || STATES.pending; }
function isOpenState(s) { return stateInfo(s).open; }

const CONFIDENCE = {
  high:   { label: "高", cls: "high" },
  medium: { label: "中", cls: "medium" },
  low:    { label: "低", cls: "low" },
};
function confInfo(c) { return CONFIDENCE[c] || CONFIDENCE.medium; }

// ─── ids ───────────────────────────────────────────────────────────────
function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
// Stable 32-bit hash so the SAME highlight always maps to the same doc id —
// bookmarking then un-bookmarking toggles one row instead of piling up dupes.
function hash(str) {
  let h = 5381;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function factId(ticker, kind, text) {
  return `${slug(ticker) || "x"}-${kind === "watch" ? "w" : "f"}-${hash(text)}`;
}
function docId(id) { return String(id).replace(/\//g, "_").slice(0, 1500); }

// ─── localStorage mirror + Firestore doc dashboards/facts ─────────────────
const FACTS_DOC = "dashboards/facts";
const KEY = "facts_v1";
const EVT = "facts-change";
const OWNER_UIDS = ["JN5nkZ6t8TcEc6AJNvnISvdWKDt1", "arxW8uOFEQTwBb8o3XKkOnsGu5H3"];
function currentUser() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
const isOwner = u => !!(u && OWNER_UIDS.includes(u.uid));
const canWrite = () => isOwner(currentUser());
function docId(id) { return String(id).replace(/[/.~*[\]]/g, "_").slice(0, 1400); }
function readLocal() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function writeLocal(arr) { try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) { /* quota */ } }
let _cache = readLocal(), _cloudIds = new Set(), ref = null, synced = false;
function sortCache() {
  _cache.sort((x, y) => String(y.updated_at || "").localeCompare(String(x.updated_at || "")));
}
function broadcast() { writeLocal(_cache); window.dispatchEvent(new CustomEvent(EVT, { detail: { items: _cache } })); }
function writeCloud(fact) {
  if (!ref || !canWrite()) return Promise.resolve();
  return ref.set({ facts: { [docId(fact.id)]: fact } }, { merge: true });
}
function deleteCloud(id) {
  if (!ref || !canWrite() || !_cloudIds.has(id)) return Promise.resolve();
  return ref.update(new firebase.firestore.FieldPath("facts", docId(id)), firebase.firestore.FieldValue.delete());
}
function sync() {
  if (synced) return;
  const db = window.siteFirestore && window.siteFirestore();
  if (!db) return;
  synced = true;
  ref = db.doc(FACTS_DOC);
  ref.onSnapshot(snap => {
    const cloud = Object.values((snap.exists && snap.data().facts) || {}).map(x => ({ ...x, _cloud: true }));
    _cloudIds = new Set(cloud.map(x => x.id));
    // Items that came from the cloud carry _cloud; if one is gone from the cloud it was deleted elsewhere,
    // so drop it. Only items never synced (no _cloud) stay as local-only drafts.
    const localOnly = _cache.filter(x => !_cloudIds.has(x.id) && !x._cloud);
    _cache = [...cloud, ...localOnly];
    sortCache();
    broadcast();
    localOnly.forEach(x => writeCloud(x).catch(() => {}));
  }, e => console.warn("facts sync failed:", e.message));
  try {
    firebase.auth().onAuthStateChanged(u => {
      if (isOwner(u)) _cache.filter(x => !_cloudIds.has(x.id) && !x._cloud).forEach(x => writeCloud(x).catch(() => {}));
      window.dispatchEvent(new CustomEvent(EVT, { detail: { items: _cache } }));
    });
  } catch (e) { /* auth SDK missing */ }
}

function nowISO() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

function normFact(f) {
  const state = STATES[f.state] ? f.state : "pending";
  return {
    id: f.id,
    ticker: String(f.ticker || "").trim(),
    company: String(f.company || "").trim(),
    title: String(f.title || "").trim(),
    thesis: String(f.thesis || "").trim(),
    kind: f.kind === "watch" ? "watch" : "fact",
    state,
    confidence: CONFIDENCE[f.confidence] ? f.confidence : "medium",
    source: f.source && typeof f.source === "object" ? {
      // `origin` distinguishes where a tracked fact was collected from:
      // "earnings" (default, from a 法說會 highlight) or "intel" (from the
      // 產業情報站). `label`/`url` carry the intel provenance so the fact page
      // can show the right back-link instead of always pointing at 財報分析.
      origin: String(f.source.origin || ""),
      quarter: String(f.source.quarter || ""),
      label: String(f.source.label || ""),
      url: String(f.source.url || ""),
      note_id: String(f.source.note_id || ""),
      date: String(f.source.date || ""),
      sentiment: String(f.source.sentiment || ""),
    } : null,
    checklist: Array.isArray(f.checklist)
      ? f.checklist.filter(c => c && c.text).map(c => ({ text: String(c.text), done: !!c.done }))
      : [],
    updates: Array.isArray(f.updates)
      ? f.updates.filter(u => u && (u.text || u.state)).map(u => ({
          at: u.at || nowISO(),
          date: u.date || (u.at ? String(u.at).slice(0, 10) : today()),
          text: String(u.text || ""),
          state: STATES[u.state] ? u.state : null,
        }))
      : [],
    next_check: f.next_check ? String(f.next_check).slice(0, 10) : "",
    base_date: f.base_date ? String(f.base_date).slice(0, 10) : (f.source && f.source.date ? String(f.source.date).slice(0, 10) : today()),
    created_at: f.created_at || nowISO(),
    updated_at: nowISO(),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────
function getFacts() { return _cache.slice(); }
function getFact(id) { return _cache.find(f => f.id === id) || null; }
function getFactsByTicker(ticker) {
  const t = String(ticker || "").trim();
  return _cache.filter(f => f.ticker === t);
}
function isFactTracked(id) { return _cache.some(f => f.id === id); }
function hasFactsForTicker(ticker) {
  const t = String(ticker || "").trim();
  return !!t && _cache.some(f => f.ticker === t);
}

// Create or overwrite a fact from a seed object. Returns the stored fact.
function saveFact(seed) {
  const existing = seed.id ? getFact(seed.id) : null;
  const merged = { ...(existing || {}), ...seed };
  if (!merged.id) merged.id = factId(merged.ticker, merged.kind, merged.title);
  if (existing) merged.created_at = existing.created_at;
  const fact = normFact(merged);
  _cache = [fact, ..._cache.filter(f => f.id !== fact.id)];
  sortCache();
  broadcast();
  writeCloud(fact).catch(e => console.warn("fact save failed:", e.message));
  return fact;
}

// Shallow patch of an existing fact (state, checklist, next_check, …).
function patchFact(id, patch) {
  const cur = getFact(id);
  if (!cur) return null;
  return saveFact({ ...cur, ...patch, id });
}

function removeFact(id) {
  _cache = _cache.filter(f => f.id !== id);
  broadcast();
  deleteCloud(id).catch(e => console.warn("fact remove failed:", e.message));
  return _cache.slice();
}

// Append a progress update (and optionally advance the fact's state).
function addUpdate(id, { text, date, state } = {}) {
  const cur = getFact(id);
  if (!cur) return null;
  const upd = {
    at: nowISO(),
    date: date || today(),
    text: String(text || ""),
    state: STATES[state] ? state : null,
  };
  const patch = { updates: [upd, ...(cur.updates || [])] };
  if (upd.state) patch.state = upd.state;
  return saveFact({ ...cur, ...patch, id });
}

function removeUpdate(id, at) {
  const cur = getFact(id);
  if (!cur) return null;
  return saveFact({ ...cur, updates: (cur.updates || []).filter(u => u.at !== at), id });
}

// Toggle a bookmark from an earnings highlight / watch point. `seed` needs at
// least { ticker, kind, title }. Returns true if now tracked, false if removed.
function toggleFactBookmark(seed) {
  if (!seed || !seed.title || !seed.ticker) return false;
  const id = factId(seed.ticker, seed.kind, seed.title);
  if (isFactTracked(id)) { removeFact(id); return false; }
  saveFact({ ...seed, id, state: "pending" });
  return true;
}

// Move tracked facts from one ticker to another (e.g. after an earnings call's
// ticker is corrected). `filter(fact)` narrows which facts move. A fact whose id
// changes with the ticker is re-saved under the new id and the old doc removed,
// so its bookmark star still lights up on the corrected card.
function renameFactsTicker(oldTicker, newTicker, { company, filter } = {}) {
  const from = String(oldTicker || "").trim(), to = String(newTicker || "").trim();
  if (!from || !to || from === to) return 0;
  const moving = _cache.filter(f => f.ticker === from && (!filter || filter(f)));
  for (const f of moving) {
    const id = f.source && f.source.origin === "intel" ? f.id : factId(to, f.kind, f.title);
    const next = { ...f, id, ticker: to };
    if (company) next.company = company;
    if (id !== f.id) removeFact(f.id);
    saveFact(next);
  }
  return moving.length;
}

function onFactsChange(cb) {
  const h = e => cb(e.detail ? e.detail.items : getFacts());
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

window.factsStore = { sync, canWrite, STATES, STATE_ORDER, stateInfo, isOpenState, CONFIDENCE, confInfo, factId, getFacts, getFact, getFactsByTicker, isFactTracked, hasFactsForTicker, saveFact, patchFact, removeFact, addUpdate, removeUpdate, toggleFactBookmark, renameFactsTicker, onFactsChange };
})();
