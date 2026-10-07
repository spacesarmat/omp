# Default dub per series («Озвучка») — report

Branch `feat/series-dub` (from `origin/main`).

## What it does

- A track picked by hand in a player (audio, subtitles) is remembered for the whole series: every season and every
  torrent of it.
- **Audio.** A later episode picks the track by its dub label first («LostFilm», «HDrezka Studio»), then by language.
  - Labels are compared with case, spacing and punctuation normalised.
  - A whole-word part of a longer title also matches: «LostFilm» ~ «MVO | LostFilm».
  - A title made only of codec or format names is no dub label. Examples: SUBRIP, SRT, ASS/SSA, PGS, VobSub, WebVTT,
    tx3g, mov_text, DVB subtitles, PCM_*, AC3 5.1, DTS-HD MA. An untitled track is remembered by its language only, and
    such names are never offered on the series screen.
- **Subtitles.** Off, or by title (or file name), then by language. When both the remembered choice and a candidate
  know their language, a title matches only in that language («Forced» of another language is another track).
- **One start order on both players** (LG web and Android TV native):
  1. series dub by label;
  2. the torrent's own remembered choice (per-torrent prefs, kept as before);
  3. series language;
  4. settings.

  A reset of the series («По умолчанию») stops the torrents' older choices from counting, also after a later choice of
  only audio or only subtitles.
- **Series screen:** «Озвучка: LostFilm», «Озвучка: Русский» (a language without a dub title) or
  «Озвучка: по умолчанию». The list offers:
  - the dubs seen;
  - the remembered entry when it is not among them (a dub title or a language, marked current);
  - «По умолчанию (сбросить)».
  - TV (`src/screens/Series.tsx`): a button next to «Следить за сериями», which opens the list.
  - Phone (`mobile/src/screens/Series.tsx`): a row under the header; «Сменить» opens the same choices as chips.

## Storage and sync

The record is kept in the watch journal on TorrServer, on the torrent being played, as
`omp.a = { at, l?, g?, s?, k?, x? }`:
- `l`: the dub label (never a codec name);
- `g`: the language;
- `s`: `'off'` or `{ l, g }`;
- `k`: the dubs seen;
- `x: true`: the series was reset once; every later record keeps it.

The series' record is the newest one among its torrents. A reset is a newer record without `l`, `g` and `s`, so it wins
like any other.

**Why the journal:** the phone's series screen has to show and change what the TV picked, and the journal is how OMP
already shares skip settings between them.
- Older OMP versions keep unknown `omp` keys when they write (`serializeData`).
- A write only touches the played torrent. It re-reads the server list first and merges with the newest record of the
  series, so an audio choice keeps the subtitles chosen on another season.

**Grouping** follows the series screen: `seriesKey(torrent)` → `findGroup(library, key)`. The record is read from the
library copy of the torrents, which journal writes keep in step. Films have no series record and keep the per-torrent
pref only.

## Players

- **LG web player** (`src/screens/Player.tsx`):
  - At start: `pickAudioFor` / `pickSubFor`.
  - A choice by hand (menu or phone) saves the per-torrent pref and the series record (`rememberSeriesTracks`, which
    never rejects).
- **Android TV native player:**
  - At start: `nativeTrackStart` turns the same order into `audioPick` / `subPick` for `playNative`. These are lists of
    steps `{ l?, g?, off? }`; the settings close each list, and the engine's language preference is the list's first
    language.
  - Kotlin: `PlayRequest` parses the lists. `PlayerSession` walks them once per opened item, when the engine lists its
    tracks (`DubMatch`): the first step that finds a track wins, and an `off` step turns the subtitles off. A choice
    carried over from an engine switch wins.
  - Choices by hand: a menu pick or a phone command goes to the page as `nativePlayerTrack`
    (`{ session, index, kind, label, lang, off?, seen? }`). `NativeSession.onTrack` saves the per-torrent pref and the
    series record; before this change the native player saved nothing but the engine.
  - The choice is also carried to the next items of the same run: the dub by title, else its language (untitled tracks
    too); subtitles by title or language; subtitles turned off stay off.

## Tests

- vitest:
  - `tests/lib/seriesTracks.test.ts`: labels, codec names, records, merging, the reset flag, `omp.a` surviving other
    journal writes.
  - `tests/store/seriesTracks.test.ts`: series members, newest record, journal write/merge, failures.
  - `tests/player/trackPrefs.test.ts`:
    - the pick order;
    - untitled subtitles by language;
    - title only in the same language;
    - no torrent choice after a reset;
    - native start lists.
  - `tests/player/nativePlayer.test.ts`: `audioPick` / `subPick` in `playNative`, and `nativePlayerTrack` saving.
  - `tests/ui/seriesDub.test.ts`, `tests/ui/seriesTv.test.tsx` and `mobile/tests/librarySeries.test.tsx`:
    - the row and the list, with the language-only entry marked current;
    - the switch and the reset, as written to TorrServer.
- Kotlin, `DubMatchTest`:
  - label normalisation and codec names;
  - language codes (ru/rus);
  - the start order;
  - subtitles by title only in the same language;
  - `PlayRequest` parsing;
  - how `PlayerSession` picks, reports and carries choices (untitled audio, subtitles on and off).

## Limits

- The dubs offered on the series screen are the ones seen when a track was picked by hand: the file's audio list at
  that moment. Until then only «По умолчанию (сбросить)» is offered. Probing files just for the list would wake idle
  torrents.
- The newest record wins by device clock (`at`). A large clock skew between the TV and the phone can let an older
  choice win.
- The LG web player's manual-choice save is covered by the shared helpers, not by a screen test of `Player.tsx`.
