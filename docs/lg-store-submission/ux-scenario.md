# OMP - UX Scenario (draft for LG Content Store)

Paste-ready English draft. Support: ompplayerandroid@gmail.com. Privacy policy: https://omp-player.online/privacy.

OMP for LG Content Store is a player for a TorrServer the reviewer runs on the same home network. The app does not search the internet for releases and does not ship a content catalog. Remote: arrows, OK, Back, red, blue, and the media keys. The Magic Remote pointer should reach the same controls.

## 1. First launch

1. Open OMP from the LG launcher. The first screen is Connect (no server is saved).
2. The screen shows the OMP logo, an address field, Connect, and Scan.
3. Arrow keys move the highlight. The highlight is a yellow fill (buttons also grow slightly). OK activates the highlighted control.
4. Back on this screen asks "Exit the app?". OK on Exit closes OMP and returns to the TV Home.

## 2. Connect TorrServer

Prepare a TorrServer on the same LAN (port 8090). Add one legal test file, or skip the torrent and use an HLS playlist later.

1. Type the server address (for example 192.168.1.50:8090) with the LG keyboard. OK on Connect.
2. While the app waits, the button reads that it is connecting. A failure stays on this screen with an error line.
3. Optional: OK on Scan. The app reads the TV IPv4 and probes the local subnet on ports 8090 and 5665. Found servers can be chosen. If none answer, a toast says so.
4. Optional: open Advanced and enter the TorrServer login and password. They are sent only to that server.
5. After a successful echo, the app opens the library. The next launch with a saved server opens the library directly.
6. History (when at least one server was saved) lists previous servers. Back closes that list.

## 3. Browse the library

1. The top bar shows History, All, Movies, Series, Music, Audiobooks, Other. There is no Discover tab and no New tab.
2. The magnifying glass is library search. OK opens a field. Typing filters the titles already on this TorrServer ("Search by title"). It does not search trackers. Back closes the field and clears the query.
3. There is no "Find a release" button.
4. OK on a poster opens that title (files, seasons). Back returns to the grid.
5. Red on a focused title asks before deleting it from the server. Blue opens Settings.
6. The grid and view buttons switch poster size and sort. They only reorder the local library.
7. History shows continue-watching. OK resumes the file.
8. Playlists opens an M3U or HLS URL. That path plays without a torrent.

## 4. Play

1. OK on Watch starts playback with the TV hardware decoder.
2. The transport bar appears on Down or on pointer movement. Arrows move inside it. OK pauses and resumes.
3. Play/Pause on the remote toggles playback. Rewind and fast-forward seek. Channel Up/Down move by chapter when the file has chapters, otherwise to the previous or next item.
4. Up opens audio and subtitle tracks. The app uses the HTML track list when the TV exposes one, and the TV media service when it does not.
5. Back hides the info panel if it is open, then hides the bar if playback is running, then leaves the player for the title or the library.
6. At the end of an episode, auto-next (on by default in Settings) can start the next file.

## 5. Settings

1. Blue from the library, or the gear icon, opens Settings.
2. Sections used by this build: playback (language, audio, subtitles, seek step, auto-next), server, help, advanced.
3. "Send usage steps" is off. The line under it says it stays off until the person turns it on. Crash reports follow the same switch. Turning it on is optional.
4. There is no update check, no Homebrew Channel button, and no "Extend mode" button. Updates come from the LG Content Store.
5. There is no tracker-source block and no "help improve picks" switch. This build does not send playback statistics.
6. Back leaves Settings for the previous screen (the library, when opened from there).

## 6. Remote keys and Back

| Key | Connect | Library | Player | Settings |
| --- | --- | --- | --- | --- |
| Arrows | Move highlight | Move highlight, change tab | Move inside the bar or menus | Move highlight |
| OK | Activate | Open the focused item | Activate, or pause/resume | Change the focused row or activate |
| Back | Exit confirm, then Home | Close search if it is open; otherwise exit confirm, then Home | Close info, then hide the bar, then leave the player | Previous screen |
| Red | - | Delete the focused title (after confirm) | - | - |
| Blue | - | Settings | - | - |
| Play/Pause, Rew, FF | - | - | Toggle and seek | - |

Pointer: move the Magic Remote cursor onto a control and press OK. Every control that the arrows can reach should take the click. Wheel: lists scroll in the wheel direction.

## 7. What this build will not do

- Search public trackers or open a release-discovery screen.
- Install or update OMP through Developer Mode or Homebrew Channel.
- Send diagnostics or crash reports until "Send usage steps" is turned on.
