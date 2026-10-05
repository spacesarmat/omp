# Changes

The English translation covers the latest versions only; the full history (in Russian) is in [CHANGELOG.md](CHANGELOG.md).

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
