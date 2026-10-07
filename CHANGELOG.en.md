# Changes

The English translation covers the latest versions only; the full history (in Russian) is in [CHANGELOG.md](CHANGELOG.md).

## 0.19.0-beta.3

- [tv] «Cast» on the torrent screen of a series that has a single torrent in the library (for example «Dark Matter»)
- [phone] «Cast» on the torrent screen of a series that has a single torrent in the library (for example «Dark Matter»)
- [tv] Biographies keep their paragraphs; the screen no longer jumps while «Cast» loads
- [phone] Biographies keep their paragraphs, no extra gap at the top of the person screen; the screen no longer jumps while «Cast» loads

## 0.19.0-beta.2

- [tv] Cast and director screen: biography, filters in one row, opens in «Discover»; «Cast» on the series and movie screens sits right under the buttons
- [phone] Cast and director screen: biography, filters in one row, opens in «Discover»; «Cast» on the series and movie screens sits right under the buttons, with proper margins

## 0.19.0-beta.1

- [tv] Cast and directors on «Discover» cards and on the series and movie screens: press one to open the filmography; titles already in «Mine» are highlighted and come first, with an «In library» filter
- [phone] Cast and directors on «Discover» cards and on the series and movie screens: tap one to open the filmography; titles already in «Mine» are highlighted and come first, with an «In library» filter
- [atv] 2160 Player as the video player (Settings → «Video player»): resumes where you stopped, skips intros and credits, plays all episodes of the torrent
- [phone] «Watch on the phone» through 2160 Player when chosen in Settings: the watch position comes back to OMP

## 0.18.2

- Updates are checked at every OMP launch and when you come back to the app (before: at most once in 6 hours, so a new version could stay unnoticed for long)
- While an update is not installed, «Settings» carries a dot, and Settings shows a button with the new version instead of «Check for updates», also after «Later»

## 0.18.0

- [tv] The TV library works like the phone's: short titles, a series is one tile, a series screen with the TMDB overview, status and episode names
- [tv] «Discover» on the TV: new releases from TMDB, film and series cards, «Want to watch» and «In better quality»
- [lg] The LG TV searches torrent sites through the phone: RuTracker, NNM-Club, Kinozal and others, with your sign-ins
- [tv] «New» and «Subscriptions» on the TV: OMP's findings from the phone — new episodes, better quality, torrents for subscriptions
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

- [tv] «New» on the TV: OMP's findings from the phone, with new episodes, better quality and torrents for subscriptions; new episodes replace the old season torrent right away, «Replace» swaps in the better one — watch positions are kept
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

- [phone] Two-finger zoom in «Catalog» and «Discover» (2, 3 or 4 posters per row): one step per gesture with a smooth transition — cards move to their new places and the text stays sharp
- [phone] «Catalog»: delete from the menu on a long press, with several torrents selectable at once
- [phone] Scrolling: «Back» and the tabs return to the same place; on the TV the focus returns to the item you left, and scrolling inside a window no longer scrolls the screen behind it
- [phone] «Back»: on other tabs it opens «Catalog», in «Discover» it goes to «Mine», on «Mine» a second press minimizes OMP
- [phone] Tab header: one compact row on all tabs; the status bar (clock, battery) no longer blends into the posters while scrolling
- [phone] «Discover» in «Catalog»: the «Mine / Discover» switch shows new films and series from TMDB, with search by title. A card has the description, the rating and the cast, and a series has season chips with the list of episodes. «Find torrents» (for a film or a season) searches your sources, «Open in library» leads to what you already have, «Want to watch» subscribes you to a torrent in «New». It needs a TMDB key in the TorrServer settings (or its mirror)
- [phone] «Discover»: sorting (popular, by rating, by release date, most anticipated) and filters (genre, year, country, minimum rating); talk shows, news and reality are hidden by default; type and year under the poster, long titles neatly cut at two lines; after you come back from a card, «Discover» stays where it was

### Dates and «Calendar»

- [phone] «New» → «Calendar»: the episodes of the next 30 days by day for the series in «Mine» and subscriptions; several episodes of a day in one row «S13E07–E08»; the ones out are marked «out» — «Watch» or «Find»
- [phone] «Discover»: dates on the tiles — «digital Nov 12», «in cinemas since Oct 3», «new episode Oct 8»; the «Digital soon» sort lists films by their digital date in the next 60 days
- [phone] Film card: «Cinema · Digital · Disc» with dates; series card: «Upcoming episodes»; the series screen shows announced episodes as muted rows «7. Pyramid · out Oct 8»
- [phone] A release's category is checked by itself: a series in «Films» moves to «Series», an album to «Music»

### Android TV and boxes

- [tv] Boxes with an old system WebView (for example Dune HD) no longer open on a blank screen, and the remote moves the focus
- [tv] 4K on boxes with little memory no longer stops after 10 seconds; if VLC cannot start a file, the player offers to go back to the built-in one
- [tv] A clear error for a wrong TorrServer address; a box names itself «maker model» instead of a code
- [tv] «What's new» lists only what concerns this device
- [tv] The colour keys of a box remote work as on LG; before an update OMP explains where to allow the install and continues it by itself when you come back

### Mine and series

- [phone] «Mine»: short, readable titles instead of the tracker string («Dark Matter · season 2 · episodes 1–6 of 10»), a compact header — the «Mine / Discover» switch shares a row with the buttons, smaller chips
- [phone] «Mine»: a series' seasons are grouped into one card, by any of their names, including torrents titled only in English or with the English name after brackets («Russian name (season 3…) / Star Trek…»); different series sharing a network or a voice-over («/ AMC», «/ BBC») stay apart; the card takes its name in the interface language (English in English, Russian in Russian)
- [phone] The torrent card is compact: poster, three lines, round ＋ and ▶TV; details, category and the full title are in a sheet on tap
- [phone] The series screen: a TMDB backdrop, years · rating · genres, overview, seasons with episode count and year, missing seasons with «Find torrents»
- [phone] Series screen: a long press on a torrent — «Open», «Watch on TV», «Rename», «Delete» and «Keep only this one» (deletes the season's other torrents, never multi-season packs)
- [phone] Watching an episode counts in every torrent of the series: watched S04E01 in 1080p — it is marked in 4K too, and «Watch on TV» goes on with the next one
- [phone] Torrent screen: episode names from TMDB, season chips to switch seasons; «Skip» is folded into one row, and there is a single «Monitoring» block
- [phone] «Find in better quality» for films and series: a warning when seeds are few, a note for multi-season packs, clear reasons when it fails, «Cancel»; replacing in place keeps your watch positions

### Search and sources

- Search filters for torrents: resolution, HDR, source, «Hide camrips», size, seeds, voice-over, Russian subtitles, season
- «Add»: search first, the magnet link is tucked behind «Add by magnet link» under it and opens the field in place
- «Search sources»: one row style — only › and the switch on the right, «Sign in» and «Sign out» as a link in the status line; «Sign in» right on the site row (Kinozal, rustorka, NNM-Club), rutracker gets its site screen too (including «Send the sign-in to the TV»); one list of sites, short hints under a site that Cloudflare has blocked. «No account? Sign up» on the phone, a QR code on the TV
- Browser sign-in on NNM-Club: an ad on the site's page no longer pulls the sign-in window away — taps on the fields work and the keyboard opens; the sign-in page fits the screen width and can be zoomed with two fingers
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
- In the English interface a series badge in «Mine» could say «new season» instead of the next episode date — the series was searched on TMDB by its Russian name
- The chips of the chosen filters in «Add» («4K», «seeds ≥ 20») centre their text like the others

## 0.17.0-beta.8

- [phone] «Remote» connects to the last TV by itself: a TV that is saved but not selected (after the install assistant or a settings restore) no longer needs a trip to «Settings → TV»
- [phone] When the TV does not answer, «Remote» says «… does not answer — turn the TV on» with «Retry»
- [phone] Several TVs and boxes: tap the name in «Remote» for the saved list and switch with one tap, without pairing again

## 0.17.0-beta.7

- Android TV boxes with an old system WebView (for example Dune HD) no longer open OMP on a blank screen, and the remote moves the focus on them
- 4K on boxes with little memory (128 MB per app) no longer stops after 10 seconds with «Could not play the video»; if memory still runs out, «Auto» continues the video in VLC at the same place
- [tv] If VLC cannot start a file within 20 seconds, the player offers «Back to the built-in player» or waiting
- [tv] Connecting to TorrServer: a wrong address or port shows «Could not connect to … — check the address and port» instead of nothing; the address field opens a Latin keyboard for addresses
- [tv] A box names itself by the device name from its settings or «maker model», not a code like «tv175v»
- [tv] A site behind a Cloudflare check in TV search is one short sentence: sign in on the phone in «Search sources»
- «What's new» lists only what concerns this device: TV changes on the TV, phone changes on the phone
- [phone] «Digital soon»: films are ordered by their digital date, every tile has a date, old films show their real year
- [phone] «Calendar»: no repeated date on the right, no placeholder names like «Episode 7», several episodes of a day in one row «S13E07–E08»
- [phone] «Mine»: series show a clean name («Dark Matter», season and episodes on the line below), no «· 2 releases» in the name; dates everywhere as «Oct 8»
- [phone] Series screen: episodes show the code and size without the file name; announced episodes of the season follow as muted rows «7. Pyramid · out Oct 8»
- [phone] «Now on TV», the mini player and «Where to watch?» name the series and the episode («Dark Matter · S02E01 · Quiet Life»), not the file
- [phone] The release menu on a long press names the quality («Spirit Master · 4K WEB-DL»); sizes everywhere as «5.1 GB»
- [phone] «Search sources»: spacing between sections, an opaque backing under the status bar, a clearer Jackett card («key from TorrServer» — «Connect» connects at once)
- [phone] Small things: no «0 seeds» when the number is unknown; text links stand out; the keyboard closes after a search; the «Connect TV» button on «Remote» is centred

## 0.17.0-beta.6

- [phone] «New» → «Calendar»: the episodes of the next 30 days by day («Today», «Tomorrow», «Thu, Oct 8») for the series in «Mine» and series subscriptions; the ones out in the last 3 days are marked «out» — «Watch» when monitoring already found a release, «Find» otherwise; pull down to refresh
- [phone] «Discover»: dates on the tiles — «digital Nov 12», «in cinemas since Oct 3», «new episode Oct 8», «season 2 — Nov 15»
- [phone] «Discover»: a new «Coming to digital» sort — films released digitally in the next 60 days
- [phone] Film card: «Cinemas · Digital · Disc» release dates (the ones to come highlighted); series card: «Upcoming episodes» with dates
- [phone] «Add»: when a site is behind a Cloudflare check, lost its sign-in or fails its certificate, the warning has an «Open … settings» button that goes straight to that site's page with «Sign in» and the check bypass
- [phone] Several releases of one thing: on the series screen, a season with two or more releases shows each one's quality, episode (or file) count and size — a tap opens the release menu; after an add OMP says «Already in the library: 4K · 9.7 GB» (films too). OMP never deletes anything by itself. A release with episode files filed under «Movies» joins its series card
- The torrent category is checked automatically: a series with episodes filed under «Movies» moves to «Series», an album to «Music», an empty category is filled; a category picked by hand in «Add» is never changed; each fix is a line in the log

## 0.17.0-beta.5

- [phone] «Remote», «Buttons» mode, like an LG remote: D-pad, colour keys (red, green, yellow, blue), round «Back», «Home», «Menu», a volume rocker, «Pause» with ±10 s and a «Keyboard / Mute» rocker; the colour keys and «Mute» work on LG TVs
- [phone] «Mine»: a series' torrents form one card by any of their names, even when the English one comes after brackets («Russian name (season 3…) / Star Trek…»); different series sharing a network or a voice-over («/ AMC», «/ BBC») stay apart
- [phone] A series card takes its name in the interface language: the English name in English, the Russian name in Russian
- rutracker: a lost sign-in now asks to «Sign in» instead of «The site is closed by a browser check»; rutracker can pass the Cloudflare check like Kinozal and NNM-Club; the log shows why a site failed (response code, sign-in or check page)

## 0.17.0-beta.4

- [phone] A new «Remote»: the header matches the other tabs («Remote», the TV name and state), a big D-pad with side keys — keyboard and «Back» on the left, volume on the right; in «Touchpad» mode the pad takes the free space, with «Back · Home · Menu · Keyboard», playback keys and volume below
- [phone] Series screen: a long press on a torrent — «Open», «Watch on TV», «Rename», «Delete» and «Keep only this one» (deletes the season's other torrents, never multi-season packs)
- [phone] Watching an episode counts in every torrent of the series: watched S04E01 in 1080p — it is marked in 4K too, and «Watch on TV» goes on with the next one
- [phone] «Back»: on other tabs it opens «Catalog», in «Discover» it goes to «Mine», on «Mine» a second press minimizes OMP
- [phone] Fixed: in the English interface a series badge in «Mine» could say «new season» instead of the next episode date — the series was searched on TMDB by its Russian name

## 0.17.0-beta.3

- [phone] «Mine»: a series torrent titled only in English («Star Trek: Strange New Worlds / S2…») now joins the card of the torrents titled «Russian / Original»; the card takes its title from the torrent named in both languages
- [phone] The status bar (clock, battery) no longer blends into the posters while scrolling — a dark strip lies under it
- [phone] Fixed: the chips of the chosen filters in «Add» («4K», «seeds ≥ 20») centre their text like the others

## 0.17.0-beta.2

- [phone] «Discover»: sorting (popular, by rating, by release date, most anticipated) and filters (genre, year, country, minimum rating); talk shows, news and reality are hidden by default; type and year under the poster, long titles neatly cut at two lines; 2, 3 or 4 posters per row
- [phone] «Mine»: short, readable titles instead of the tracker string («Dark Matter · season 2 · episodes 1–6 of 10»), a compact header — the «Mine / Discover» switch shares a row with the buttons, smaller chips
- [phone] Two-finger zoom in «Catalog»: one step per gesture with a smooth transition — cards move to their new places and the text stays sharp
- [phone] «Search sources»: one row style — only › and the switch on the right, «Sign in» and «Sign out» as a link in the status line; rutracker gets its site screen too (including «Send the sign-in to the TV»)
- [phone] torrent.by works on the phone again: the site leaves out an intermediate certificate, OMP now carries it itself; a certificate error says «Site certificate error» instead of «not responding»
- [phone] Browser sign-in: an ad on a site's page (NNM-Club, for example) no longer pulls the sign-in window away — taps on the fields work and the keyboard opens; the sign-in page fits the screen width and can be zoomed with two fingers
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
- [phone] Phone remote: the scroll strip on the touchpad is removed — scrolling the page on the TV is a two-finger scroll
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
- Password sign-in blocked by a Cloudflare check (Kinozal, rustorka, rutracker): the hint "The site is blocked by a Cloudflare check — sign in with the browser", and the "Sign in with browser" button becomes the main one, on the phone and on the TV

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
