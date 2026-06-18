// Footer year
document.getElementById("year").textContent = new Date().getFullYear();

// Theme toggle with localStorage persistence
const toggle = document.getElementById("themeToggle");
const icon = toggle.querySelector(".theme-toggle__icon");
const root = document.documentElement;

function applyTheme(theme) {
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
    icon.textContent = "☀️";
  } else {
    root.removeAttribute("data-theme");
    icon.textContent = "🌙";
  }
}

// Initialize from saved preference or system setting
const saved = localStorage.getItem("theme");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
applyTheme(saved || (prefersDark ? "dark" : "light"));

toggle.addEventListener("click", () => {
  const isDark = root.getAttribute("data-theme") === "dark";
  const next = isDark ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("theme", next);
});
