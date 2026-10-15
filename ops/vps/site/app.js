const screens = ["remote", "catalog", "discover", "playing"];
const labels = {
  remote: "Пульт OMP на телефоне",
  catalog: "Каталог OMP на телефоне",
  discover: "Обзор новинок OMP",
  playing: "Экран «Сейчас играет» в OMP",
};
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
  img.src = `assets/${name}.webp`;
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

function choose(name) {
  if (!screens.includes(name) || !screen) return;

  screen.src = `assets/${name}.webp`;
  screen.alt = labels[name];

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
    play.setAttribute(
      "aria-label",
      demoPaused ? "Продолжить демо" : "Приостановить демо",
    );
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
