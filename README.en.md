Русская версия: [README.md](README.md)

<p align="center"><img src="assets/logo.svg" width="128" alt="OMP"></p>

<h1 align="center">OMP — Open Movie Player</h1>

<p align="center">A media player for LG TVs (webOS 4.0+), Android TV and Android phones. It plays movies and series from <a href="https://github.com/YouROK/TorrServer">TorrServer</a> on the home network.</p>

<p align="center"><a href="https://github.com/spacesarmat/omp/releases/latest">Download</a> · <a href="README.md#установка">Install</a> · <a href="https://t.me/ompplyaer">Telegram</a> · <a href="https://github.com/spacesarmat/omp/issues">Issues</a> · <a href="https://boosty.to/djmaker/donate">Support</a></p>

## Platforms

- **LG webOS 4.0+** — roughly TVs from 2018 onward. OMP does not need root.
- **Android TV and Google TV** — Android 8 or newer. The same APK as the phone.
- **Android phone** — Android 8 or newer.

Samsung (Tizen) is not supported yet. Xiaomi, Sber and Yandex boxes use the same APK; the install assistant on the phone shows the steps.

## What it does

- A TorrServer library: categories, several views, series by season, shared history and resume.
- Playback. On LG, the TV’s hardware decoder. On Android TV, the built-in 2160 Player (4K, HDR, Dolby Vision as HDR10 when the box has no Dolby Vision decoder; AC3, E-AC3, DTS and TrueHD passed through or decoded in software) or VLC; Auto switches by itself. The phone uses the same built-in player.
- Audio tracks, subtitles, chapters, intro and credits skip.
- The phone is a remote: start on the TV, pause, seek, episodes, tracks and volume. On Android TV it can also drive the box.
- Torrent search on the phone and Android TV: rutor, nnmclub, rutracker, Kinozal, rustorka, Anidub, BigFANGroup, torrent.by, plus Jackett and Prowlarr. On LG, search goes through the phone or through TorrServer. Discover lists new titles from TMDB.
- News on the phone: a feed, subscriptions and new episodes, checked in the background.
- M3U/M3U8 playlists. An HLS playlist opens in the player.
- An update check on launch.

## Requirements

You need [TorrServer](https://github.com/YouROK/TorrServer) on the home network. If you have none, OMP downloads the arm64 build from GitHub and runs it on the phone or on Android TV (it is not inside the APK; the file is checked by sha256). A device without arm64 needs a server elsewhere. The built-in server has no password and is visible on that Wi‑Fi network. The phone, the TV and the server have to be on the same network.

## Install

Builds are on the [latest release](https://github.com/spacesarmat/omp/releases/latest): `OMP-<version>-webOS.ipk` for LG and three APKs for Android. The full Russian steps are in [Установка](README.md#установка).

The short path: install OMP on the phone and open Settings → “Install OMP on TV”. The phone finds LG and Android TV on the network and installs OMP. On LG that is developer mode (the Passphrase from the Developer Mode app); on Android TV it is network debugging (port 5555). The assistant does not pair Android 11+ wireless debugging yet.

### LG webOS

- **Homebrew Channel**, when the TV is rooted. Settings → Add repository → `https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/apps.json`. The same action is in OMP: Settings → “Add the OMP repository to Homebrew Channel”.
- **Without root.** An LG developer account at [webostv.developer.lge.com](https://webostv.developer.lge.com). On the TV, install Developer Mode from the LG Content Store and turn on Dev Mode Status and Key Server. On a computer on the same network, open [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest), add the TV (IP and passphrase), install Homebrew Channel, then OMP from the repository or the file `OMP-<version>-webOS.ipk`. A Developer Mode session lasts 1000 hours; extend it in that app, or the apps installed through it are removed.

With the TV already in developer mode, install from the command line: `npm install` in a clone, set the device up once (`npx ares-setup-device`, then `npx ares-novacom --device tv --getkey`) and run `npx ares-install --device tv OMP-<version>-webOS.ipk`. To build the package: `npm run package`, then `npm run tv:install`.

### Android

Android 8 or newer. Download an APK from the [release page](https://github.com/spacesarmat/omp/releases/latest) and open it in the browser, in Downloader, in a file manager, or with `adb install`. Allow installs from unknown sources.

| File | Use it for |
|---|---|
| `OMP-<version>-arm64.apk` | a 64-bit system: almost all current phones and some boxes |
| `OMP-<version>-armv7.apk` | a 32-bit system: many Android TV boxes, including ones with a 64-bit CPU |
| `OMP-<version>.apk` | both architectures, when the system is unknown |

The three files share one version and one signature. In-app updates and the install assistant pick the file themselves.

The phone connects to the TV like this: on LG, a QR code under Settings → “Connect phone”; on Android TV, a 4-digit code on the same screen.

## Links

- Telegram: https://t.me/ompplyaer
- Issues: https://github.com/spacesarmat/omp/issues
- Support: https://boosty.to/djmaker/donate

## License

[GNU GPL v3](LICENSE).

The Android build includes [2160 Player](https://github.com/spacesarmat/2160player) (GPL-3.0), [AndroidX Media3](https://github.com/androidx/media) (Apache-2.0), [libVLC](https://code.videolan.org/videolan/libvlcjni) (LGPL-2.1) and [NextLib](https://github.com/anilbeesetti/nextlib) (GPL-3.0). The install assistant uses [JSch](https://github.com/mwiede/jsch) (BSD-3-Clause) and [dadb](https://github.com/mobile-dev-inc/dadb) (Apache-2.0).
