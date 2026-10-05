Русская версия: [README.md](README.md)

<p align="center"><img src="assets/logo.svg" width="128" alt="OMP"></p>

<h1 align="center">OMP — Open Movie Player</h1>

<p align="center">A media player for LG TVs (webOS 4.0+), Android TV and Android phones that plays movies and series straight from <a href="https://github.com/YouROK/TorrServer">TorrServer</a> on your home network.</p>

<p align="center"><a href="https://github.com/spacesarmat/omp/releases/latest">Download the latest version</a> · <a href="https://t.me/ompplyaer">Telegram channel with releases</a></p>

## What it does

| Where | What |
|---|---|
| **LG TV (webOS)** | TorrServer library with categories and 4 views, series by season, chapters and intro skipping, "History" showing where you watched, a player on the TV's hardware decoder, tracks and subtitles, remote and Magic Remote, one-click updates or updates through Homebrew Channel |
| **Android TV** | The same interface as on LG, and a choice of native player: built-in (with the FFmpeg decoder for DTS, AC3, TrueHD) or VLC (ASS subtitles with styles, almost all formats); "Auto" switches by itself. MKV, HEVC, tracks, subtitles, chapters and intro skipping |
| **Android phone** | Library, unified search across sources and adding torrents with a category, "Watch on TV" with a "Continue / From the start" choice, a "News" tab (a feed of fresh torrents, subscriptions, new episodes of series) with background notifications, "Now playing" with chapters and a mini player, a remote with a touchpad, watching in an external player |
| **TorrServer on the phone** | A built-in server: if you have none, OMP starts one on the phone, and the TV finds it by itself |

The highlights:

- **The phone is a remote and a second screen.** Start an episode on the TV from the phone, pause, seek, switch episodes, change tracks and volume right from the phone; turn the TV on over the network (LG).
- **Shared watch history.** It is stored on TorrServer and visible on all devices; each entry shows where it was watched: "TV" or "Phone "name"".
- **Continue where you stopped** on any device; automatic jump to the next episode.
- **No server of your own.** TorrServer runs right on the phone (arm64): it is downloaded on first launch and updated together with OMP.
- **Finding servers and TVs on the network**, connecting the phone to the TV by QR (LG) or by code (Android TV).
- **Chapters and intro skipping.** If the file has chapters, the player on LG and Android TV shows them as a list, CH+/CH− move between chapters, and there is a "Skip intro" button; without chapters you can mark the intro by hand. The "Skip" switches are in the torrent card and are shared between the TV and the phone.
- **Unified search across sources.** One query on the phone searches rutor, nnmclub, rutracker, Kinozal and rustorka (with sign-in), Anidub, BigFANGroup, torrent.by, Jackett and Prowlarr directly, and TorrServer search at once; identical torrents are merged.
- **Watching for new releases.** The "News" tab on the phone: a feed of fresh torrents from rutor, nnmclub and torrent.by, subscriptions to queries, and notifications about new torrents and new episodes of series from the library. OMP checks by itself, even when closed; new episodes replace the old torrent with one button, and history and "Skip" are kept.
- **Reliability and support.** An "Error log" on the phone (the last 500 entries without passwords, addresses and torrent names) with the "Report a bug on GitHub" button and "Share log"; a "Backup" of settings to a file and restoring from it.
- **Android TV on par with the phone.** Its own "Search sources" screen and rutracker sign-in on the TV, passing sources and sign-ins from the phone with one button, manual intro and credits marks on the TV (LG and Android TV).
- **Installing from the phone.** The "Install OMP on TV" assistant finds LG and Android TV on the network, shows the steps for the model and installs OMP itself.
- **A choice of player on Android TV.** Built-in (Media3 with FFmpeg) or VLC; the "Auto" mode switches to VLC when needed (format, ASS subtitles).
- **Jackett and Prowlarr directly.** OMP finds them on the network, shows the state of each tracker and passes the connections to the TV.
- **Sites behind Cloudflare.** Bypassing the Cloudflare check for Kinozal and rustorka on the phone and Android TV, FlareSolverr as a fallback, sign-in including "through the browser".
- **Updates arrive by themselves:** the TV and the phone check for a new version on launch, and after an update the app shows "What's new" once.

## Screenshots (LG)

| | |
|---|---|
| ![Sign-in](docs/screenshots/login.png)<br>Sign-in | ![Server history](docs/screenshots/login-history.png)<br>Server history |
| ![Library](docs/screenshots/library-large.png)<br>Library | ![List](docs/screenshots/library-list.png)<br>List |
| ![History](docs/screenshots/history.png)<br>History | ![Search](docs/screenshots/search.png)<br>Search |

## New in 0.15

| | |
|---|---|
| ![Player choice on Android TV](docs/screenshots/androidtv-player-settings.png)<br>Android TV: "Player" — Auto, Built-in, VLC | ![Player menu](docs/screenshots/androidtv-player-menu.png)<br>Player menu: "Player: VLC → switch to built-in" |
| ![Indexers on the phone](docs/screenshots/android-indexers.png)<br>Phone: Jackett and Prowlarr directly | ![Indexers and sites behind Cloudflare on the TV](docs/screenshots/androidtv-sources-indexers.png)<br>Android TV: trackers and sites behind Cloudflare |
| ![FlareSolverr](docs/screenshots/android-flaresolverr.png)<br>FlareSolverr: address, network search, check | ![A site behind Cloudflare](docs/screenshots/android-site.png)<br>Kinozal: Cloudflare bypass and sign-in |
| ![Cloudflare check on the phone](docs/screenshots/android-cloudflare.png)<br>Cloudflare check on the phone | ![Cloudflare check on the TV](docs/screenshots/androidtv-cloudflare.png)<br>Cloudflare check on the TV: "Pass on the phone" |

- **Two players on Android TV.** Settings → "Player": "Auto" (the default), "Built-in" or "VLC". The built-in player got the FFmpeg decoder, so DTS, AC3, E-AC3 and TrueHD play even if the box cannot decode them in hardware; if the TV or receiver accepts such audio as is, it is still passed through without decoding. VLC opens almost all formats and shows ASS subtitles with styles. "Auto" starts with the built-in player and switches to VLC once, from the same position, if the file did not open or ASS subtitles are selected in it. In the player menu you can change the player for a single torrent. The next episode is prepared on the server in advance.
- **Jackett and Prowlarr directly.** Settings → "Search sources" → "Indexers": OMP looks for them on your network (ports 9117 and 9696), connects with the API key, shows the state of each tracker (works, sign-in needed, Cloudflare, not responding; "state unknown" if Jackett is protected by a password) and passes the connections to Android TV. The key is kept in secure storage and never reaches the journal or the backup. Without a direct connection, search goes through TorrServer as before.
- **Kinozal and rustorka.** Two sites are back in search: each has its own switch and sign-in (login and password, or "Sign in with browser" if the site asks for a captcha); for Kinozal there are the mirrors kinozal.me, kinozal.guru and kinozal.tv. The sign-in can be passed to Android TV.
- **Cloudflare bypass.** A "Bypass the Cloudflare check" switch for each such site (off by default, with a warning that it may violate the site's rules). OMP passes the check with a hidden window inside the app, through [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) if needed (the guide is in the FAQ); if an "I am not a robot" checkbox is required, it opens the check on the screen, and on the TV there is "Pass on the phone".
- **Clear names.** If a torrent has a technical name, OMP picks a readable one from its files; on the phone there is "Rename".
- **Builds per architecture.** Every release has three APKs (see "Installation"), and in-app updates pick the right one themselves. Every build is published in the [Telegram channel](https://t.me/ompplyaer): files up to 50 MB are attached, larger ones are given as a link to GitHub.

## New in 0.14

| | |
|---|---|
| ![Search sources on Android TV](docs/screenshots/androidtv-sources.png)<br>Android TV: "Search sources" | ![Send to TV](docs/screenshots/android-send.png)<br>Phone: "Send to TV" |
| ![Error log](docs/screenshots/android-log.png)<br>Error log and "Report a bug on GitHub" | ![Backup](docs/screenshots/android-backup.png)<br>Settings backup |
| ![Install assistant: search](docs/screenshots/android-install-find.png)<br>Install assistant: TVs found | ![Install assistant: steps](docs/screenshots/android-install-steps.png)<br>Install assistant: steps for LG |

- **Error log.** Settings → "Error log": the last 500 entries (errors, warnings, results of the background check), stored only on the device. Passwords, cookies, server addresses and torrent names are not recorded. "Report a bug on GitHub" opens a new issue with the version and the device and copies the log; "Share log" sends a file. A short log is also in the TV settings (LG and Android TV).
- **Backup.** Settings → "Backup": a file `omp-backup-<date>.json` with servers, TVs and pairs, subscriptions, sources and settings; restoring shows the contents and asks for confirmation. Tracker passwords are not included in the backup; the TorrServer access password and the pairing keys are, so keep the file like a password.
- **Sources and rutracker on Android TV.** A "Search sources" screen on the TV with the state of each source; sign in to rutracker with the remote or with the phone "Keyboard", or with the "Send to TV" button on the phone together with the sources (the login and password are stored on the TV encrypted).
- **Manual intro and credits on the TV.** In the torrent card, the "Skip" block → "Intro and credits": a 5-second step with the arrows, holding makes it 30 seconds (LG and Android TV).
- **Install assistant.** Settings → "Install OMP on TV". LG: through developer mode (the Passphrase code from the Developer Mode app, and Homebrew Channel if you like), with a reminder to extend the session 3 days before the 1000 hours run out. Android TV: over the network through "Network debugging" (port 5555). Pairing for Android 11+ "Wireless debugging" is not supported yet: the assistant offers "Download APK". Samsung (Tizen) is not supported.

## OMP for Android

The phone app: the TorrServer library, starting a movie on an LG TV, a remote, searching and adding torrents.

| | |
|---|---|
| ![Library](docs/screenshots/android-library.png)<br>Library | ![Torrent](docs/screenshots/android-torrent.png)<br>Torrent |
| ![Where to watch](docs/screenshots/android-watch.png)<br>Where to watch | ![Remote](docs/screenshots/android-remote.png)<br>Remote |
| ![Now playing](docs/screenshots/android-nowplaying.png)<br>Now playing | ![Chapters](docs/screenshots/android-chapters.png)<br>Chapters in "Now playing" |
| ![Skip](docs/screenshots/android-skip.png)<br>"Skip" in the torrent card | ![Unified search](docs/screenshots/android-search.png)<br>Unified search |
| ![Search sources](docs/screenshots/android-sources.png)<br>Search sources | ![Feed](docs/screenshots/android-news.png)<br>"News": the feed |
| ![Subscriptions](docs/screenshots/android-subs.png)<br>Subscriptions and new episodes | ![Notifications](docs/screenshots/android-notify.png)<br>Notifications |
| ![Replace a torrent](docs/screenshots/android-replace.png)<br>"Replace" with new episodes | |

- **Installation.** Download the APK from the [release page](https://github.com/spacesarmat/omp/releases/latest) (usually `OMP-<version>-arm64.apk`; which one to pick is in the "Installation" section) and open the file. Android will ask you to allow installing from the browser (or the file manager); allow it.
- **Server.** Enter the TorrServer address or scan the QR code from the TV: in OMP on the TV open Settings → "Connect phone".
- **TV.** Pick the TV in the list and press "Allow" on the TV; the phone remembers it.
- **Watching.** "Watch on TV" starts OMP on the TV with the right file and position, and the phone becomes the remote. You can also open the stream in an external player (VLC, MX Player) or copy the link.
- **Player control.** While a movie plays on the TV, the "Now playing" screen (and the mini player at the bottom) controls it from the phone: pause, seek, previous and next episode, audio and subtitles, volume. The phone and the TV must be on the same network; it works when OMP 0.8 or newer is installed on the TV (if the version is old, the app suggests updating). The position updates about every 0.5 seconds.
- **Continue or start over.** If the file has a saved position, the app asks when starting on the TV: "Continue" from where you stopped or "From the start".
- **Library views.** The library can be switched like on the TV: large posters, small posters, a list or a compact view.
- **Turn on the TV.** The power button on the remote turns the TV on over the network. For this, on the TV turn on "General → Devices → "Mobile TV On"" (on some models, "Turn on via Wi‑Fi").
- **Categories.** When adding a torrent you can pick a category: "Movies", "Series", "Music" or "Other"; OMP suggests one from the name.
- **Unified search.** On the "Add" screen, one query searches all enabled sources: Jackett and Prowlarr directly, TorrServer search (rutor, Torznab) and the built-in sites rutor, nnmclub, rutracker, Anidub, BigFANGroup, torrent.by, Kinozal and rustorka. Identical torrents are merged into one row; results can be filtered by quality and sorted by seeds. Sources are turned on in Settings → "Search sources"; rutracker needs a sign-in (the password is stored only in Android's secure storage). Kinozal and rustorka also need a sign-in and are behind Cloudflare: the bypass is turned on with a switch on the site's page. Other trackers are connected through Jackett or Prowlarr; see the FAQ. If a site is blocked by bot protection (Cloudflare), OMP tells you what to do.
- **Chapters and skipping.** In "Now playing" there is a list of chapters and a jump to the neighbouring one; in the torrent card there is the "Skip" block: "Skip intro automatically", "Skip credits" and manual intro marks for files without chapters.
- **News.** The "News" tab (five tabs at the bottom, and you can swipe between them): "Feed" shows fresh torrents from rutor, nnmclub and torrent.by in "Movies", "Series" and "Anime", a 1080p+ filter, and each has "Add" and "To TV"; sources are turned on in "Search sources".
- **Subscriptions.** "+ New subscription" is a query with rules (sources, minimum quality and number of seeds). OMP checks subscriptions itself and sends a notification about new torrents; the first check of a subscription is silent. The notification buttons are "Add" and "Watch on TV".
- **New episodes.** For series from the library, OMP looks for a torrent with new episodes and shows a card "Episodes 9–10 are out · you have 1–8". "Replace" adds the new torrent, carries over history, stop positions, "Skip" and the category, and removes the old one only after success; "Watch on TV" replaces first and then starts; "Stop watching" turns off tracking of the series.
- **Background check.** Settings → "Monitoring": a background check every 3 hours by default (the interval can be changed), a "Wi‑Fi only" switch, tracking of new episodes, and a "Check now" button in the "News" tab. Notifications work with the app closed; Android may postpone checks to save battery, so for rare notifications allow OMP to work in the background without restrictions. The "Add" button in a notification needs an available TorrServer: the built-in one on the phone must be running.
- **What's new.** After an update the app shows the list of changes once; you can also open it in Settings (the row with the version).
- **Posters.** For a new torrent OMP finds a poster in TMDB by itself, using the key from TorrServer (entered in "Server settings", TorrServer MatriX.138+ is required).
- **History.** The "History" tab with an "All / From TV / From phone" filter; the library refreshes with a pull-down gesture.
- **Remote.** It fits on one screen. The touchpad moves the cursor on LG; its settings have speed, acceleration, "Tap = click" and "Reverse scrolling"; two fingers scroll pages on the TV.
- **Convenience.** The mini player is in "Library" and "Remote"; "Back" on the main screen minimizes the app (the built-in server keeps running); the TV icon in the header is green when a TV is connected.
- **FAQ.** Settings → "FAQ" has answers to common questions (installing on the TV, Homebrew Channel, updating).
- **Updates.** The app checks for a new version on launch and offers to download and install the `.apk` (the `update-android.json` feed). Settings are kept.

### TorrServer on the phone

If you have no server of your own, OMP starts TorrServer right on the phone: from the connection screen (when no server is found) or from Settings.

- Only for arm64 phones.
- TorrServer is not part of the APK: on first launch OMP downloads it from GitHub (about 61 MB, a pinned version, sha256 check; an interrupted download resumes, and over mobile data OMP asks first).
- The phone and the TV must be on the same Wi‑Fi network; on the TV the server is found with "Find on the network".
- While the server runs, the notification shade shows "TorrServer is running" with a "Stop" button.
- Note: the server is open without a password and is visible to all devices on this Wi‑Fi network.
- New TorrServer versions arrive with the automatic OMP releases; the update is downloaded from Settings ("Update").
- If another device does not see the server: check that both are on the same Wi‑Fi network, that the VPN is off or allows the local network, and that client isolation (the guest network) is off in the router. The connection screen has a "Find on the network" button.
- The settings of any server (cache, preload, connections, speed) are changed in Settings → "Server settings".

![TorrServer on the phone](docs/screenshots/android-server.png)

TorrServer © YouROK, GPL-3.0 — [github.com/YouROK/TorrServer](https://github.com/YouROK/TorrServer)

## OMP for Android TV

The same APK as for the phone works on TVs and boxes with Android TV: the interface is like on LG, with a choice of native player, built-in or VLC (MKV, HEVC, tracks and subtitles, seeking as on LG, chapters and intro skipping, the next episode).

| | | |
|---|---|---|
| ![Player on Android TV](docs/screenshots/androidtv-player.png)<br>Player on Android TV | ![TV choice](docs/screenshots/android-tvlist.png)<br>Choosing a TV on the phone | |
| ![Chapters on the TV](docs/screenshots/androidtv-chapters.png)<br>Chapters in the player | ![Skip on the TV](docs/screenshots/androidtv-skip.png)<br>"Skip" in the card | |

- **Installation.** Download the APK from the [release page](https://github.com/spacesarmat/omp/releases/latest) (`OMP-<version>-arm64.apk` for a 64-bit system, `OMP-<version>-armv7.apk` for a 32-bit one, `OMP-<version>.apk` if you are not sure; see "Which APK to choose" below) and install it on the TV: through a file manager, an app like "Downloader", or with `adb install`. Allow installing from unknown sources.
- **Connection code.** On the TV: Settings → "Connect phone", a 4-digit code appears. On the phone: "TV" → choose "Android TV" → enter the code.
- **Control.** After connecting, "Watch on TV", "Now playing" and the remote work the same way as with LG.
- **Chapters and skipping.** The "Skip intro" button, a list of chapters in the player, CH+/CH− between chapters, skipping credits with a jump to the next episode, as on LG; the switches are in the torrent card.
- **Search.** On the "Add" screen the TV searches the built-in sites, Jackett and Prowlarr, and TorrServer search. Settings → "Search sources" on the TV turn sources on and off and show the state of trackers; sign-ins (rutracker, Kinozal, rustorka), connections to Jackett and Prowlarr and the Cloudflare switches are entered on the phone and passed with the "Send to TV" button.
- **Player.** Settings → "Player": "Auto", "Built-in" or "VLC"; for a single torrent, in the player menu.

Limitations:

- The phone controls only OMP on the TV, not the whole system.
- On Android 10+ the system may not bring OMP to the foreground from the background: if the TV showed nothing, open OMP on the TV by hand.
- DTS, AC3, E-AC3 and TrueHD in the built-in player are decoded in software (FFmpeg) when there is no hardware support; on a weak box a heavy track may load the processor. VLC always decodes audio to PCM, with no passthrough.
- The built-in TorrServer does not run on the TV: you need a server on the network (for example, on a phone or a computer).
- PGS/VobSub subtitles are shown only in VLC.

## On the TV

- A sign-in screen with server history, editing of the login and password, and automatic search for servers on the network (ports 8090 and 5665); change the server in Settings → "Change server"
- A library with categories and 4 library views, auto-refresh: torrents added from the phone through the TorrServer web interface appear by themselves
- Series by season, watched marks, continuing where you stopped (on the TV and on the server), automatic jump to the next episode, skipping intros and credits (by the file's chapters or by manual marks), a list of chapters
- A player on the TV's hardware decoder: MKV/MP4/TS/AVI, H.264/HEVC/AV1, HDR10/HLG/Dolby Vision, AAC/AC3/EAC3/DTS (within the capabilities of the model)
- Audio tracks and subtitles (built-in and SRT/VTT/ASS in UTF-8 and Windows-1251), remembering the choice for each torrent, subtitle size and offset
- M3U/M3U8 playlists, nested TorrServer playlists, HLS streams
- Adding torrents: a magnet / hash / link to a .torrent, search through Rutor and Torznab (Jackett)
- The "History" tab: continue watching from where you stopped; the history is stored on TorrServer, and each entry shows its source, TV or phone
- Search and sorting in the library; pages scroll with the Magic Remote wheel and from the phone touchpad
- Quality badges (1080p, 4K, HEVC…) from the torrent name
- Favourite playlists
- App and TorrServer settings
- Update check and installation through Homebrew Channel
- Control from the phone: starting on the TV, "Now playing", the remote
- Launch parameters (server, magnet, torrent, play)

## Controls

| Remote | Action |
|---|---|
| Arrows, OK | Navigation, selection |
| Back | Previous screen (in the player, hide the panel first) |
| In the player: OK, Play/Pause | Pause / resume |
| In the player: left / right | Seek (holding is faster) |
| In the player: up or yellow | Tracks and subtitles |
| In the player: green or Info | Stream statistics |
| In the player: CH+ / CH− | Next / previous chapter (if there are no chapters, the next / previous file) |
| Red | Delete the torrent |
| Blue | Settings |

Magic Remote and the LG ThinQ touchpad: pointing selects an item, a click presses it. In the player, a click on the picture pauses; a double click near the left or right edge seeks back or forward (5 → 10 → 30 s on repeats; the step is changed in settings). It is convenient to enter text (a server address, a magnet, a search) from the phone keyboard in LG ThinQ.

## Installation

### From the phone

The easiest way: install OMP on the phone and open Settings → "Install OMP on TV". The phone finds LG and Android TV on the network, shows the steps for the model and installs OMP itself: on LG through developer mode with the Passphrase code (and, if you like, together with Homebrew Channel), on Android TV over the network through "Network debugging". Downloaded files are checked against a checksum; the phone contacts only the TV and GitHub. Key Server on LG and network debugging on Android TV work without encryption on the home network, so turn them off after the installation. If it did not work, use the manual ways below.

### LG webOS

OMP needs webOS 4.0 or newer (roughly 2018 TVs and later). The version: Settings → All settings → General → About this TV (the names depend on the year).

Two ways:

- **With root and Homebrew Channel.** Root is not available on all models and firmwares: check at [cani.rootmy.tv](https://cani.rootmy.tv) and [webosbrew.org/rooting](https://www.webosbrew.org/rooting/). Then, in [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) open Settings → Add repository, enter `https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/apps.json` (or use one button in OMP: Settings → "Add OMP repository to Homebrew Channel") and install OMP.
- **Without root: Developer Mode.** The steps, strictly in order:
  1. Create an LG developer account at [webostv.developer.lge.com](https://webostv.developer.lge.com) and confirm the email. One account works on one TV at a time.
  2. On the TV install "Developer Mode" from the LG Content Store, sign in, turn on **Dev Mode Status** (the TV reboots), open the app again and turn on **Key Server**. Write down the TV's IP and the passphrase from the screen.
  3. On a computer on the same network install [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest) (Windows, macOS, Linux) and add the TV: the IP and the passphrase.
  4. In Dev Manager install Homebrew Channel (from the app list or the [.ipk](https://github.com/webosbrew/webos-homebrew-channel/releases/latest)).
  5. On the TV, in Homebrew Channel add the OMP repository (as above) and install OMP. Or install `OMP-<version>-webOS.ipk` from the [release page](https://github.com/spacesarmat/omp/releases/latest) directly in Dev Manager.

Developer Mode lasts 1000 hours (about 40 days), after which apps installed through it are removed. Reset the timer in the Developer Mode app in advance; if OMP disappeared, reset it and install again. Without root, Homebrew Channel works with limitations (features that need root); OMP itself works fully.

For advanced users: installing from the command line with `ares` is described in the next section.

### Android TV and Google TV

1. Download the APK from the [release page](https://github.com/spacesarmat/omp/releases/latest): `OMP-<version>-arm64.apk` for a 64-bit system, `OMP-<version>-armv7.apk` for a 32-bit one (many boxes run a 32-bit system even with a 64-bit processor), the universal `OMP-<version>.apk` if you are not sure (see "Which APK to choose" below).
2. Install it on the TV: the "Downloader" app (enter the link), "Send Files to TV" from the phone, a USB drive with a file manager, or adb.
3. Allow installing from unknown sources: on Android 8+ the permission is granted to the app you install from (Downloader, a file manager).

adb over the network: Settings → System → About, tap "Build" 7 times; in "For developers" turn on "Network debugging"; then `adb connect <IP>:5555` and `adb install OMP-<version>.apk`. On Android 11+ use "Wireless debugging" with a pairing code (`adb pair`); the install assistant on the phone cannot do this pairing yet.

OMP runs on Android TV with Android 8+, but the built-in TorrServer starts only on 64-bit (arm64) devices; on 32-bit ones, run TorrServer on another device. To update: in OMP Settings → "Update".

### Phone

Download the APK from the [release page](https://github.com/spacesarmat/omp/releases/latest) (which one, see below), open it and allow the installation. After that OMP updates itself.

### Which APK to choose

Every release has three files with the same version and signature, and any of them installs over another:

| File | What for |
|---|---|
| `OMP-<version>-arm64.apk` | A 64-bit system: almost all modern phones and some boxes |
| `OMP-<version>-armv7.apk` | A 32-bit system: many Android TV boxes, even with a 64-bit processor; smaller in size |
| `OMP-<version>.apk` | Universal, both architectures inside: take it if you are not sure; larger in size |

The built-in TorrServer (downloaded on first launch) works on 64-bit devices. In-app updates and the install assistant pick the right file themselves. All builds are also published in the [OMP Telegram channel](https://t.me/ompplyaer): files up to 50 MB are attached to the post, larger ones are given as a link to GitHub.

### After installation

The phone, the TV and TorrServer must be on the same network. Connect the phone to the TV: Settings → "Select" (LG) or the code from Settings → "Connect phone" (Android TV). These and other questions are covered in the in-app FAQ.

### Samsung (Tizen)

Not supported yet; planned for one of the future releases.

## Installing on LG from the command line

You need a computer on the same network and a TV in developer mode.

1. On the TV install the **Developer Mode** app from the LG Content Store, sign in with an LG developer account (free registration at webostv.developer.lge.com), turn on **Dev Mode Status** and **Key Server**, and reboot the TV.
2. Download and install [Node.js](https://nodejs.org) (LTS).
3. Get the project: `git clone https://github.com/spacesarmat/omp.git` (or the archive from the release page) and run `npm install` in its folder.
4. Add the TV (once): `npx ares-setup-device` → **add** → the name `tv`, the TV's IP (Settings → Network → Advanced), port `9922`, user `prisoner`.
5. Get the key (once): `npx ares-novacom --device tv --getkey`, then set the passphrase from the Developer Mode screen: `npx ares-setup-device --modify tv --info "passphrase=XXXXXX"`.
6. Install and launch: download `OMP-<version>-webOS.ipk` from the [releases](https://github.com/spacesarmat/omp/releases) page and run `npx ares-install --device tv OMP-<version>-webOS.ipk`, or build it yourself: `npm run package`, `npm run tv:install`, `npm run tv:launch`. The default device name is `tv`; set another with the `WEBOS_DEVICE` variable.

> **Windows PowerShell:** if `npx`/`npm` say "running scripts is disabled", use `npx.cmd` and `npm.cmd` or the regular command prompt (cmd).
>
> **Developer mode** has to be extended in the Developer Mode app (the session is limited, and the time left is shown in the Developer Mode app), otherwise the app disappears from the TV. On rooted TVs you can install the `.ipk` through Homebrew Channel.

## Homebrew Channel

For rooted TVs with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).

- The official catalog: once OMP is added to the catalog, the app can be found and installed right in Homebrew Channel.
- The OMP repository: in Homebrew Channel open Settings → Add repository and enter `https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/apps.json`. Or use one button in OMP: Settings → "Add OMP repository to Homebrew Channel".

## Updating

OMP checks for a new version on launch and shows an "Update available" window. There are three ways to update:

1. **One click:** on a rooted TV, OMP downloads and installs the new version itself.
2. **Through Homebrew Channel:** OMP opens Homebrew Channel (its start screen) or its add-repository screen; the update is installed from there.
3. **From a computer:** the "Update" screen shows a QR code with the release link; download `OMP-<version>-webOS.ipk` and install it with `npx ares-install --device tv OMP-<version>-webOS.ipk`.

Settings and watch history are kept when updating.

## Launch parameters

OMP accepts parameters when the app is launched:

| Key | Value |
|---|---|
| `server` | The TorrServer address (`http://192.168.1.10:8090`): connect to this server |
| `magnet` | A magnet link: add the torrent to the server |
| `torrent` | A torrent info-hash (40 hex characters): open an existing torrent on the active server |
| `file` | The file number in the torrent (together with `torrent`): start playing it right away |
| `t` | The start position in seconds (together with `file`) |
| `play` | A direct video link: start playing right away |
| `title` | A title for `play` (optional) |

```bash
ares-launch -d tv com.spacesarmat.torrplayer -p '{"play":"http://192.168.1.10:8090/stream/movie.mkv?link=HASH&index=1&play","title":"Movie"}'
```

```bash
ares-launch -d tv com.spacesarmat.torrplayer -p '{"torrent":"HASH","file":3,"t":1394}'
```

```bash
luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"com.spacesarmat.torrplayer","params":{"magnet":"magnet:?xt=urn:btih:HASH"}}'
```

## Development

```bash
npm install
npm run dev        # http://localhost:5173 — arrows, Enter, Esc (Back), Space, F1–F4 (colour keys), i (statistics), n/p (episodes)
npm test
npm run build      # a bundle for Chromium 53+ in dist/
npm run check:boot # check launching from file://
npm run icons      # TV icons from assets/icon.svg
npm run gen:donate-qr # the QR code of the "Support" card (src/ui/donateQr.ts) after changing the link in src/lib/donate.ts
```

CI (GitHub Actions) runs tests, the build, packaging and the launch check on every push and PR. To release: bump `version` in `package.json`, merge into `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

## Limitations

- The set of codecs depends on the TV model.
- If authorization is enabled on TorrServer, video may not play on newer webOS (the browser blocks the login and password in the video address).
- Graphical subtitles (PGS/VobSub) work only when embedded in the video.

## Support

OMP is free and ad-free, and all features are available to everyone. If it is useful to you, you can support the development: [Boosty](https://boosty.to/djmaker/donate). In the phone app: Settings → "About" → "Support OMP"; on the TV, on pause and during the final credits, a card with a QR code appears.

### Support code

Boosty subscribers get a support code that changes every month. It is entered on the phone: "Support OMP" → "Already supported?" → "Paste" → "Apply". Until the end of the month of the code (and three more days), OMP shows no requests for support, neither on the phone nor on the TVs. The code is verified on the phone by its signature, without the internet; the TVs learn about it through a journal on TorrServer, where only the end date is written, and the code itself is passed nowhere. The code of the current or the next month is accepted.

## License

OMP is distributed under the [GNU GPL v3](LICENSE).

The install assistant in the Android app uses third-party libraries:

- [JSch](https://github.com/mwiede/jsch) (the mwiede fork): SSH to LG in developer mode; BSD 3-Clause (includes JZlib, BSD, and jBCrypt, ISC).
- [dadb](https://github.com/mobile-dev-inc/dadb): adb over the network to Android TV; Apache License 2.0.

The player on Android TV:

- [AndroidX Media3](https://github.com/androidx/media) (ExoPlayer): the built-in player; Apache License 2.0.
- [libVLC for Android](https://code.videolan.org/videolan/libvlcjni) (`org.videolan.android:libvlc-all`): the second player engine; GNU LGPL 2.1. The library is linked unmodified, and its sources are at the link.
- [FFmpeg decoder for Media3](https://github.com/jellyfin/jellyfin-androidx-media) (`org.jellyfin.media3:media3-ffmpeg-decoder`, the Jellyfin build): DTS, AC3/E-AC3, TrueHD audio without a hardware decoder; GNU GPL v3 (which is why OMP as a whole is distributed under GPL-3.0). The [FFmpeg](https://ffmpeg.org/) inside it is built without GPL parts (only LGPL 2.1+ decoders).

[FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) (MIT) is a separate program on your server; OMP does not include it and only calls it over the network.
