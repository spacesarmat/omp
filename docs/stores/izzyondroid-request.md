# IzzyOnDroid inclusion request

Paste this into a new issue at https://gitlab.com/IzzyOnDroid/repo/-/issues when Andy says to send it. Nothing here has been submitted.

```
App: OMP
packageName: com.spacesarmat.omp
license: GPL-3.0-only
source: https://github.com/spacesarmat/omp
issues: https://github.com/spacesarmat/omp/issues
website: https://omp-player.online
changelog: https://github.com/spacesarmat/omp/blob/main/CHANGELOG.md
author: spacesarmat
contact: ompplayerandroid@gmail.com

Summary: phone and Android TV player for a TorrServer on the home network. Android 8+ (minSdk 26). Same signed release APK for the phone and the TV box.

Fastlane (en-US and ru-RU: title, short description, full description, changelogs, icon, phone screenshots):
https://github.com/spacesarmat/omp/tree/main/fastlane/metadata/android

Release APKs are attached to GitHub releases.
Please take the arm64 build only:

ApkMatch: /-arm64-v8a\.apk$/
ApkIgnore: /(-arm64|-armv7)\.apk$|universal|webOS|setup|dmg|AppImage|deb/

Example asset (from the first release that carries the ABI name; v0.30.0 still uses the older name OMP-0.30.0-arm64.apk):
OMP-<version>-arm64-v8a.apk

versionCode is reproducible from the version name:
major * 1000000 + minor * 10000 + patch * 100 + slot
slot is 99 for a stable release and N for x.y.z-beta.N (capped at 98).
0.30.0 -> 300099. The same formula is in android/app/build.gradle and src/lib/version.ts.
Changelogs are fastlane/metadata/android/<locale>/changelogs/<versionCode>.txt

Size: the v0.30.0 arm64 APK is 58775886 bytes (about 56 MB), over the 30 MB guide. The size is the embedded player native libraries (libVLC / FFmpeg), not a second copy of the app. Please consider an exception and ArchivePolicy: 1 so the repo keeps a single version. The universal APK is larger and should be ignored.

Notes for the review, not hidden:
- The APK is signed with the project release key, not a debug key, and is not debuggable.
- The app can check GitHub Releases and install a newer APK itself (REQUEST_INSTALL_PACKAGES). If that blocks inclusion, say so and we will discuss a build that only links to the release page.
- ACCESS_FINE_LOCATION and NEARBY_WIFI_DEVICES are used only after the user asks to read the current Wi-Fi name. SYSTEM_ALERT_WINDOW is requested from TV settings only. INTERNET is required to talk to the user's own TorrServer.
- No tracker SDK. License is GPL-3.0-only, in the repo root.
```
