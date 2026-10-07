# Default dub per series («Озвучка») — report

Branch `feat/series-dub` (from `origin/main`).

## What it does

- A track picked by hand in a player (audio, subtitles) is remembered for the whole series: every season and every
  torrent of it. A later episode picks the track by its dub label first («LostFilm», «HDrezka Studio»; case, spacing
  and punctuation normalised, a whole-word part of a longer title also matches: «LostFilm» ~ «MVO | LostFilm»), then by
  language. Subtitles likewise: off, or title (file name) then language.
- Order when a file starts: series dub by label → the torrent's own choice (per-torrent prefs, kept as before) →
  series language → settings. A reset of the series («По умолчанию») drops the torrent's choice too.
- Series screen: «Озвучка: LostFilm» / «Озвучка: по умолчанию».
  - TV (`src/screens/Series.tsx`): a button next to «Следить за сериями». OK opens a list of the dubs seen in the
    series' files plus «По умолчанию (сбросить)».
  - Phone (`mobile/src/screens/Series.tsx`): a row under the header. «Сменить» opens the same choices as chips, with a
    note that the setting is shared.

## Storage and sync

The record is kept in the watch journal on TorrServer as `omp.a = { at, l?, g?, s?, k? }` on the torrent being played:
`l` is the dub label, `g` the language, `s` is `'off'` or `{ l, g }`, and `k` lists the dubs seen. The series' record
is the newest one among its torrents. A reset is a newer record without `l`, `g` and `s`, so it wins like any other.

Why the journal: the phone's series screen has to show and change what the TV picked, and the journal is how OMP
already shares skip settings between them. Older OMP versions already keep unknown `omp` keys when they write
(`serializeData`). A write only touches the played torrent: it re-reads the server list first and merges with the
newest record of the series, so an audio choice keeps the subtitles chosen on another season.

Grouping follows the series screen: `seriesKey(torrent)` → `findGroup(library, key)`. The record is read from the
library copy of the torrents, which journal writes keep in step. Films have no series record and keep the
per-torrent pref only.

## Players

- LG web player (`src/screens/Player.tsx`): `pickAudioFor` / `pickSubFor` at start. A manual choice from the menu or
  the phone saves the per-torrent pref and the series record (`rememberSeriesTracks`, which never rejects).
- Android TV native player:
  - Start: `nativeTrackStart` fills `audioLang` / `subLang` / `subtitlesOn` plus the new `dubLabel` / `subLabel` for
    `playNative`.
  - Kotlin: `PlayRequest` parses the new fields. `PlayerSession` picks by title once per opened item, when the engine
    lists its tracks (`DubMatch`: title, then language; the engine's language preferences do the rest). A choice
    carried over from an engine switch wins.
  - Report back: a manual choice (menu or phone command) now goes to the page as a `nativePlayerTrack` event
    `{ session, index, kind, label, lang, off?, seen? }`. `NativeSession.onTrack` saves the per-torrent pref (before,
    the native player saved nothing but the engine) and the series record. The session also carries the choice to the
    next items of the queue.

## Tests

- vitest:
  - `tests/lib/seriesTracks.test.ts`: labels, records, merging, `omp.a` surviving other journal writes.
  - `tests/store/seriesTracks.test.ts`: series members, newest record, journal write/merge, failures.
  - `tests/player/trackPrefs.test.ts`: the pick order, choice → record, native start options.
  - `tests/player/nativePlayer.test.ts`: `dubLabel` / `subLabel` in `playNative`, and `nativePlayerTrack` saving.
  - `tests/ui/seriesTv.test.tsx` and `mobile/tests/librarySeries.test.tsx`: the row, the list, the switch and the
    reset, as written to TorrServer.
- Kotlin: `DubMatchTest` covers label normalisation, language codes (ru/rus), picking by label then language for audio
  and subtitles, `PlayRequest` parsing, and `PlayerSession` picking, reporting and carrying choices.

## Limits

- The dubs offered on the series screen are the ones seen when a track was picked by hand: the file's audio list at
  that moment. Until then only «По умолчанию (сбросить)» is offered. Probing files just for the list would wake idle
  torrents.
- The newest record wins by device clock (`at`). A large clock skew between the TV and the phone can let an older
  choice win.
- The LG web player's manual-choice save is covered by the shared helpers, not by a screen test of `Player.tsx`.
