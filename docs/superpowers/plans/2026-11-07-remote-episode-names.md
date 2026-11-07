# Remote Episode Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показывать в списке «Серии» пульта код и название эпизода из TMDB, сохраняя имя файла только как fallback.

**Architecture:** Родительский `Episodes` один раз загружает нужные сезоны через существующий `useTmdbEpisodes`. Каждая `EpisodeRow` получает реальное название как отдельный prop, а исходный `TorrentFile` остаётся источником кода, fallback-подписи и `file.id` для запуска.

**Tech Stack:** TypeScript, Preact hooks, Vitest, существующий кэшируемый TMDB CatalogClient.

**Spec:** `docs/superpowers/specs/2026-11-07-remote-episode-names-design.md`

## Global Constraints

- Не переименовывать файлы и не менять запуск по `TorrentFile.id`.
- При загрузке, ошибке, отсутствии совпадения или placeholder-названия оставлять текущую подпись с именем файла.
- Не добавлять зависимости и не менять другие списки эпизодов.
- Один PR на задачу, без вливания и релиза до разрешения Andy.

## Review Focus

- TMDB недоступен: существующий тест списка должен сохранить имена файлов.
- TMDB вернул «Эпизод 2»: `realEpisodeName` должен включить fallback имени файла.
- В ответе нет нужного номера эпизода: строка не должна потерять текущую подпись.
- Несколько файлов одного сезона: `useTmdbEpisodes` должен вызываться с уникальными номерами сезонов, без запроса от каждой строки.
- После смены подписи свайп должен запускать прежний `file.id`; это проверяет существующий тест свайпа.

---

### Task 1: TMDB-названия в списке серий пульта

**Files:**
- Modify: `mobile/src/screens/nowPager.tsx:58-164`
- Test: `mobile/tests/nowDeck.test.tsx`

**Interfaces:**
- Consumes: `useTmdbEpisodes(tor: Torrent | null | undefined, seasons: number[], enabled: boolean): { show: ShowInfo | null; eps: EpisodeMap }`, `realEpisodeName(name: string): string`, `episodeLine(code: string, name: string): string`.
- Produces: `EpisodeRow` дополнительно принимает `tmdbName: string`; пустая строка означает текущий fallback с именем файла.

- [ ] **Step 1: Write the failing test**

В `NowPlaying swipes` добавить тест `episodes show TMDB names and keep the filename when TMDB has no real name`. Установить fake CatalogClient с сериалом «Ледяной перевал», сезоном 1 и эпизодами `Ледяной прибой` и `Эпизод 2`, открыть список свайпом и дождаться Promises. Проверить строки `S01E01 · Ледяной прибой` и `S01E02 · Frost.Pass.S01E02`, а также один вызов `season` для двух файлов одного сезона. Существующий тест оставляет обе подписи с именами файлов без TMDB и проверяет запуск `file: 2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/tests/nowDeck.test.tsx`
Expected: новый тест FAIL, потому что первая строка остаётся `S01E01 · Frost.Pass.S01E01`; существующие тесты не ломаются.

- [ ] **Step 3: Implement TMDB names in `nowPager.tsx`**

В `Episodes` вычислить уникальные номера сезонов через `parseEpisode`, вызвать `useTmdbEpisodes` и передать каждой строке `realEpisodeName` соответствующего эпизода. В `EpisodeRow` использовать `episodeLine(code, tmdbName)` только при непустом `tmdbName`, иначе сохранить текущее выражение подписи. Не менять touch-обработчики и `onPlay`.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `npx vitest run mobile/tests/nowDeck.test.tsx mobile/tests/playingNames.test.tsx`
Expected: PASS, включая TMDB-название, placeholder fallback, offline fallback и запуск прежнего файла.

- [ ] **Step 5: Run full verification**

Run: `npm test && npm run build && npm run build:mobile`
Expected: все команды завершаются с exit 0; любые чужие падения зафиксировать по именам.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/nowPager.tsx mobile/tests/nowDeck.test.tsx docs/superpowers/plans/2026-11-07-remote-episode-names.md
git commit -m "[phone] Названия серий из TMDB в пульте"
```
