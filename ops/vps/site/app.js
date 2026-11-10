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

// A link to a FAQ answer (#adb) opens it.
function openHashedDetails() {
  const id = (location.hash || "").slice(1);
  if (!id) return;
  const el = document.getElementById(id);
  if (el && el.tagName === "DETAILS") el.open = true;
}
openHashedDetails();
window.addEventListener("hashchange", openHashedDetails);

const menuBtn = document.getElementById("nav-toggle");
const nav = document.getElementById("site-nav");
if (menuBtn && nav) {
  menuBtn.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      menuBtn.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    nav.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
  });
}
