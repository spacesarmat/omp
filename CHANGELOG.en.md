# Changes

<!-- Markers [phone] [tv] [lg] [atv] [tech]: see docs/changelog-markers.md. [tech] bullets are technical or admin-only and never reach users. -->

The English translation covers the latest versions only; the full history (in Russian) is in [CHANGELOG.md](CHANGELOG.md).

## Unreleased

- [phone] On the season page the backdrop no longer covers Find torrents for the season or the Episodes heading. The gap stays with and without the button, with the yellow air date and with a long title
- [phone] A card can be shared: an icon next to Back on a film, a series and a season, a long press on a poster in the catalog and in Want, and Tell friends in Settings. The text is the title, the year, a short line and a link to omp-player.online. An unreleased season says something like "Season 2 comes out Nov 8". Magnets and torrent hashes are never included
- [tech] Site: /t/movie/ID, /t/tv/ID and /t/tv/ID/s/N serve a card page with download buttons. Android App Links: an intent-filter for https://omp-player.online/t/ and assetlinks.json. The file has the debug certificate fingerprint, which is not the release key. Until assetlinks.json has the release certificate SHA-256 and the site is deployed, an https link does not open the app by itself: the site opens, and Open in OMP starts the installed release. Deploy site/ and the Caddyfile

## 0.20.8-beta.1

- Mine and Discover can show our own ads: a card the same size as its neighbours, with the Ad label, the advertiser and the erid. On the phone that is every Mine and Discover view, and between the rails on the Discover home. On a TV it is every Mine view and the Discover grid, and OK opens a QR code instead of the link. No ads in History or search, for subscribers, or on a TV linked to a subscribed phone. None in the first days after install, then one every few cards. With no banners configured, nothing is shown
- The support card, the FAQ and the site now say "OMP is free, ad-free with a subscription". The only paid part is still the OMP subscription (Jackett and JacRed). Boosty support does not turn it on
- [tech] Catalog ads: `settings.ads`, migration `003_ads` (`ad_images`, `ad_stats`, after the already shipped `002_monitor`), `GET /v1/ads-config`, `POST /v1/ads/event` with no device ids, and the Ads admin tab. The Android TV and webOS switches stay off until an admin turns them on. Android TV fetches the config with native HTTP, webOS with XHR; the public GETs answer `Access-Control-Allow-Origin: *` with no credentials
- [phone] Catalog season page: a large poster on a backdrop, the series title and the season beside it, and room between the poster, the button and Episodes. An episode is two lines: a clear number, a title of up to two lines, then the length and the status (not in the library, or the air date)
- [tv] Season page: a poster on a backdrop, the series title and Season N, and room between the header, the buttons and Episodes. An episode is two lines: a clear number, a title of up to two lines, then the length and the status (size, time left, or the air date)
- A release size now looks the same everywhere: "27.0 GB", with no "11.2 GB" in one place and "27,0 GB" in another. An empty field no longer leaves " · -" in the line
- [tv] The releases dialog footer names opening and deleting a release, not "mark watched"
- [tv] TV text is at least 24px. Test-mode code labels still follow the size slider
- [tv] Several releases of one film in the library are one card. They can be switched on the release screen. The same person is not repeated in the cast row
- [tv] Test-mode codes at the screen edge stay fully visible

## 0.20.7

- External dubs and subtitles that a release ships as separate files show in the release lists («+3 dubs, subtitles») and go to 2160 Player 0.2.17 or newer by themselves: every episode its own, the chosen dub is remembered for the series
- [phone] The built-in player is updated to 2160 Player 0.2.17: external dubs and subtitles, subtitles from «Load from file…» and MKV chapters on 32-bit devices work again
- [atv] An episode is no longer marked watched when 2160 Player closes before playback has started
- [tv] On a release card, D-pad Up from the cast row reaches Watch again
- External subtitles with no name (one .ass next to an episode, say) are remembered for the series
- Dubs and subtitles reach 2160 Player for a release just added from the search and started right away, too (folders like «Rus Sound/LostFilm», «Rus Subs», or files next to an episode). TorrServer preloads the chosen dub
- [phone] An unsupported external dub no longer stops the video: the embedded track plays and a warning shows; Back in the player closes the side panels
- [atv] The saved progress is not replaced with the duration when the player returns no position. Finishing the episode, or leaving near the end, still marks it watched
- [tv] On a catalog title card Up from the cast row reaches Find torrents; Up from the season row, the intro-skip row and the episode list also moves to the row above
- [phone] On a catalog season page a long title no longer slides under the status bar
- [lg] The release screen says honestly that separate dub files do not play on webOS: you hear the video track
- [atv] With the OMP player chosen, a release screen with separate dubs suggests switching to 2160 Player
- A film with heavy external tracks next to it (several DTS dubs, say) is no longer taken for a set of episodes
- [tech] `src/lib/externalTracks.ts`: the external tracks and subtitles of a release are matched to their episodes (SxxEyy, 1x02, E02, « - 02 », the same file name, season folders), the studio comes from the folder or the name suffix, ISO 639-2 language, forced/SDH flags, stable ids («a:rus:lostfilm»). `src/lib/externalTrackPick.ts` picks the start track. `src/player/externalTracks.ts` hands them to 2160 Player by Intent API §3.7 (2160 Player 0.2.17): every key in one object P2160_TRACKS, the native side only passes `tv.p2160.extra.*` extras and returns the asked result keys. `charset` goes with subtitles only; OMP sends no `delayMs` or `select`: AUDIO_SELECT / TEXT_SELECT set the start. The android/vendor/2160player submodule is bumped to v0.2.17 (f292a8b), player-core coordinate 0.2.17
- [tech] `TorrServerClient.get` keeps `file_stats` in knownFiles like `loadInfo`: the library copy of a release just added is the `add` answer without metadata, so `filesOfHash` returned []. `play2160` asks TorrServer for the files of queue releases this device has none of before the launch (`ensureQueueFiles`, at most 5 s; a screen left meanwhile opens no player). The series record keeps the external track id of subtitles with no name and language (`s.i`, «s:und:» or «s:und:#2»), `pickExternalSubtitle` finds them by it
- [tech] `saveP2160Result` marks watched only when the player reported a position of at least 90% of the duration. `ended` without that position no longer fills in the known duration. `Player2160.parseExtras` reads `tv.p2160.extra.POSITION`, `DURATION` and `WATCHED` (API 3.4)

## 0.20.7-beta.2

- 2160 Player gets the external dubs and subtitles again for a release added from the search and started right away: nothing went to the player before, since the new release's file list was not known yet
- External subtitles with no name and no language (one .ass next to an episode, say) are now remembered for the series when picked in 2160 Player, and come on in the next episodes
- [tech] `TorrServerClient.get` keeps `file_stats` in knownFiles like `loadInfo`: the library copy of a release just added is the `add` answer without metadata, so `filesOfHash` returned []. `play2160` asks TorrServer for the files of queue releases this device has none of before the launch (`ensureQueueFiles`, at most 5 s; a screen left meanwhile opens no player). The series record keeps the external track id of subtitles with no name and language (`s.i`, «s:und:» or «s:und:#2»), `pickExternalSubtitle` finds them by it

## 0.20.7-beta.1

- External dubs and subtitles that a release ships as separate files (folders like «Rus Sound/LostFilm», «Rus Subs», or files next to an episode) now show in the release lists: «+3 dubs, subtitles». On the phone in «Another release», «Releases (N)», the «Release» line and the release header; on the TV in «Torrents · N» and on the release screen. These files still never show as episodes
- 2160 Player gets those dubs and subtitles by itself: every episode its own files, at start the dub chosen for the series or the language from the settings, and a dub picked in the player is remembered for the whole series. TorrServer preloads the chosen dub. It needs 2160 Player 0.2.17 or newer; the phone's built-in player gets them the same way
- [phone] The built-in player is updated to 2160 Player 0.2.17: a release's external dubs and subtitles, an unsupported external dub no longer stops the video (the embedded track plays and a warning shows), subtitles from «Load from file…» work again, MKV chapters on 32-bit devices, Back closes the side panels
- [lg] The release screen says honestly that separate dub files do not play on webOS: you hear the video track
- [atv] With the OMP player chosen, a release screen with separate dubs suggests switching to 2160 Player
- A film with heavy external tracks next to it (several DTS dubs, say) is no longer taken for a set of episodes
- [tech] `src/lib/externalTracks.ts`: the external tracks and subtitles of a release are matched to their episodes (SxxEyy, 1x02, E02, « - 02 », the same file name, season folders), the studio comes from the folder or the name suffix, ISO 639-2 language, forced/SDH flags, stable ids («a:rus:lostfilm»). `src/lib/externalTrackPick.ts` picks the start track. `src/player/externalTracks.ts` hands them to 2160 Player by Intent API §3.7 (2160 Player 0.2.17): every key in one object P2160_TRACKS, the native side only passes `tv.p2160.extra.*` extras and returns the asked result keys. `charset` goes with subtitles only; OMP sends no `delayMs` or `select`: AUDIO_SELECT / TEXT_SELECT set the start. The android/vendor/2160player submodule is bumped to v0.2.17 (f292a8b), player-core coordinate 0.2.17

## 0.20.6

- «Change poster» on the phone and the TV: search TMDB by title, pick a poster variant, paste your own link or reset; a film with several releases gets the poster on all of them
- The automatic poster lookup is more accurate: a film is looked up among films of its year, found even when the release spells a Russian name without the letter yo, and by the English title from the release name; releases with no poster are tried again
- [phone] A film or series on one screen: seasons, episodes and releases (quality, size, seeds), one tap plays the next episode; several releases of one film are one card in «Mine»
- [phone] The «Search» tab replaces «Add»: «Mine», «Catalog» and «Sources» in one row, paste a link or magnet right there; «Continue watching» on top of «Mine»
- TorrServer over https: on a custom port, behind a proxy with a path, and with a self-signed certificate after you confirm its fingerprint
- The built-in TorrServer is updated to MatriX.147.2
- [phone] The built-in player is updated to 2160 Player 0.2.16: wider audio and subtitle panels, a buffering spinner, the elapsed time is no longer cut, and on films with chapters the remaining time is right-aligned again; AVI files (XviD/DivX with MP3 audio) play and seek with the right duration, and when a video codec can not be decoded the player names it instead of playing sound only
- [phone] Offline you get one clear «No internet», and the TV search does not run without Wi-Fi
- [phone] «History» skips plays that never started (0:00), one episode is one line; in landscape screens no longer go under the system bar
- [phone] The catalog on its side: a whole card shows, from the poster down to its caption, and a row holds as many cards as fit across. At the biggest size that is 5-6 instead of 2, more at the smaller sizes; «Mine» does the same for large and small tiles. Portrait is unchanged
- [phone] «OMP account» shows «Subscription until ...» right away; different films with similar titles no longer merge in «Mine»
- Help: a detailed guide to installing on Android over ADB without losing data
- Extra releases of a season can be deleted right from the releases list: on the phone a trash button on each release in «Another release» (and in «Releases (N)» of a film), on the TV the red key in «Torrents · N». Before a release goes, its watch marks, progress and intro skip move to the release that stays; the release playing on the TV can not be deleted; a pack holding other seasons is not deleted from the list
- [tv] «Torrents · N» shows the quality of each release, not only its size
- [phone] «Now on TV»: the title no longer repeats over the seek bar, the «Episodes» hint no longer covers the buttons, the bottom row no longer goes under the system bar, and the chapter list scrolls again; the bottom row of the remote pulled down from there also stays above the system bar
- [phone] Series episodes stay listed when a release is not answering: the phone shows the files it has already seen, and for a release never opened the season's episodes from TMDB (not playable). Releases added through OMP now keep their file list on TorrServer
- [phone] «Find better quality» shows the season and episodes of each series release: «S01 · 8 episodes»
- [tech] Android: https to TorrServer goes through OkHttp with TorrServerTrust (system CAs, then a pin per host:port)
- [tech] The poster is written with TorrServer `set` to every release of the film; tsp.posterTried keeps the try time, a TMDB key fingerprint and the search version
- [tech] The Telegram release post is a photo, a caption and buttons only; one bot @OMPBILLINGBOT for billing and posts, the admin bot and the parser monitor are removed
- [tech] Billing panel: a «Monitoring» tab (trackers, sites, Postgres, backup, containers) with Telegram alerts
- [tech] JacRed on the NUC: sync goes through WARP, the working config is kept on the host; ops/vps/deploy.sh runs on the NUC
- [tech] Release files are cached on the device (omp.knownFiles, up to 150 releases); a journal write adds TorrServer.Files to data when TorrServer did not save it (data already held omp.ts)

## 0.20.6-beta.11

- [phone] The built-in player is updated to 2160 Player 0.2.16: on films with chapters the remaining time is right-aligned again; AVI files (XviD/DivX with MP3 audio) play and seek with the right duration, and when a video codec can not be decoded the player names it instead of playing sound only
- Extra releases of a season can be deleted right from the releases list: on the phone a trash button on each release in «Another release» (and in «Releases (N)» of a film), on the TV the red key in «Torrents · N». Before a release goes, its watch marks, progress and intro skip move to the release that stays; the release playing on the TV can not be deleted; a pack holding other seasons is not deleted from the list
- [tv] «Torrents · N» shows the quality of each release, not only its size
- [phone] «Now on TV»: the title no longer repeats over the seek bar, the «Episodes» hint no longer covers the buttons, the bottom row no longer goes under the system bar, and the chapter list scrolls again; the bottom row of the remote pulled down from there also stays above the system bar
- [phone] Series episodes stay listed when a release is not answering: the phone shows the files it has already seen, and for a release never opened the season's episodes from TMDB (not playable). Releases added through OMP now keep their file list on TorrServer
- [phone] «Find better quality» shows the season and episodes of each series release: «S01 · 8 episodes»
- [phone] «Change poster»: the year in a result tile now has its own line under the title (as on the TV); a long title is cut, the year always shows
- Torrents without a poster that the automatic lookup found nothing for are searched once more with the new search (yo variants and the English title) without waiting a week
- [tech] Release files are cached on the device (omp.knownFiles, up to 150 releases); a journal write adds TorrServer.Files to data when TorrServer did not save it (data already held omp.ts)
- [tech] `tsp.posterTried` stores the search version (`POSTER_SEARCH_VERSION`, now 2); marks of another version are dropped

## 0.20.6-beta.10

- [phone] «Change poster»: search result tiles no longer run over each other, the title and year captions show
- The poster search finds a film even when the release title spells a Russian name without the letter yo (as many trackers do), and when nothing is found in Russian it searches by the English title from the release name (Supergirl.2026... - «Supergirl», 2026); in the automatic lookup and in «Change poster» on the phone and the TV
- [tech] Search order: the title, its variants with yo, the English title; all the typed searches (a film with its year, a series) first, then the multi search; titles are compared with yo read as ye

## 0.20.6-beta.9

- The built-in TorrServer is updated to MatriX.147.1
- [phone] «Change poster»: the picture button on the release screen is now always there, not only without a poster, and the long-press menu in «Mine» has the same item. Search TMDB by title (films or series of the same year first), pick one of the poster variants, «Paste a link» or «Reset (find automatically)»; a film with several releases gets the poster on all of them
- [tv] «Change poster» replaces «Another poster»: a poster grid with title search, the poster variants of the picked film or series, a link field and reset; all with the remote, and the poster shows on the phone too
- The automatic poster lookup is more accurate: a film is looked up among films of its year and a series among series, so a 2026 film no longer gets the poster of a series with the same name. Releases with no poster found are tried again after a week and after the TMDB key changes
- [tech] The poster is written with TorrServer `set` to every release of the film, each read again right before the write so the title and category are kept; an http:// link is accepted for the home network only; tsp.posterTried keeps the try time and a fingerprint of the TMDB key (FNV, never the key)

## 0.20.6-beta.8

- [phone] «Mine»: different films no longer merge into one card because of a year, quality or tags in the title (Supergirl, Signal One and Minions are separate again); releases of different TMDB films are never grouped, and the «Already in the library» hint is more accurate too
- [phone] Film screen with several releases: the «Release: ... · Change» line is replaced by a «Releases (N)» block - each release shows its quality, size and seeds, the current one is checked, a tap switches; «Files» below belong to the picked release
- TorrServer over https on a non-standard port (for example, https://ts.example.com:8443) and behind a reverse proxy with a path: an address without https:// is tried over both http and https (https first on ports 443, 8443 and 8091) and the one that answers is saved; errors and the server list show https://, and a refused certificate is named as such (#193)
- [atv] Android TV: TorrServer over https with a self-signed certificate - the first connect shows the certificate fingerprint and connects only after "Trust"; a changed certificate shows a warning. VLC cannot open such a server, the built-in player plays it (#193)
- [phone] Phone: TorrServer over https with a self-signed certificate connects after you confirm the certificate fingerprint; a changed certificate shows a warning, and the background subscription check uses the certificates already accepted (#193)
- [tech] Android: https requests to TorrServer go through native OkHttp with TorrServerTrust (system CAs, then a pin per host:port); the same trust is the HttpsURLConnection default, so Media3 and 2160 Player work without submodule changes; webOS still needs a trusted certificate

## 0.20.6-beta.7

- [phone] The built-in player is now 2160 Player 0.2.14: the elapsed time no longer clips while the file length is still unknown (buffering in portrait showed "3:2" instead of "3:29")

## 0.20.6-beta.6

- [phone] Test mode in landscape: row and poster labels no longer cover the filter chips and the bottom tab bar; a row label moves to a free spot, and labels of elements under the tab bar are not drawn
- [phone] Settings, "OMP account": with an active subscription the row shows "Subscribed until ..." right away instead of "Sign in"; a phone linked through Telegram sees "Checking sign-in…" instead of "Sign in" while the account is checked

## 0.20.6-beta.5

- [phone] With no TV chosen the main button is "Watch on the phone"; on a series page one tap starts the next unwatched episode, with "On the TV" next to it
- [phone] The "Add" tab is now "Search": one field with the "Mine", "Catalog" and "Sources" tabs; a link or magnet is pasted there too
- [phone] A series and its release on one screen: seasons, episodes and a "Release: 1080p · Change" line that opens "Another release"
- [phone] "Mine": a "Continue watching" row on top; "History" left the filters and opens from the header button or "All history"
- [phone] The "Remote" tab shows only when a TV is chosen
- [phone] Several releases of one movie in "Mine" are one card, and the release is picked inside with the "Release: ... · Change" line
- [phone] Sort and view are one sheet, and the button shows the current choice
- [phone] Settings: "Server on the phone" sits next to "Watch from"
- [phone] The built-in player is now 2160 Player 0.2.13: the "Audio track" and "Subtitles" panels are wider and labels no longer break mid-word; in landscape the time is aligned to the right
- [phone] 2160 Player: "LIVE" shows only for real live streams; while buffering a spinner replaces the play button
- [phone] 2160 Player: the error dialog closes the open panel and draws on an opaque backdrop; intro detection starts only after the stream has opened

## 0.20.6-beta.4

- [phone] Offline shows one honest "No internet" instead of "TMDB does not answer" and "Nothing found"; the source search does not offer a subscription when no source answered
- [phone] The TV search does not run without Wi-Fi, and on "Catalog" it runs without the "Searching..." line, so the poster grid no longer jumps; the "TV" screen says "No TVs found" and what to check after a search with no result
- [phone] "History": a start that never played (0:00) is no longer saved as a watch, and one episode of a show is shown as one row
- [phone] Landscape: screens keep off the side system bar, the bottom tab bar is lower
- [phone] "Mine": the sort button shows which order is on, a toast names the new sort or view after a change
- [phone] "Mine": a large clear button in search, an empty search field closes when you leave, "Nothing found" offers a tracker search; a poster without an image shows a letter instead of the name twice
- [phone] "News": the "Subscriptions" tab with its counter fits one line
- [phone] Release and series: no dangling "-" when seeds are unknown; the buttons over the backdrop are on a dark plate again
- [phone] "Another release" and "Find in better quality": sizes in one format ("11.2 GB"), the picked release is outlined
- [phone] Series, "Dub": "Change" turns into "Hide", and with no remembered dub there is no pointless "Default (reset)" item
- [phone] "Remote" without a TV: the search is a line in the "Connect a TV" card, not a separate line above it
- [phone] "Install OMP on the TV": a top gap, an aligned title, a normal "Enter IP manually" button
- [phone] Beta: test-mode labels sit on the edge of the element, see-through and smaller, and no longer cover switches and values; "Label size" shows only with test mode on; "Dub" and "Change" have codes
- [phone] "Another release": long release titles no longer run over the next row and the size and seeds line; each row grows to fit its title and the list scrolls
- [tv] "In better quality": all text in the dialog is at least 24px
- [phone] Help: a new answer "Install on Android with ADB" for the phone and TV boxes - developer mode, platform-tools, adb devices and adb connect, picking the APK by architecture, adb install -r without losing data, and the common errors
- [phone] Help: "App not installed" no longer says that 32 or 64 bits never block an install, and warns that uninstalling OMP erases its data; a new question "OMP subscription: Jackett and JacRed"
- [atv] Help: a full answer "Install on Android with ADB" (adb connect, picking the APK, errors); the built-in player is named 2160 Player
- [tech] Site: the FAQ has the ADB install steps (a #adb link opens the answer) and an "Is OMP free?" question about the OMP subscription
- [tech] Billing panel: a Monitoring tab with a table of checks (green or red status, time, 7-day history) and a "Check now" button
- [tech] Checks every 15 minutes (the interval is set in the tab): every Jackett and JacRed tracker directly and through WARP, search through Jackett, Cloudflare trace through WARP, Postgres, backup, bot polling, disk, the 4 public sites, Jackett, JacRed and TorrServer on the internal network
- [tech] Containers, restarts and memory through a read-only Docker proxy (new omp-docker-proxy container); the panel cannot restart anything
- [tech] Telegram alert through @OMPBILLINGBOT only after a second check 30 s later, once per problem, plus a «fixed» message
- [tech] Monitoring: site checks (public sites and trackers) pass on the response status and headers without downloading the whole page, so a slow body no longer reads as a timeout
- [tech] Monitoring: red first, fully green groups fold into one line ("Containers 12/12"); filter "All / Errors only / No alert", search by name, sorting by status, name, response time and check time; the choice is kept in the browser
- [tech] Monitoring: a "Recheck all errors" button runs only the red checks again
- [tech] ops/vps/deploy.sh works on the NUC: docker compose with docker-compose.nuc.yml, health checks over http on port 80, node --check in a container when the host has no node
- [tech] JacRed: the base syncs from sync.jacred.stream through WARP (globalproxy in jacred/init.yaml): the direct path from the NUC stalled and the base had not grown for 15 hours
- [tech] Monitoring: a "Recheck" button on a red row (that check only), run progress «N of M» with the start time, a state per row (checking, waiting for the retry, done) and a summary at the end
- [tech] JacRed on the NUC: the full running config is pinned in the host jacred/init.yaml (with globalproxy through WARP); the README explains that /app/init.yaml is the real config and that a JacRed admin save must be copied to the host
- [tech] JacRed on the NUC: a systemd timer copies the running config from the container to the host every minute (validated, with a backup, last 20 kept), so a JacRed admin save survives a restart
- [tech] Monitoring: a yellow "asks for a code" status for tracker sites that answer with a captcha or anti-bot page: no alert, not counted as an error, its own filter, group summary "12/12, 1 yellow"; a red tracker turning yellow closes its alert with an «asks for a code» note
- [tech] Monitoring: when a tracker site leaves out its intermediate certificate, the check fetches it through AIA like a browser and still verifies the full chain ("certificate fetched"); torrent.by is no longer red with a TLS error

## 0.20.6-beta.3

- Beta: "Label size" is now a px slider, labels are smaller by default
- [phone] Beta: labels from 8 to 24 px, default 12
- [tv] Beta: labels from 16 to 36 px in steps of 2, default 20; left and right change it, the row shows the value
- [atv] Beta: the Android TV player uses the same px size
- [tech] An old Small or Large choice moves to the nearest size, Medium becomes the new default

## 0.20.6-beta.2

- Beta: codes on posters, cards, rows, list rows, tabs and buttons (for example S01.R2.P#4 is the 4th poster in the 2nd row), an open window shows only its own
- Beta: "Label size" next to "Test mode": Small, Medium or Large
- Beta: the label size also applies in the Android TV player and the Cloudflare check window
- [tech] Element type table (R, P, C, L, T, B, I, G) in docs/screen-codes.md; npm run tv:install finds a beta IPK

## 0.20.6-beta.1

- [tv] Beta: "Test mode" in Settings shows codes for screens, dialogs and items (for example S05.3), the screen code in the corner can be copied
- [phone] Beta: "Test mode" on the phone too (item P11.19 in Settings), codes P and PD
- [atv] Beta: codes in the Android TV player too (A01, AD01-AD06)
- [tech] Screen code table in docs/screen-codes.md, a test keeps it in sync with the code
- [tech] Telegram release post without files: only photo, caption and buttons (builds and release page via buttons); the file replies, the file repost (telegram-fix: files) and the «forward it manually» log are removed
- [tech] Telegram release post without text links: the caption holds only the change bullets, the files and the GitHub release page are buttons only (new universal APK button), no separate message linking the big files
- [tech] One Telegram bot, @OMPBILLINGBOT, for billing and channel posts: billing requests its update types explicitly and deletes the «pinned a message» line itself; the release script no longer polls the bot
- [tech] Parser monitor (GitHub Actions) removed together with the admin bot's /status and /check; /stats and /ci no longer show it
- [tech] Billing: admin login works under BILLING_READONLY (in-memory sessions and tokens), /health uses backupEveryHours, a failed pg_dump sets pgBackupOk false and alerts immediately; bot deviceInfo only when showing devices.
- [tech] Billing: the admin user card and subscription list show the credit (RUB toward the next renewal)
- [tech] Billing: admin home shows counts of devices on new vs legacy tokens (prep for strict checks; flags stay off)
- [tech] The admin bot (Cloudflare Worker ops/admin-bot) is removed: /versions, /stats and /ci are no longer needed, the only OMP bot is @OMPBILLINGBOT

## 0.20.5

- Subscription: limit = base + bonus + bought, the bot shows the breakdown and the phone model
- Bot: Pay / Devices menu, unbind with confirmation, credit for a late payment
- [phone] Without an OMP subscription, up to 10 items in New → Subscriptions (extras paused)
- [phone] Clearer device disconnect and limit errors
- At most 2 device changes per 30 days
- [tech] Subscription: new self-renewing device keys
- [tech] Admin: devices and last seen, revoke, limit; the base limit is set in the admin, which also shows the breakdown and phone model
- [tech] Billing on Postgres 17: daily dumps, admin alert, SQLite path removed

## 0.20.4

- [lg] LG: tiles redesigned in every view: full-width grids, two-line titles that wrap by word, aligned list columns. Same on 1080p and 4K
- [lg] LG: tabs without clipped names, larger text, sharper posters on 4K, Settings and Help scroll to the end
- [atv] Android TV: OMP opens when the box powers on; Settings can turn it off
- Seed counts are labeled: tracker data in search, live connected seeds and peers on a torrent
- A release is added with the source's trackers instead of a bare hash, so seeds are found right away
- If a release sends nothing for a minute, OMP says it does not answer and offers Find in better quality
- [phone] New → Subscriptions: sort by date added (default), newest finds, name, quality, or longest without a find
- [phone] A series torrent shows "5 of 8 episodes" of the season from TMDB
- [phone] The connect-to-TV code fits a narrow screen and stays above the keyboard
- [phone] Server settings: tidy spacing and a TMDB key row
- [phone] Audiobooks: their own search, a player with lock-screen controls, speed and a sleep timer. The built-in player is 2160 Player 0.2.8
- [phone] First launch helps find TorrServer, hints appear once each
- The site has an English page
- [tech] The payment bot keeps admin login working when a second copy runs

## 0.20.4-beta.4

- [phone] First launch asks where TorrServer is: on this phone, on the home network, or a QR from the TV. Any step can be skipped
- [phone] Hints appear once: catalog search, Mine, Audiobooks, the audiobook player and the video player
- [phone] Settings: Show onboarding, and Reset hints
- [tv] Settings: Show onboarding opens the introduction again
- The public site has an English page and a language switch

## 0.20.4-beta.3

- [phone] An audiobook from the catalog, library, history or the menu opens in the audiobook player
- [phone] Audiobook speed works on Samsung: hardware audio offload is off
- [phone] Video background audio stays on until you turn it off
- A tracker that did not return the torrent file says so, without asking you to sign in
- [phone] This beta installs over the previous one: 0.20.4-beta.3 has its own Android version code

## 0.20.4-beta.2

- [phone] The built-in player is updated to 2160 Player 0.2.8. The screen stays on while a video is playing: the core setting is on by default
- [phone] An audiobook and a video stay on separate sessions, so the lock-screen buttons do not mix
- [tech] The Android build pins commons-io 2.18.0 and commons-lang3 3.18.0, so the old SMB copies stay out of the app
- [phone] Audiobooks: search classifies MP3, M4B, AAC, FLAC and a narrator credit as audiobooks, and FB2, EPUB, PDF and DJVU as e-books
- [phone] Book card: when the file list is missing because there are few seeds, Retry asks again
- [phone] Audiobook player: after an error the current track starts again, and the button layout stays put
- [phone] The notification and the lock screen show track N of M and previous and next chapter

## 0.20.4-beta.1

- [phone] Audiobooks: search in audiobook mode, and the books already added
- [phone] Audiobook player: playback with lock-screen controls, speed and a sleep timer

## 0.20.3

- The built-in TorrServer is updated to MatriX.147

## 0.20.2

- [phone] TMDB key: a v3 API key is accepted, and Clear removes a stored v4 token. Discover separates a rejected key from a server that does not answer
- [tv] Discover reads the same TMDB v3 key and drops an empty key cache
- [phone] Settings: account, viewing, search and the app stay on the main screen; technical options move under Advanced
- [tv] Settings use the same groups: everyday choices first, the rest under Advanced
- Subscription search: Jackett asks its indexers in parallel, so one slow indexer no longer uses up the whole timeout
- JacRed: a Latin query that returns only a few exact names is searched again without the last two letters
- Audiobooks: a release marked as an audiobook, with a narrator credit, or as m4b is filed under Audiobooks and labeled Audiobook. Jackett and JacRed can search that mode: category 3030 and the trackers that file audiobooks under books or other

## 0.20.2-beta.2

- same as beta.1 (beta.1 did not build: the TMDB key was visible to tests)

## 0.20.2-beta.1

- [phone] TMDB key: a v3 API key is accepted, and a stored v4 token can be cleared. Discover separates a rejected key from a server that does not answer
- [tv] Discover reads the same TMDB v3 key and drops an empty key cache
- [phone] Settings: account, viewing, search and the app stay on the main screen; technical options move under Advanced
- [tv] Settings use the same groups: everyday choices first, the rest under Advanced

## 0.20.1

- [phone] Discover: TMDB-style home (trending, popular, in theatres, upcoming, on TV, top rated); posters show again after you return to the tab
- [phone] With no TV selected, Catalog, Remote and Settings list the TVs already found; one tap connects
- TorrServer search on the LAN is faster: saved addresses and likely hosts first; on the phone a server shows up as soon as it answers
- [phone] Plain HTTP stays inside the LAN. TLS to a TV and an Android TV Box pins the certificate on first connect; a different one asks "Trust the new one" and does not fall back to plain HTTP
- [atv] Plain HTTP stays inside the LAN, same as on the phone
- [tv] TLS to a TV and an Android TV Box pins the certificate on first connect
- The phone-to-TV pairing code is 6 digits
- [phone] Now playing: full-width poster from the top of the screen, soft fade into the background; the screen and swipes stay portrait-only
- [phone] History: the phone/TV filter sits inside the list. Add: magnet is a button, sources and filters share one row. Settings: one yellow update button, Video player on its own screen
- [phone] OMP Jackett and JacRed: search and download only through the subscription; keys are not in the app
- [phone] Backup: skipping a TorrServer update stays on this phone
- [tech] The subscription admin is in Russian: activation codes stay out of bulk lists, the wallet is masked, there is a filter for subscriptions expiring within 7 days, and notices go to administrators
- The public site on a narrow phone: platform labels wrap, and the download button shortens

## 0.20.1-beta.15

- [phone] Plain HTTP stays inside the LAN: cleartext to public addresses is blocked
- [atv] Plain HTTP stays inside the LAN, same as on the phone
- [phone] TLS to a TV and an Android TV Box: the certificate is pinned on first connect (TOFU); a different one asks "Trust the new one" and does not fall back to plain HTTP
- [phone] Discover: posters show again after you return to the tab
- [phone] With no TV selected, Catalog, Remote and Settings list the TVs already found; one tap connects
- TorrServer search on the LAN is faster: saved addresses and likely hosts first; on the phone a server shows up as soon as it answers
- [tech] The magnet-add test waits until the poster is stored

## 0.20.1-beta.14

- same as beta.11 (beta.13: changelog window keeps 0.17.0 again)

## 0.20.1-beta.13

- same as beta.11 (beta.12: changelog text must not look like platform markers)

## 0.20.1-beta.12

- same as beta.11 (CodeSheet tests for 6 digits; changelog markers without stacked platform tags)

## 0.20.1-beta.11

- [tv] TV and Android TV Box TLS: TOFU certificate pin (no trust-all)
- [phone] TV and Android TV Box TLS: TOFU pin; cleartext to public IPs blocked; ControlServer accepts LAN only
- phone-to-TV pairing code is 6 digits
- [tech] CI: Actions pinned to commit SHAs; ADMIN_CHAT_ID is a Worker secret only

## 0.20.1-beta.10

- same as beta.8 (beta.9: changelog window; build - CatalogClient.home stub in overflowHarness)

## 0.20.1-beta.9

- same as beta.8 (release failed: changelog window pushed out the 0.17.0 news feed rename)

## 0.20.1-beta.8

- [phone] Now playing: full-width poster from the top of the screen, soft fade into the background; screen and swipes stay portrait-only
- [phone] backup: TorrServer update skip stays on-device (unblocks the beta.7 build)

## 0.20.1-beta.7

- [phone] Discover: TMDB-style home rails - trending, popular, in theatres, upcoming, on TV, top rated; sort and filters open the grid

## 0.20.1-beta.6

- [phone] Now playing: poster as a depth window - three layers at different speeds, top-aligned to width, bottom fades into the background

## 0.20.1-beta.5

- [phone] Now playing: poster with a 3D parallax tilt from the gyroscope and a finger, the picture shifts on its own layer

## 0.20.1-beta.4

- [phone] Discover: poster skeleton until loaded; no "new episode" badge on TMDB tiles
- [phone] History: phone/TV filter as a segment inside the list; chips in one horizontal row
- [phone] Add: magnet as a button, not a link; sources and filters in one row
- [phone] Settings: one yellow update CTA; Wi-Fi as grey text; Video player on its own screen

## 0.20.1-beta.3

- same as beta.1 (release failed: ompJackett test types)

## 0.20.1-beta.2

- same as beta.1 (release failed: changelog window dropped 0.17.0)

## 0.20.1-beta.1

- [phone] OMP Jackett and JacRed: search and download only through billing (`/v1/search`, `/v1/torrent`); keys removed from the APK
- [tech] «Services» tab - Jackett/JacRed/TorrServer health, enable/disable for subscribers, masked secrets
- [tech] bot: user vs admin pads (`/admin`, «As user»)
- [tech] user card - message in Telegram; support chat scroll; page scrollbar hidden in the admin UI
- [tech] VPS: WARP proxy for the Telegram Bot API; search rate limit

## 0.20.0

- [atv] Built-in player on the 2160 Player engine: 4K, HDR, Dolby Vision as HDR10 without a DV decoder; AC3/E-AC3/DTS/TrueHD passthrough or FFmpeg decode; more formats (M2TS, software decode). VLC and Auto remain
- [atv] Night audio (yellow key and player menu); Info panel - remote Info key and menu
- [phone] Watch on the phone - built-in 2160 Player in OMP (resume, Skip marks, episodes, PiP). Video player: Built-in / 2160 Player / Android picker. Background audio
- [phone] Series card in Discover: dates and status, genres, Watch on TV, creators and cast, seasons on their own screen, similar titles, poster pick; season card with progress
- [phone] Now on TV: swipe down for the remote, up for the release’s episodes, sideways on an episode to play on the TV; swipe hints; remote settings from the deck
- [phone] TV keyboard overlays the remote; fast native TorrServer LAN search (ports 8090 and 5665)
- [phone] Jackett and JacRed OMP on one subscription (keys in the app, search over HTTPS); @OMPBILLINGBOT - payment, code, Telegram link

## 0.20.0-beta.19

- same as beta.18 (release failed: Now on TV seek and the changelog window)

## 0.20.0-beta.18

- [phone] TorrServer search on start: native multithreaded TCP scan of the /24 (ports 8090 and 5665), then a short /echo only on open ports
- [phone] Now on TV: swipe hints (remote / episodes), episode swipe with highlight; remote settings open from the deck too
- [phone] TV keyboard overlays the remote without shrinking the pad
- [tech] support chat shows the Telegram nick next to the user id; “End dialog” notifies the bot

## 0.20.0-beta.17

- [phone] Jackett and JacRed on one subscription: keys in the app, search over HTTPS
- [tech] admin panel sign-in through Telegram (adminTelegramIds); password stays as a fallback

## 0.20.0-beta.16

- same as beta.15 (release failed: typecheck)
- [phone] Watch on TV labels the episode S01E01 again

## 0.20.0-beta.15

- same as beta.13-14 (release failed: the in-app changelog window dropped 0.17.0)

## 0.20.0-beta.14

- same as beta.13 (release failed: card and Telegram tests)
- [phone] A chosen series poster is kept in the settings backup

## 0.20.0-beta.13

- [phone] Series card in Discover: dates and status, all genres, Watch on TV, creators and cast apart, each season on its own screen, similar titles, poster choice
- [phone] Season card: its own poster, episodes with file size or air date, a progress bar
- [phone] Now on TV: swipe down opens the remote, swipe up the episodes of this release, swipe an episode sideways to play it on the TV

## 0.20.0-beta.12

- same as beta.10-11 (release failed: billingPost type)

## 0.20.0-beta.11

- same as beta.10 (release failed: CHANGELOG/backup tests)

## 0.20.0-beta.10

- [phone] Jackett OMP: subscription end date refreshes from the server after admin grants days
- [phone] Billing: prefer https://billing.omp-player.online, fall back to the NAS on LAN
- [tech] React+shadcn admin; alerts always visible; Cloudflare Tunnel (HTTP/2) for omp-player.online

## 0.20.0-beta.9

- same as beta.7-8 (beta.8 had broken Cyrillic in the update notes)

## 0.20.0-beta.8

- same as beta.7 (release built, but the What’s new text had a bad encoding)

## 0.20.0-beta.7

- [tech] Admin panel on Preact + Pico; SQLite storage (migrates from state.json)
- [phone] Jackett OMP shows Telegram link status and can unlink
- [phone] Settings: sources and TV first, then server, player, and updates

## 0.20.0-beta.6

- [phone] Link Telegram to the device and a subscription cabinet; a code from the bot opens OMP and fills itself in (`omp://billing`)
- [ops] User and admin cabinets in @OMPBILLINGBOT; «Open in OMP» link; OMP Billing tile in ZimaOS
- [phone] A deep-link subscription code is excluded from the settings backup

## 0.20.0-beta.5

- same as beta.6 (release did not build: backup allowlist test)

## 0.20.0-beta.4


- [phone] OMP Jackett: enter a subscription code and search through the server with no address or key on the phone; a link to the @OMPBILLINGBOT bot for payment and the code
- [ops] @OMPBILLINGBOT: Status, Subscribe, Renew, Promo, Code, Help buttons; 1-day promos; admin panel with promos and summary

## 0.20.0-beta.2

- [phone] The built-in player keeps the screen on while a video is playing
- [phone] The season card and the release card always show the current seeds and peers, including zeros
- [tv] The series screen shows the current seeds and peers of the release under the season
- [phone] A long release title fits the header: the header grows with the text, up to six lines
- [phone] When a release has no poster of its own, the season shows the season or series poster from TMDB
- [phone] On the server screen, a TorrServer that is installed on the phone but stopped can be started. When the network scan finds nothing, OMP offers to install TorrServer on this device

## 0.20.0-beta.1

- [atv] A new engine for the built-in player: 2160 Player inside OMP. 4K and HDR; Dolby Vision on a box without a Dolby Vision decoder plays as HDR10. AC3, E-AC3, DTS and TrueHD go to the receiver as they are, and when the TV does not accept them they are decoded, with no switch to VLC. More formats: Blu-ray M2TS remuxes (TrueHD, LPCM, DTS-HD), and video the box cannot decode in hardware is decoded in software. VLC and the Auto mode stay. The APK is about 20 MB larger for it (the universal one 30 MB)
- [atv] Night sound on the yellow key and in the player menu: loud scenes are quieter, dialogue is clearer. While it is on the sound is stereo; turn it off and the receiver gets multichannel again. The choice is remembered
- [atv] The player's Info panel is on the remote's Info key and in the player menu (yellow now turns night sound on and off)
- [phone] "Watch on the phone" opens the built-in 2160 Player screen right inside OMP: from the resume point, with the Skip marks, all episodes of the release and the next episode, and picture-in-picture. Video player: "Built-in" (the default), "2160 Player (app)" or "Android chooser". The APK is about 20 MB larger for it (the universal one 30 MB)
- [phone] "Background audio" under Video player: the sound keeps playing with the screen off and after the picture-in-picture window is closed, with controls in the notification shade and on the lock screen. Off by default

## 0.19.0

- [tv] Cast and directors on Discover cards and the series and movie screens: press one for the filmography with a biography; titles already in Library are highlighted, with an «In library» filter
- [phone] Cast and directors with filmography and biography, on Discover and on the series and movie screens in Library
- [tv] Default dub per series: OMP remembers the dub picked in the player for the next episodes; shown and changeable on the series screen ("Dub: HDRezka · 5.1")
- [tv] Colour keys in the player: red for dub, green for subtitles, yellow for Info, blue for the menu; the Info panel shows HDR, codec, seeds, speed, bitrate and buffer
- [phone] The Android TV remote drives the whole box: Home, volume, menu and media keys, via Google TV Remote with the code from the screen or via network debugging
- [phone] Rename a TV by long-pressing its name on the Remote screen
- [tv] Release search: "Movie" / "Series · S02 · 1-8 of 8" badges and an "All / Movies / Series" filter
- [phone] Release search: badges and the "All / Movies / Series" filter, and "Watch on the phone" on found releases
- [tv] Series and release screens: the announced episodes after the last one ("S02E08 · out Oct 8"); season chips read "10 episodes · watched 1"
- [tv] The TorrServer address has OMP's own keypad (digits, ".", ":", http://, https://) and is cleaned of TV-keyboard look-alikes; Android TV hints about a VPN when no server answers
- [phone] The server address has OMP's own keypad docked at the bottom
- [atv] 2160 Player as the video player (Settings, Video player): with the resume point, skipped intros and all episodes of the release
- [tv] Discover cards and the series screen: the backdrop spans the top of the screen with soft fades
- [tv] The device name under the logo ("Dune HD", the TV's name); top bar button labels show as a chip under the button
- FAQ: connecting and installing on Xiaomi, "The TV cannot reach TorrServer but the phone can"; betas have a BETA band on the icon

## 0.18.2

- Updates are checked at every OMP launch and when you come back to the app (before: at most once in 6 hours, so a new version could stay unnoticed for long)
- While an update is not installed, «Settings» carries a dot, and Settings shows a button with the new version instead of «Check for updates», also after «Later»

## 0.18.0

- [tv] The TV library works like the phone's: short titles, a series is one tile, a series screen with the TMDB overview, status and episode names
- [tv] «Discover» on the TV: new releases from TMDB, film and series cards, «Want to watch» and «In better quality»
- [lg] The LG TV searches torrent sites through the phone: RuTracker, NNM-Club, Kinozal and others, with your sign-ins
- [tv] «New» and «Subscriptions» on the TV: OMP's findings from the phone - new episodes, better quality, torrents for subscriptions
- [phone] «Search for the TV»: the phone searches torrents and watches subscriptions for the TV in the background

### Library and series on the TV

- [tv] TV (LG and Android TV): library tiles show short titles instead of the tracker string; a series is one tile with its TMDB status («Airing», «Ended», «Canceled») and the number of torrents
- [tv] Header icons show their name when selected; the hint bar no longer covers the last row
- [tv] A new series screen: a TMDB backdrop, overview, status with the next episode date, seasons switched with the remote, episode names, progress. «Watch» continues where you stopped and asks «Continue / From the start», «Torrents · N» opens the series' torrents
- [tv] On the torrent screen you can rename a torrent and pick another poster from TMDB
- [tv] «Help» in Settings: answers to common questions right on the TV, links shown as QR codes

### «Discover» and «Want to watch»

- [tv] On the TV: the «Discover» tab shows new releases from TMDB with sort and filters (genre, year, country, rating), title search and an «In the library» mark on the ones you already have
- [tv] A title card for films and series: overview, rating, cast, seasons with «Find torrents», «Open in the library»
- [tv] The «Want to watch» list on the TV: the yellow key on a tile adds to it, the «Want» filter shows it
- [tv] «In better quality» on the torrent and series screens: finds a better release and replaces the old one keeping watch positions, or adds it alongside

### Torrent search through the phone

- [phone] «Search for the TV» in Settings: the phone searches torrents for the LG TV in the background, even with OMP closed, with a quiet status-bar icon
- [lg] The LG TV searches torrent sites through the phone (RuTracker, NNM-Club, Kinozal and others, with your sign-ins), even when OMP is closed on the phone; the phone gets a «Search for the TV» switch and a quiet notification
- [lg] A new search screen on the TV: quality badges, posters, sorting, «also on ...», «already in the library»
- [lg] «Search sources» on LG: the phone's sites with their state and switches
- [lg] Without a phone the TV searches through TorrServer (Rutor, Jackett) and says so

### «New» and subscriptions

- [tv] «New» on the TV: OMP's findings from the phone, with new episodes, better quality and torrents for subscriptions; new episodes replace the old season torrent right away, «Replace» swaps in the better one - watch positions are kept
- [tv] «Subscriptions» on the TV: check now, notify on/off, «in better quality», remove
- [tv] «Follow new episodes» and «follow better quality» work right from the TV; «Want to watch» on the TV becomes an OMP subscription on the phone
- [atv] The «Control from the phone» badge in the Android TV player now shows briefly on a phone command instead of all the time
- [phone] The TV sees the phone's subscriptions and findings (through «Search for the TV»)

## 0.17.0

- [phone] «Discover» in «Catalog»: new films and series from TMDB, sorting and filters
- [phone] «Mine»: one series, one card; the series screen with its status and episode names
- [phone] An episode «Calendar» and digital release dates on tiles and cards
- [phone] «Find in better quality» for films and series: replacing in place keeps your watch positions
- [phone] A new LG-style «Remote»: D-pad, colour keys, volume, «Back», «Home», «Menu»
- [phone] Search filters for torrents: resolution, HDR, source, voice-over, subtitles, season
- [phone] Install assistant and FAQ: how to put OMP on Xiaomi, Sber and Yandex TVs and boxes

### Catalog and «Discover»

- [phone] Two-finger zoom in «Catalog» and «Discover» (2, 3 or 4 posters per row): one step per gesture with a smooth transition - cards move to their new places and the text stays sharp
- [phone] «Catalog»: delete from the menu on a long press, with several torrents selectable at once
- [phone] Scrolling: «Back» and the tabs return to the same place; on the TV the focus returns to the item you left, and scrolling inside a window no longer scrolls the screen behind it
- [phone] «Back»: on other tabs it opens «Catalog», in «Discover» it goes to «Mine», on «Mine» a second press minimizes OMP
- [phone] Tab header: one compact row on all tabs; the status bar (clock, battery) no longer blends into the posters while scrolling
- [phone] «Discover» in «Catalog»: the «Mine / Discover» switch shows new films and series from TMDB, with search by title. A card has the description, the rating and the cast, and a series has season chips with the list of episodes. «Find torrents» (for a film or a season) searches your sources, «Open in library» leads to what you already have, «Want to watch» subscribes you to a torrent in «New». It needs a TMDB key in the TorrServer settings (or its mirror)
- [phone] «Discover»: sorting (popular, by rating, by release date, most anticipated) and filters (genre, year, country, minimum rating); talk shows, news and reality are hidden by default; type and year under the poster, long titles neatly cut at two lines; after you come back from a card, «Discover» stays where it was

### Dates and «Calendar»

- [phone] «New» → «Calendar»: the episodes of the next 30 days by day for the series in «Mine» and subscriptions; several episodes of a day in one row «S13E07-E08»; the ones out are marked «out» - «Watch» or «Find»
- [phone] «Discover»: dates on the tiles - «digital Nov 12», «in cinemas since Oct 3», «new episode Oct 8»; the «Digital soon» sort lists films by their digital date in the next 60 days
- [phone] Film card: «Cinema · Digital · Disc» with dates; series card: «Upcoming episodes»; the series screen shows announced episodes as muted rows «7. Pyramid · out Oct 8»
- [phone] A release's category is checked by itself: a series in «Films» moves to «Series», an album to «Music»

### Android TV and boxes

- [tv] Boxes with an old system WebView (for example Dune HD) no longer open on a blank screen, and the remote moves the focus
- [tv] 4K on boxes with little memory no longer stops after 10 seconds; if VLC cannot start a file, the player offers to go back to the built-in one
- [tv] A clear error for a wrong TorrServer address; a box names itself «maker model» instead of a code
- [tv] «What's new» lists only what concerns this device
- [tv] The colour keys of a box remote work as on LG; before an update OMP explains where to allow the install and continues it by itself when you come back

### Mine and series

- [phone] «Mine»: short, readable titles instead of the tracker string («Dark Matter · season 2 · episodes 1-6 of 10»), a compact header - the «Mine / Discover» switch shares a row with the buttons, smaller chips
- [phone] «Mine»: a series' seasons are grouped into one card, by any of their names, including torrents titled only in English or with the English name after brackets («Russian name (season 3…) / Star Trek…»); different series sharing a network or a voice-over («/ AMC», «/ BBC») stay apart; the card takes its name in the interface language (English in English, Russian in Russian)
- [phone] The torrent card is compact: poster, three lines, round ＋ and ▶TV; details, category and the full title are in a sheet on tap
- [phone] The series screen: a TMDB backdrop, years · rating · genres, overview, seasons with episode count and year, missing seasons with «Find torrents»
- [phone] Series screen: a long press on a torrent - «Open», «Watch on TV», «Rename», «Delete» and «Keep only this one» (deletes the season's other torrents, never multi-season packs)
- [phone] Watching an episode counts in every torrent of the series: watched S04E01 in 1080p - it is marked in 4K too, and «Watch on TV» goes on with the next one
- [phone] Torrent screen: episode names from TMDB, season chips to switch seasons; «Skip» is folded into one row, and there is a single «Monitoring» block
- [phone] «Find in better quality» for films and series: a warning when seeds are few, a note for multi-season packs, clear reasons when it fails, «Cancel»; replacing in place keeps your watch positions

### Search and sources

- Search filters for torrents: resolution, HDR, source, «Hide camrips», size, seeds, voice-over, Russian subtitles, season
- «Add»: search first, the magnet link is tucked behind «Add by magnet link» under it and opens the field in place
- «Search sources»: one row style - only › and the switch on the right, «Sign in» and «Sign out» as a link in the status line; «Sign in» right on the site row (Kinozal, rustorka, NNM-Club), rutracker gets its site screen too (including «Send the sign-in to the TV»); one list of sites, short hints under a site that Cloudflare has blocked. «No account? Sign up» on the phone, a QR code on the TV
- Browser sign-in on NNM-Club: an ad on the site's page no longer pulls the sign-in window away - taps on the fields work and the keyboard opens; the sign-in page fits the screen width and can be zoomed with two fingers
- torrent.by: works on the phone (the site leaves out an intermediate certificate, OMP now carries it itself; a certificate error says «Site certificate error» instead of «not responding»); a clear message when it has blocked your IP and an «Enter the code» button; fewer background requests
- rutracker: a lost sign-in now asks to «Sign in» instead of «The site is closed by a browser check»; rutracker can pass the Cloudflare check like Kinozal and NNM-Club; the log shows why a site failed (response code, sign-in or check page)
- In the FAQ: «What is «Discover»», «Search filters for torrents», «Better quality», «torrent.by asks for a code»; the answers about Cloudflare, sign-in and accounts are updated (NNM-Club too)

### New and monitoring

- [phone] «Better quality»: for subscriptions («Better quality only») and for films from the catalog OMP reports when a torrent in better quality is out. «Replace» right from the notification; a «Better quality» section in «New»; switches in «Monitoring», in the subscription and in the film card
- [phone] Subscriptions: search over subscriptions and found torrents, sorting, «Check now» for a single subscription; «Monitoring settings» is the gear in the «New» header and a button at the bottom
- [phone] «New»: the buttons are round, refresh replaces «Check now», and monitoring is a separate icon; in «New» and in search results: short titles, quality badges and posters

### Remote

- [phone] «Remote» connects to the last TV by itself, says when a TV does not answer, and switches between several TVs and boxes with one tap
- [phone] «Remote», «Buttons» mode, like an LG remote: D-pad, colour keys (red, green, yellow, blue), round «Back», «Home», «Menu», a volume rocker, «Pause» with ±10 s and a «Keyboard / Mute» rocker; the colour keys and «Mute» work on LG TVs. The header matches the other tabs («Remote», the TV name and state); in «Touchpad» mode the pad takes the free space, with «Back · Home · Menu · Keyboard», playback keys and volume below
- [phone] The touchpad has no scroll strip: scrolling the page on the TV is a two-finger scroll

### Fixes

- Content no longer hides under the tab bar, the bar hides while the keyboard is open and stays above the cards
- «Name (2026)» in «Mine» reads «Name · 2026»; the series screen opens on the requested season
- In the English interface a series badge in «Mine» could say «new season» instead of the next episode date - the series was searched on TMDB by its Russian name
- The chips of the chosen filters in «Add» («4K», «seeds ≥ 20») centre their text like the others

## 0.17.0-beta.8

- [phone] «Remote» connects to the last TV by itself: a TV that is saved but not selected (after the install assistant or a settings restore) no longer needs a trip to «Settings → TV»
- [phone] When the TV does not answer, «Remote» says «… does not answer - turn the TV on» with «Retry»
- [phone] Several TVs and boxes: tap the name in «Remote» for the saved list and switch with one tap, without pairing again

## 0.17.0-beta.7

- Android TV boxes with an old system WebView (for example Dune HD) no longer open OMP on a blank screen, and the remote moves the focus on them
- 4K on boxes with little memory (128 MB per app) no longer stops after 10 seconds with «Could not play the video»; if memory still runs out, «Auto» continues the video in VLC at the same place
- [tv] If VLC cannot start a file within 20 seconds, the player offers «Back to the built-in player» or waiting
- [tv] Connecting to TorrServer: a wrong address or port shows «Could not connect to … - check the address and port» instead of nothing; the address field opens a Latin keyboard for addresses
- [tv] A box names itself by the device name from its settings or «maker model», not a code like «tv175v»
- [tv] A site behind a Cloudflare check in TV search is one short sentence: sign in on the phone in «Search sources»
- «What's new» lists only what concerns this device: TV changes on the TV, phone changes on the phone
- [phone] «Digital soon»: films are ordered by their digital date, every tile has a date, old films show their real year
- [phone] «Calendar»: no repeated date on the right, no placeholder names like «Episode 7», several episodes of a day in one row «S13E07-E08»
- [phone] «Mine»: series show a clean name («Dark Matter», season and episodes on the line below), no «· 2 releases» in the name; dates everywhere as «Oct 8»
- [phone] Series screen: episodes show the code and size without the file name; announced episodes of the season follow as muted rows «7. Pyramid · out Oct 8»
- [phone] «Now on TV», the mini player and «Where to watch?» name the series and the episode («Dark Matter · S02E01 · Quiet Life»), not the file
- [phone] The release menu on a long press names the quality («Spirit Master · 4K WEB-DL»); sizes everywhere as «5.1 GB»
- [phone] «Search sources»: spacing between sections, an opaque backing under the status bar, a clearer Jackett card («key from TorrServer» - «Connect» connects at once)
- [phone] Small things: no «0 seeds» when the number is unknown; text links stand out; the keyboard closes after a search; the «Connect TV» button on «Remote» is centred

## 0.17.0-beta.6

- [phone] «New» → «Calendar»: the episodes of the next 30 days by day («Today», «Tomorrow», «Thu, Oct 8») for the series in «Mine» and series subscriptions; the ones out in the last 3 days are marked «out» - «Watch» when monitoring already found a release, «Find» otherwise; pull down to refresh
- [phone] «Discover»: dates on the tiles - «digital Nov 12», «in cinemas since Oct 3», «new episode Oct 8», «season 2 - Nov 15»
- [phone] «Discover»: a new «Coming to digital» sort - films released digitally in the next 60 days
- [phone] Film card: «Cinemas · Digital · Disc» release dates (the ones to come highlighted); series card: «Upcoming episodes» with dates
- [phone] «Add»: when a site is behind a Cloudflare check, lost its sign-in or fails its certificate, the warning has an «Open … settings» button that goes straight to that site's page with «Sign in» and the check bypass
- [phone] Several releases of one thing: on the series screen, a season with two or more releases shows each one's quality, episode (or file) count and size - a tap opens the release menu; after an add OMP says «Already in the library: 4K · 9.7 GB» (films too). OMP never deletes anything by itself. A release with episode files filed under «Movies» joins its series card
- The torrent category is checked automatically: a series with episodes filed under «Movies» moves to «Series», an album to «Music», an empty category is filled; a category picked by hand in «Add» is never changed; each fix is a line in the log

## 0.17.0-beta.5

- [phone] «Remote», «Buttons» mode, like an LG remote: D-pad, colour keys (red, green, yellow, blue), round «Back», «Home», «Menu», a volume rocker, «Pause» with ±10 s and a «Keyboard / Mute» rocker; the colour keys and «Mute» work on LG TVs
- [phone] «Mine»: a series' torrents form one card by any of their names, even when the English one comes after brackets («Russian name (season 3…) / Star Trek…»); different series sharing a network or a voice-over («/ AMC», «/ BBC») stay apart
- [phone] A series card takes its name in the interface language: the English name in English, the Russian name in Russian
- rutracker: a lost sign-in now asks to «Sign in» instead of «The site is closed by a browser check»; rutracker can pass the Cloudflare check like Kinozal and NNM-Club; the log shows why a site failed (response code, sign-in or check page)

## 0.17.0-beta.4

- [phone] A new «Remote»: the header matches the other tabs («Remote», the TV name and state), a big D-pad with side keys - keyboard and «Back» on the left, volume on the right; in «Touchpad» mode the pad takes the free space, with «Back · Home · Menu · Keyboard», playback keys and volume below
- [phone] Series screen: a long press on a torrent - «Open», «Watch on TV», «Rename», «Delete» and «Keep only this one» (deletes the season's other torrents, never multi-season packs)
- [phone] Watching an episode counts in every torrent of the series: watched S04E01 in 1080p - it is marked in 4K too, and «Watch on TV» goes on with the next one
- [phone] «Back»: on other tabs it opens «Catalog», in «Discover» it goes to «Mine», on «Mine» a second press minimizes OMP
- [phone] Fixed: in the English interface a series badge in «Mine» could say «new season» instead of the next episode date - the series was searched on TMDB by its Russian name

## 0.17.0-beta.3

- [phone] «Mine»: a series torrent titled only in English («Star Trek: Strange New Worlds / S2…») now joins the card of the torrents titled «Russian / Original»; the card takes its title from the torrent named in both languages
- [phone] The status bar (clock, battery) no longer blends into the posters while scrolling - a dark strip lies under it
- [phone] Fixed: the chips of the chosen filters in «Add» («4K», «seeds ≥ 20») centre their text like the others

## 0.17.0-beta.2

- [phone] «Discover»: sorting (popular, by rating, by release date, most anticipated) and filters (genre, year, country, minimum rating); talk shows, news and reality are hidden by default; type and year under the poster, long titles neatly cut at two lines; 2, 3 or 4 posters per row
- [phone] «Mine»: short, readable titles instead of the tracker string («Dark Matter · season 2 · episodes 1-6 of 10»), a compact header - the «Mine / Discover» switch shares a row with the buttons, smaller chips
- [phone] Two-finger zoom in «Catalog»: one step per gesture with a smooth transition - cards move to their new places and the text stays sharp
- [phone] «Search sources»: one row style - only › and the switch on the right, «Sign in» and «Sign out» as a link in the status line; rutracker gets its site screen too (including «Send the sign-in to the TV»)
- [phone] torrent.by works on the phone again: the site leaves out an intermediate certificate, OMP now carries it itself; a certificate error says «Site certificate error» instead of «not responding»
- [phone] Browser sign-in: an ad on a site's page (NNM-Club, for example) no longer pulls the sign-in window away - taps on the fields work and the keyboard opens; the sign-in page fits the screen width and can be zoomed with two fingers
- [phone] Tab header: one compact row on all tabs. In «New» the buttons are round, refresh replaces «Check now», and monitoring is a separate icon
- [phone] «Add»: search first, the magnet link is tucked behind «Add by magnet link» under it and opens the field in place
- [phone] «New» and search results: short titles, quality badges and posters
- [phone] The torrent card is compact: poster, three lines, round ＋ and ▶TV; details, category and the full title are in a sheet on tap
- [phone] «Mine»: a series' seasons are grouped into one card. The series screen: a TMDB backdrop, years · rating · genres, overview, seasons with episode count and year, missing seasons with «Find torrents»
- [phone] Torrent screen: episode names from TMDB, season chips to switch seasons
- [phone] «Find in better quality» for films and series: a warning when seeds are few, a note for multi-season packs, clear reasons when it fails, «Cancel»; replacing in place keeps your watch positions
- [phone] Fixed: content no longer hides under the tab bar, the bar hides while the keyboard is open and stays above the cards; «Name (2026)» in «Mine» reads «Name · 2026»; the series screen opens on the requested season

## 0.17.0-beta.1

- [phone] “Discover” in “Catalog”: the “Mine / Discover” switch shows new films and series from TMDB, with search by title. A card has the description, the rating and the cast, and a series has season chips with the list of episodes. “Find torrents” (for a film or a season) searches your sources, “Open in library” leads to what you already have, “Want to watch” subscribes you to a torrent in “New”. The scale changes with two fingers (the view in “Mine”, 2 or 3 posters in “Discover”); after you come back from a card, “Discover” stays where it was. It needs a TMDB key in the TorrServer settings (or its mirror)
- [phone] Search filters for torrents: resolution, HDR, source, “Hide camrips”, size, seeds, voice-over, Russian subtitles, season
- [phone] “Better quality”: for subscriptions (“Better quality only”) and for films from the catalog OMP reports when a torrent in better quality is out. “Replace” right from the notification; a “Better quality” section in “New”; switches in “Monitoring”, in the subscription and in the film card
- [phone] Subscriptions: search over subscriptions and found torrents, sorting, “Check now” for a single subscription; “Monitoring settings” is the gear in the “New” header and a button at the bottom
- [phone] “Catalog”: delete from the menu on a long press, with several torrents selectable at once
- [phone] Torrent screen: “Skip” is folded into one row, and there is a single “Monitoring” block
- Search sources: “Sign in” right on the site row (Kinozal, rustorka, NNM-Club), sign-in with the browser on NNM-Club, one list of sites, short hints under a site that Cloudflare has blocked. “No account? Sign up” on the phone, a QR code on the TV, answers in the FAQ. torrent.by: a clear message when it has blocked your IP and an “Enter the code” button; fewer background requests
- Scrolling: “Back” and the tabs return to the same place; on the TV the focus returns to the item you left, and scrolling inside a window no longer scrolls the screen behind it
- [phone] Phone remote: the scroll strip on the touchpad is removed - scrolling the page on the TV is a two-finger scroll
- [phone] In the FAQ: “What is “Discover””, “Search filters for torrents”, “Better quality”, “torrent.by asks for a code”; the answers about Cloudflare, sign-in and accounts are updated (NNM-Club too)

## 0.16.0

- English: the whole app on the phone, LG and Android TV, the native Android screens, notifications, the FAQ and What's new. The language follows the device or is chosen in Settings → Language; the phone passes it to the TV
- Update installation errors are shown as one clear message

## 0.16.0-beta.1

- English: the whole app on the phone, LG and Android TV, the native Android screens, the FAQ and What's new. The language follows the device or is chosen in Settings → Language; the phone passes it to the TV

## 0.15.5

- Beta versions: a "Get beta versions" switch (on the phone: Settings → "Update"; on the TV: "Update" → "Beta versions"). A beta arrives as a regular update, and when the stable version is released it replaces the beta; with the switch off, the beta stays until the next stable version
- The FAQ now covers beta versions

## 0.15.4

- The built-in TorrServer is updated to MatriX.145.2

## 0.15.3

- Phone remote: the touchpad now has a scroll strip on the right. Slide a finger up or down along it to scroll the page on the TV; turn it off in the touchpad settings ("Scroll strip")

## 0.15.2

- "Sign in with browser" on rutracker: the window closes by itself after you sign in (OMP could not see the sign-in that rutracker keeps for the forum only)
- Password sign-in blocked by a Cloudflare check (Kinozal, rustorka, rutracker): the hint "The site is blocked by a Cloudflare check - sign in with the browser", and the "Sign in with browser" button becomes the main one, on the phone and on the TV

## 0.15.1

- Phone: the Back button closes an open list or window (search sources, sorting, tracker sign-in and others) instead of minimizing the app
- "Sign in with browser" (rutracker, Kinozal, rustorka): the window says it will close by itself after you sign in; while OMP checks the sign-in it shows "Checking sign-in…"; if the sign-in is not confirmed, a message and a "Check again" button appear; after sign-in, "Signed in to …"

## 0.15.0

- Android TV: a choice of two players, the built-in one (now with the FFmpeg decoder: DTS, AC3, E-AC3, TrueHD) and VLC (ASS subtitles with styles, almost all formats); Settings → "Player", where the "Auto" mode switches to VLC when needed
- Jackett and Prowlarr directly: OMP finds them on the network, shows the state of each tracker and passes the connections to Android TV
- Kinozal and rustorka are back: sign-in, including "Sign in with browser" for a captcha, Kinozal mirrors, passing the sign-in to the TV
- Bypassing the Cloudflare check for these sites (a switch, off by default): with a hidden window, FlareSolverr as a fallback, a checkbox on the screen; on the TV, "Pass on the phone"
- APKs per architecture: arm64, armv7 and a universal one; all builds are published in the Telegram channel
- The built-in TorrServer is no longer part of the APK: on first launch on the phone, OMP downloads it from GitHub (about 61 MB, better over Wi‑Fi) and verifies the checksum; on Android 10 and newer the server is started through the system loader, and Settings shows "Update" when a new version is released
- Player on the TV: the player menu item "Player: Built-in → switch to VLC" changes the player for one torrent and remembers the choice; switching keeps the position, audio and subtitles, and the journal entry has no file name. If VLC cannot start on the device, the "VLC" item is inactive. "Play" after the end of an episode starts the next one, and a minute before the end TorrServer prepares the next episode in advance
- Audio: the built-in player first uses the hardware decoder or passthrough to the receiver and only then FFmpeg; VLC always decodes audio to PCM
- Jackett and Prowlarr: Settings → "Search sources" → "Indexers", a network search once a day and with the "Search the network" button (on mobile data it suggests connecting to Wi‑Fi), the API key is kept in secure storage and never reaches the journal or the backup, states "works", "sign-in needed", "Cloudflare", "not responding", "state unknown" (Jackett with a password); the "Torznab (TorrServer)" source is hidden when the same Jackett is connected directly
- Cloudflare: the bypass can be turned on for each site separately, with a warning that it may violate the site's rules; the state "check passed · valid until …"; a request from the TV arrives on the phone as the notification "The TV asks to pass a check"; FlareSolverr: address, "Find on the network", "Check", and a Docker guide in the FAQ
- Kinozal and rustorka: off by default, each has a page with sign-in and the Cloudflare bypass; the login and password are stored encrypted, a browser sign-in lasts about 30 days; connections, sign-ins and Cloudflare switches are passed to Android TV with the "Send to TV" button
- Clear names: if a torrent has a technical name (a hash, a folder name), OMP picks a readable one from its files; on the phone the torrent card has "Rename"
- In-app hints: instead of "connect through Jackett", they point to the Cloudflare bypass switch and to Jackett or Prowlarr; on a captcha at sign-in, "Sign in with browser" is offered
- Releases: in the Telegram channel every build up to 50 MB is attached as a file, larger ones as a link to GitHub
- FAQ: about the player (built-in and VLC, "Auto", DTS and passthrough), "Which APK to download", Jackett and Prowlarr directly, FlareSolverr, Cloudflare and "Pass on the phone", signing in to Kinozal and rustorka, clear names
