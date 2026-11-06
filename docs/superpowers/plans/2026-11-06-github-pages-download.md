# GitHub Pages Download Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish small Russian and English download pages at `https://spacesarmat.github.io/omp/` and `https://spacesarmat.github.io/omp/en/` with current stable and beta downloads while preserving every update feed.

**Architecture:** Static HTML and CSS live in `ops/pages`. A dependency-free ES module reads the existing update feeds and replaces fallback release-page links with direct downloads. A copy helper and a dedicated workflow publish only page files, while a shared concurrency group serializes writes with the release workflow.

**Tech Stack:** HTML, CSS, browser ES modules, Node.js, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-06-github-pages-download-design.md`

## Global Constraints

- No new runtime or development dependencies, analytics, external fonts or third-party scripts.
- Russian and English page copy with visible language switching, correct `lang` and `hreflang`; use `-`, never long or medium dashes.
- Existing JSON and Homebrew files in `gh-pages` must survive publication.
- No force-push from the new page workflow and no merge without explicit user approval.
- Use relative text sizing, `clamp()`, visible keyboard focus and `meta name="text-scale" content="scale"`.

## Review Focus

- Feed request fails or returns incomplete data: keep the original release-page link and visible fallback text; covered by Task 1 tests.
- JavaScript is disabled: both language versions still offer working release-page links; covered by Task 2 tests and browser checks.
- Stable and beta feeds have different versions and ABI links: each button reads the correct feed; covered by Task 1 tests.
- Page publication races a release: both workflows share `gh-pages-publish` with `cancel-in-progress: false`; covered by Task 3 checks.
- Publication runs over an existing `gh-pages` clone: only `index.html`, `download.js` and `en/index.html` change, all other files remain; covered by Task 3 tests.
- Narrow viewport or enlarged text: cards reflow without clipping in both languages; covered by Task 2 browser verification at 360 px and 1280 px plus text scaling inspection.

---

### Task 1: Feed-driven download links

**Files:**
- Create: `ops/pages/download.js`
- Test: `tests/pages/download.test.ts`

**Interfaces:**
- Consumes: existing `update.json`, `update-android.json`, `update-beta.json`, `update-android-beta.json` fields `version`, `ipkUrl` and optional `apks.arm64.url`, `apks.armv7.url`.
- Produces: `updateDownloads(root: ParentNode, fetchImpl: typeof fetch): Promise<void>`; DOM selectors `data-download="stable-android|stable-webos|beta-android|beta-webos"`, `data-abi="arm64|armv7"` and `data-version="stable|beta"`.

- [ ] **Step 1: Write failing tests**

Use a small HTML fixture with fallback URLs and version labels. Mock four feeds with distinct literal versions and URLs. Assert direct stable and beta URLs, ABI URLs and version labels. Reject fetches in a second test and assert every original `href` and label remains unchanged. Include a feed without `apks` and assert its ABI fallback also remains.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pages/download.test.ts`
Expected: FAIL because `ops/pages/download.js` does not exist.

- [ ] **Step 3: Implement `updateDownloads`**

Fetch stable and beta feed pairs relative to the GitHub Pages root. Apply each successful response independently to its selectors. Do not replace a link or label when its feed or field is missing. Resolve after all four requests settle; individual failures do not reject the exported promise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pages/download.test.ts`
Expected: all Task 1 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ops/pages/download.js tests/pages/download.test.ts
git commit -m "[tech] Ссылки загрузки из update-фидов"
```

### Task 2: Static responsive pages in Russian and English

**Files:**
- Create: `ops/pages/index.html`
- Create: `ops/pages/en/index.html`
- Modify: `ops/pages/download.js`
- Test: `tests/pages/download.test.ts`

**Interfaces:**
- Consumes: `updateDownloads(root, fetchImpl)` from Task 1 and the selectors defined there.
- Produces: Russian entry point with `<script type="module" src="./download.js">`, English entry point with `<script type="module" src="../download.js">`; stable fallback `https://github.com/spacesarmat/omp/releases/latest`, beta fallback `https://github.com/spacesarmat/omp/releases`.

- [ ] **Step 1: Add failing page-contract tests**

Read both HTML files. Assert Russian and English copy, correct `lang`, reciprocal language-switch and `hreflang` links, stable and beta sections, all four download selectors, ABI fallbacks, links to `https://omp-player.online`, `https://github.com/spacesarmat/omp` and `https://github.com/spacesarmat/omp#установка`, module scripts with correct relative paths, viewport and text-scale meta tags. Assert no third-party script, external font or analytics URL.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pages/download.test.ts`
Expected: FAIL because both HTML files do not exist.

- [ ] **Step 3: Implement both pages and browser bootstrap**

Build compact Russian and English pages using the existing OMP dark background and yellow accent. Use semantic header, main, sections and footer, inline critical CSS, system fonts, responsive auto-fit cards and `clamp()` typography. Add reciprocal `/omp/` and `/omp/en/` language links with `hreflang` and `aria-current`. Keep all fallback links and labels from Task 1. At the end of `download.js`, call `updateDownloads(document, fetch)` only when `document` exists.

- [ ] **Step 4: Run unit tests and browser checks**

Run: `npx vitest run tests/pages/download.test.ts`
Expected: PASS.

Serve `ops/pages` over local HTTP. Check both languages at 360 px and 1280 px, language switching, direct-link substitution, keyboard focus, 200% text scaling and fallback pages with JavaScript disabled. No horizontal scrolling or clipped content is allowed.

- [ ] **Step 5: Commit**

```bash
git add ops/pages/index.html ops/pages/en/index.html ops/pages/download.js tests/pages/download.test.ts
git commit -m "[tech] Русская и английская страницы загрузки OMP"
```

### Task 3: Safe gh-pages publication

**Files:**
- Create: `scripts/publish-pages.mjs`
- Create: `.github/workflows/pages.yml`
- Modify: `.github/workflows/release.yml`
- Test: `tests/pages/publishPages.test.ts`

**Interfaces:**
- Consumes: `ops/pages/index.html`, `ops/pages/en/index.html` and `ops/pages/download.js` from Tasks 1 and 2.
- Produces: `copyDownloadPages(sourceDir: string, destinationDir: string): void`; both workflows use concurrency group `gh-pages-publish` with `cancel-in-progress: false`.

- [ ] **Step 1: Write failing publication tests**

Create temporary source and destination directories. Put all three page files in source and literal update/Homebrew fixtures plus an obsolete page file in destination. Call `copyDownloadPages`. Assert all page files match source, every unrelated file remains byte-identical and only the three declared page filenames are copied. Add a test that any missing page input fails before changing destination files.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pages/publishPages.test.ts`
Expected: FAIL because `scripts/publish-pages.mjs` does not exist.

- [ ] **Step 3: Implement the copy helper and workflows**

Validate all three inputs before copying only `index.html`, `download.js` and `en/index.html`. The CLI accepts source and destination arguments. `pages.yml` runs on relevant pushes to `main` and `workflow_dispatch`, clones `gh-pages`, calls the helper, commits only when the page changed and pushes without force. Add the same concurrency group to `release.yml`. Reuse the repository's pinned checkout actions and existing bot identity pattern.

- [ ] **Step 4: Verify publication behavior and CI configuration**

Run: `npx vitest run tests/pages/publishPages.test.ts tests/pages/download.test.ts`
Expected: PASS.

Run: `npx vitest run tests/pages && npm test`
Expected: all page tests and the standard Linux CI suite PASS. Separately inspect both workflow definitions for the shared concurrency group and confirm no new force-push exists.

- [ ] **Step 5: Commit**

```bash
git add scripts/publish-pages.mjs .github/workflows/pages.yml .github/workflows/release.yml tests/pages/publishPages.test.ts
git commit -m "[tech] Безопасная публикация страниц в gh-pages"
```

### Task 4: Whole-branch review and PR

**Files:**
- Review all branch changes.

- [ ] **Step 1: Run final verification**

Run the full standard test suite and both web builds. Review the diff against the spec, check both languages, forbidden dashes and confirm no unrelated files changed.

- [ ] **Step 2: Request review and create PR**

Request a fresh code review and Greptile after pushing. Create a PR to `main` with page previews, test evidence and publication behavior. Do not merge until the user explicitly approves.

- [ ] **Step 3: Verify publication after approved merge**

After merge, wait for `pages.yml` and relevant release workflows. Confirm HTTP 200 at `https://spacesarmat.github.io/omp/` and `https://spacesarmat.github.io/omp/en/`, language switching, direct stable and beta links, and the continued presence of every pre-existing update and Homebrew file.
