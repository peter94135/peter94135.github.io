// ===== Footer year =====
document.getElementById("year").textContent = new Date().getFullYear();

// ===== Theme toggle (light / dark), saved in localStorage =====
const root = document.documentElement;
const themeIcon = document.getElementById("themeIcon");
const themeLabel = document.getElementById("themeLabel");

function syncThemeButton() {
  const dark = root.getAttribute("data-theme") === "dark";
  themeIcon.textContent = dark ? "☀️" : "🌙";
  themeLabel.textContent = dark ? "Light mode" : "Dark mode";
}
document.getElementById("themeToggle").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  if (next === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  try { localStorage.setItem("theme", next); } catch (e) {}
  syncThemeButton();
});
syncThemeButton();

// ===== Page routing (hash-based, like a single-page app) =====
const PAGES = ["home", "experience", "publications", "awards", "watchlist", "strength", "supply", "industry", "intel", "highlights", "earnings", "annual", "defense"];

function showPage(id) {
  if (!PAGES.includes(id)) id = "home";
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + id));
  document.querySelectorAll(".nav-item[data-page]").forEach(n => n.classList.toggle("active", n.dataset.page === id));
  document.body.classList.remove("sidebar-open");
  if (!location.hash.includes("&")) window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent("pagechange", { detail: id }));
}
// "#supply&item=<id>" / "#industry&ticker=NVDA": the page id is the part before "&".
const pageFromHash = () => location.hash.slice(1).split("&")[0];
window.addEventListener("hashchange", () => showPage(pageFromHash()));
showPage(pageFromHash());

// ===== Sidebar folders (expand / collapse) =====
document.querySelectorAll(".nav-folder-header").forEach(h =>
  h.addEventListener("click", () => h.closest(".nav-folder").classList.toggle("open"))
);

// ===== Mobile sidebar =====
document.getElementById("sidebarOpen").addEventListener("click", () => document.body.classList.add("sidebar-open"));
document.getElementById("sidebarScrim").addEventListener("click", () => document.body.classList.remove("sidebar-open"));
