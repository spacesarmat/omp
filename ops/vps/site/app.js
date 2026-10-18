const OMP_LANG_KEY = "omp-lang";

function decideLangRedirect(state) {
  const choice = state.choice;
  if (choice === "ru" || choice === "en") return null;
  let path = state.pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path !== "/" && path !== "/index.html") return null;
  const primary = String(state.language || "")
    .toLowerCase()
    .split(/[-_]/)[0];
  if (primary === "ru" || primary === "uk" || primary === "be" || primary === "kk") return null;
  return "/en/" + (state.search || "") + (state.hash || "");
}
// end decideLangRedirect

function readLangChoice() {
  try {
    return localStorage.getItem(OMP_LANG_KEY);
  } catch {
    return null;
  }
}

function rememberLang(lang) {
  try {
    localStorage.setItem(OMP_LANG_KEY, lang);
  } catch {
    /* private mode */
  }
}

function primaryLanguage() {
  const list = navigator.languages;
  if (list && list.length) return list[0];
  return navigator.language || "";
}

function redirectIfNeeded() {
  const target = decideLangRedirect({
    choice: readLangChoice(),
    pathname: location.pathname,
    language: primaryLanguage(),
    hash: location.hash,
    search: location.search,
  });
  if (!target) return;
  const here = location.pathname + location.search + location.hash;
  if (target === here) return;
  location.replace(target);
}

function syncLangLinks() {
  const hash = location.hash || "";
  document.querySelectorAll("[data-lang-href]").forEach((a) => {
    const base = a.getAttribute("data-lang-href") || "/";
    a.setAttribute("href", base + hash);
  });
}

redirectIfNeeded();

document.querySelectorAll("[data-set-lang]").forEach((a) => {
  a.addEventListener("click", () => {
    const lang = a.getAttribute("data-set-lang");
    if (lang === "ru" || lang === "en") rememberLang(lang);
  });
});
syncLangLinks();
window.addEventListener("hashchange", syncLangLinks);

const screens = ["remote", "catalog", "discover", "playing"];
const tabs = [...document.querySelectorAll("[data-screen]")];
const dots = [...document.querySelectorAll("[data-dot]")];
const tabBar = document.querySelector(".screen-tabs");
const dotsBar = document.querySelector(".screen-dots");
const screen = document.getElementById("phone-screen");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Decode frames ahead of time so swaps never collapse layout.
screens.forEach((name) => {
  const img = new Image();
  img.decoding = "async";
  img.src = `/assets/${name}.webp`;
});

function scrollTabHorizontally(tab) {
  if (!tabBar || !tab) return;
  const left = tab.offsetLeft - (tabBar.clientWidth - tab.offsetWidth) / 2;
  tabBar.scrollTo({
    left: Math.max(0, left),
    behavior: "auto",
  });
}

function syncDots(name) {
  dots.forEach((d) => {
    const active = d.dataset.dot === name;
    d.classList.toggle("active", active);
    if (active) d.setAttribute("aria-current", "true");
    else d.removeAttribute("aria-current");
  });
  if (!dotsBar) return;
  // Static fill on active dot - no width animation restart that reflows.
  dotsBar.style.setProperty("--progress", "1");
}

function altFor(name) {
  const tab = tabs.find((t) => t.dataset.screen === name);
  return (tab && tab.dataset.alt) || "";
}

function choose(name) {
  if (!screens.includes(name) || !screen) return;

  screen.src = `/assets/${name}.webp`;
  const alt = altFor(name);
  if (alt) screen.alt = alt;

  let activeTab = null;
  tabs.forEach((t) => {
    const active = t.dataset.screen === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-pressed", String(active));
    if (active) activeTab = t;
  });
  if (activeTab) scrollTabHorizontally(activeTab);
  syncDots(name);

  const phonePlay = document.getElementById("phone-play");
  if (phonePlay) phonePlay.hidden = name !== "remote" && name !== "playing";
}

tabs.forEach((t) => t.addEventListener("click", () => choose(t.dataset.screen)));
dots.forEach((d) => d.addEventListener("click", () => choose(d.dataset.dot)));

document.querySelectorAll("[data-demo]").forEach((a) => {
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    choose(a.dataset.demo);
  });
});

let demoPaused = false;
function toggle() {
  demoPaused = !demoPaused;
  const pausedEl = document.querySelector(".paused");
  if (pausedEl) pausedEl.hidden = !demoPaused;
  const icon = document.getElementById("play-icon");
  if (icon) icon.textContent = demoPaused ? "▶" : "Ⅱ";
  const play = document.getElementById("play");
  if (play) {
    const pauseLabel = play.getAttribute("data-label-pause") || play.getAttribute("aria-label") || "";
    const resumeLabel = play.getAttribute("data-label-resume") || pauseLabel;
    play.setAttribute("aria-label", demoPaused ? resumeLabel : pauseLabel);
  }
}

const playBtn = document.getElementById("play");
const phonePlayBtn = document.getElementById("phone-play");
if (playBtn) playBtn.addEventListener("click", toggle);
if (phonePlayBtn) phonePlayBtn.addEventListener("click", toggle);

function initReveal() {
  const nodes = [...document.querySelectorAll("[data-reveal]")];
  if (!nodes.length) return;

  // Avoid scroll-anchoring fights: reveal with class only, no layout motion.
  if (reduceMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((el) => el.classList.add("is-in"));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.08, rootMargin: "40px 0px" },
  );
  nodes.forEach((el) => io.observe(el));
}

initReveal();
syncDots("remote");
