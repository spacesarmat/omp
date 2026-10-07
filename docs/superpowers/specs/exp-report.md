# Experimental branch `exp/2160-engine`: stage reports

## Stage 1: OMP on the 2160player toolchain

Date: 2026-10-07. Branch `exp/2160-engine`. Commit `build(android): AGP 9.4, Kotlin 2.4, compileSdk 37`.
Design: `2026-10-07-exp-2160-engine-design.md`. The target versions come from `spacesarmat/2160player` `gradle/libs.versions.toml` and its wrapper.

### Versions

| | before | after |
|---|---|---|
| Android Gradle Plugin (`android/build.gradle`) | 8.13.0 | 9.4.1 |
| Kotlin Gradle plugin (classpath) | 2.2.20 | 2.4.20 |
| Gradle wrapper (properties, jar, `gradlew`, `gradlew.bat`) | 8.14.3 (`-all`) | 9.6.0 (`-bin`, same as 2160player) |
| compileSdk (`android/variables.gradle`) | 36 | 37 |
| targetSdk | 36 | **36, unchanged** (see below) |
| minSdk | 26 | 26 |
| JDK | 21 | 21 |
| build-tools (AGP default) | 36.0.0 | 36.0.0 |

The Kotlin plugin version is still set on the buildscript classpath. AGP 9 uses its built-in Kotlin support with the KGP version it finds there, so the app compiles with Kotlin 2.4.20.

### Why targetSdk stays 36
Android 17 (API 37) brings local network protection. An app that targets 37 needs the new runtime permission `android.permission.ACCESS_LOCAL_NETWORK` (it is in the android-37 platform, `since="37.0"`) before it can reach LAN addresses. Almost everything OMP does is on the LAN: TorrServer, SSDP/multicast discovery, SSH to the LG TV, adb to Android TV and the phone remote. Moving to targetSdk 37 would need a permission request flow and UX, so it is not a toolchain change, and LAN access would break on Android 17 devices without it. 2160player itself also ships `targetSdk = 36`. compileSdk 37 is all that the Compose 1.12 and core 1.19 dependencies of player-core need (stage 2).

### Changes in OMP's own files
- `android/build.gradle`: AGP 9.4.1 and KGP 2.4.20 on the classpath.
- `android/app/build.gradle`:
  - `apply plugin: 'org.jetbrains.kotlin.android'` is removed. AGP 9 fails with "The 'org.jetbrains.kotlin.android' plugin is no longer required for Kotlin support since AGP 9.0". `kotlin { compilerOptions { jvmTarget = JVM_21 } }` stays as it is and still works with built-in Kotlin.
  - `defaultConfig { aaptOptions { ignoreAssetsPattern } }` is now `android { androidResources { ignoreAssetsPattern } }` with the same pattern. `aaptOptions` is deprecated legacy DSL.
  - `getDefaultProguardFile('proguard-android.txt')` is now `proguard-android-optimize.txt`. AGP 9 fails at configuration with the old file. It has no effect, because `minifyEnabled false`.
  - `enable true` and `universalApk true` in `splits.abi` now use `=`. Gradle 9 deprecates the space-assignment syntax.
  - The signing logic is unchanged.
- `android/variables.gradle`: `compileSdkVersion = 37`.
- Gradle wrapper: regenerated with `gradlew wrapper --gradle-version 9.6.0 --distribution-type bin`. `gradlew` keeps mode 100755 and LF in the index.
- `.github/workflows/ci.yml` and `release.yml`: `setup-android` now installs `platform-tools platforms;android-37.0 build-tools;36.0.0` explicitly. Before, it installed only `platform-tools` and relied on AGP auto-download. Java stays at temurin 21. CI was not run.
- `scripts/gradle.mjs`: only the comment and message that named Gradle 8.14 are changed. The JDK 21..24 selection is the same.

### Capacitor plugins
Modules: `capacitor-android` (@capacitor/android 8.x), `capacitor-mlkit-barcode-scanning`, `capacitor-app`, `capacitor-clipboard`, and the generated `capacitor-cordova-android-plugins`.

**No plugin issue needs a fix.** All five modules configure and compile under AGP 9.4.1, Gradle 9.6.0 and compileSdk 37 without patches:
- Each plugin still declares `classpath 'com.android.tools.build:gradle:8.13.0'` in its own `buildscript`. The root classloader's AGP 9.4.1 wins, as it did before. No error and no duplicate plugin.
- `lintOptions { ... }` (deprecated DSL) in all plugins is still accepted by AGP 9.4.1.
- No plugin uses `applicationVariants`/`libraryVariants`. No plugin has Kotlin sources, so `compileDebugKotlin` is NO-SOURCE.
- `capacitor-android` has `lintOptions { abortOnError, warningsAsErrors }`. The release build, including `lintVitalAnalyzeRelease`, passes.

No change to `node_modules`, no patch-package, no `subprojects {}` overrides. `capacitor.build.gradle` and `capacitor.settings.gradle` were restored with `git checkout` after each `cap sync`.

Remaining deprecations, which are warnings only and will become errors in **Gradle 10**: "Implicit lookup of properties in parent projects". Every plugin `build.gradle` (and OMP's `app/build.gradle`, for `$androidxAppCompatVersion` etc.) reads the root `ext` versions without a `rootProject.ext.` prefix. Gradle 9.x is fine with this. Capacitor will have to update its templates before Gradle 10.

### Verification
- `npm run android:debug` (cap sync + `assembleDebug`): **BUILD SUCCESSFUL**, from a clean build too.
- `node scripts/gradle.mjs testDebugUnitTest`: **499 tests, 0 failures, 0 skipped**. Same as before the change (499).
- `npx vitest run`: **316 files, 3517 tests passed**.
- Release variant: `assembleRelease` without a keystore stops with the expected error «Нет ключа подписи Android…», which proves configuration works. A full `assembleRelease` with the env variables `ANDROID_KEYSTORE_*` pointing at the local Android debug keystore **succeeds**. `apksigner` shows the APK signed with that key, so the env-based signing still works. Those APKs were deleted.
- Debug APK badging: `compileSdkVersion='37'`, `targetSdkVersion:'36'`, versionCode 1900.
- Not done: no device checks on Dune or S21 (the controller does these), and CI was not run.

### APK sizes (debug, bytes)

| APK | AGP 8.13 | AGP 9.4 | diff |
|---|---|---|---|
| arm64 (`app-arm64-v8a-debug.apk`) | 41 818 164 | 39 768 247 | −2.05 MB |
| armv7 (`app-armeabi-v7a-debug.apk`) | 37 363 142 | 37 498 857 | +0.14 MB |
| universal (`app-universal-debug.apk`) | 65 963 617 | 63 913 688 | −2.05 MB |

- The arm64 drop is `lib/arm64-v8a/libc++_shared.so`, which goes from 9.29 MB to 1.37 MB uncompressed. AGP 8.13 reported "Unable to strip … libc++_shared.so … packaging them as they are". AGP 9.4 strips it. No file was removed: the entry lists are the same except for one new dex shard.
- dex grows by about 135 KB. Kotlin 2.4 generates different code, and the classes are split into 17 dex files instead of 16.
- Release with the debug key, for reference: arm64 35.6 MB, armv7 33.5 MB, universal 58.6 MB.

### Risks and notes
- **targetSdk 37 is postponed.** It needs `ACCESS_LOCAL_NETWORK` handling (runtime request, fallback UX) and a review of the other API 37 behaviour changes. This is a separate task.
- **Gradle 10** will turn the implicit parent-property lookup into an error, in the Capacitor plugin templates and in OMP's `app/build.gradle`. Not urgent on Gradle 9.6.
- **Kotlin 2.4** compiles OMP's code without errors. There are new warnings only, such as `UNEXHAUSTIVE_WHEN_BASED_ON_JAVA_ANNOTATIONS` and `PLATFORM_CLASS_MAPPED_TO_KOTLIN`. Runtime behaviour is covered by the unit tests, but not yet by a device check.
- `libc++_shared.so` is now stripped on arm64. This is expected to be harmless (symbols only), but libVLC, ExoPlayer FFmpeg and ML Kit should be smoke-tested on the S21 and Dune.
- CI now relies on `platforms;android-37.0` being available to `sdkmanager` on the runner. The package id matches the local SDK's `package.xml`.
- `org.gradle.jvmargs` is still `-Xmx1536m`. Debug and release built fine. Stage 2 (player-core) needs `-Xmx4g`, as the spike found.

## Stage 2: 2160 Player's player-core in OMP

Date: 2026-10-07. Commit `build(android): include 2160 player-core, Media3 1.11, nextlib FFmpeg`.
Spike on the old toolchain: `C:\Users\ANDYBUM\omp-spike\SPIKE-2160-EMBED.md`. No 2160player source or build file is changed: since stage 1 OMP is on its toolchain.

### Changes
- **Submodule** `android/vendor/2160player` → `https://github.com/spacesarmat/2160player.git`, branch `main` (`.gitmodules` has `branch = main`), pinned at `88d2b4c`. Update with `git submodule update --remote android/vendor/2160player` and commit the new pointer.
- `android/settings.gradle`: `includeBuild('vendor/2160player')` with `substitute(module('tv.p2160:player-core')).using(project(':player-core'))` (EMBEDDING.md 1b). The included build uses its own version catalog and `gradle.properties`.
  - It fails early with a clear message when the submodule is not checked out.
  - Android SDK: the included build reads `ANDROID_HOME`/`ANDROID_SDK_ROOT` (set by `scripts/gradle.mjs` locally and by `setup-android` in CI) or its own `local.properties`. When only OMP's `android/local.properties` exists (Android Studio), settings copies its `sdk.dir` into `vendor/2160player/local.properties`, which is gitignored upstream, so the submodule stays clean.
- `android/app/build.gradle`:
  - `implementation 'tv.p2160:player-core:0.1.0'` (the version player-core's build declares by default).
  - `media3-exoplayer` and `media3-ui` 1.8.0 → **1.11.1** (2160's catalog). player-core exposes `media3-exoplayer` as `api`, so it would be 1.11.1 anyway.
  - `org.jellyfin.media3:media3-ffmpeg-decoder:1.8.0+1` → `io.github.anilbeesetti:nextlib-media3ext:1.11.1-0.16.0` (2160's catalog). It is a direct dependency because player-core has nextlib as `implementation`.
  - `packaging.jniLibs.pickFirsts += ['**/libavcodec.so','**/libavutil.so','**/libswscale.so','**/libswresample.so']`.
- `Media3Engine.kt`: the two FFmpeg imports move to `io.github.anilbeesetti.nextlib.media3ext.ffdecoder.{FfmpegAudioRenderer,FfmpegLibrary}`; same constructor `(Handler, AudioRendererEventListener, AudioSink)` and `isAvailable()`. KDoc updated. Compiles without warnings on Media3 1.11.1.
- `android/gradle.properties`: `org.gradle.jvmargs=-Xmx4g` (other flags unchanged).
- No Compose plugin in OMP: launching `Player2160` from Kotlin does not need it.
- CI (`ci.yml` android job, `release.yml`): `actions/checkout` with `submodules: recursive`. `setup-java` installs Temurin **17 and 21** (21 last, so it stays the default for Gradle), and Gradle runs with `-Porg.gradle.java.installations.fromEnv=JAVA_HOME_17_X64`: player-core declares `kotlin { jvmToolchain(17) }` and there is no toolchain resolver plugin, so Gradle must find a local JDK 17 (locally it auto-detects Adoptium 17). The web `build` job in `ci.yml` runs no Gradle and is left without submodules. CI was not run.

### Merged manifest (debug) additions from player-core and its dependencies
- `<application android:usesCleartextTraffic="true">`. No effect: OMP's `networkSecurityConfig` takes precedence (API 24+), and it already permits cleartext.
- `CHANGE_WIFI_MULTICAST_STATE`: OMP already declares it. Nothing new.
- **New** permission `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (`FOREGROUND_SERVICE` already present).
- `tv.p2160.core.Player2160Activity`: `exported="false"`, `singleTop`, PiP, theme `Theme.P2160.Player`.
- **New** `tv.p2160.core.engine.PlaybackService`: `exported="true"`, `foregroundServiceType="mediaPlayback"`, intent filters `androidx.media3.session.MediaSessionService` and `android.media.browse.MediaBrowserService`. Other apps (and Android Auto/system media controls) can bind to it; it only matters while a 2160 session is running.
- **New** `androidx.media3.session.BluetoothValidationActivity` (`exported="true"`, from media3-session 1.11).

### Verification
- `npm run android:debug`: **BUILD SUCCESSFUL** (1 m 27 s). No errors; 9 Kotlin deprecation warnings inside player-core (upstream), none in OMP's code. `capacitor.build.gradle` and `capacitor.settings.gradle` restored afterwards.
- `node scripts/gradle.mjs testDebugUnitTest` (OMP's `:app`): **499 tests, 0 failures, 0 errors, 0 skipped**.
- `npx vitest run`: **316 files, 3517 tests passed**.
- Not done: release build, device checks, CI.

### APK sizes (debug, bytes)

| APK | stage 1 | stage 2 | diff |
|---|---|---|---|
| arm64 (`app-arm64-v8a-debug.apk`) | 39 768 247 | 68 029 448 | +28.26 MB |
| armv7 (`app-armeabi-v7a-debug.apk`) | 37 498 857 | 65 453 843 | +27.95 MB |
| universal (`app-universal-debug.apk`) | 63 913 688 | 108 048 793 | +44.14 MB |

- arm64 now has 30.9 MB of dex and 30.6 MB of native libraries (compressed). The new native libraries are nextlib's `libavcodec`, `libavformat`, `libavutil`, `libswscale`, `libswresample`, `libmedia3ext`, `libmediainfo` and `libandroidx.graphics.path`; Jellyfin's `libffmpegJNI.so` is gone.
- The growth is about 2.3 MB per ABI more than in the spike (+25.9 MB): upstream player-core here is on Compose 1.12 / core 1.19 / lifecycle 2.11 and has newer commits.
- Release has `minifyEnabled false`, so it grows by about the same.

### Risks and notes
- **Device regression is needed** for OMP's own Media3 engine (1.8 → 1.11: track overrides, audio sink/passthrough, buffer cap on 128 MB boxes, subtitles) and for the FFmpeg switch (DTS/TrueHD/AC3 decode and downmix through nextlib instead of Jellyfin).
- **Licence notes**: `README.md` / `README.en.md` third-party lists still name the Jellyfin FFmpeg decoder; they should name nextlib (GPL-3.0) and 2160 Player (GPL-3.0) and the FFmpeg configure flags of nextlib's build before anything leaves the experimental branch.
- **Exported `PlaybackService`** from player-core (see above). If OMP does not want background playback / external controllers for the 2160 engine, it can be removed in OMP's manifest with `tools:node="remove"`.
- **Submodule follows `main`**: `git submodule update --remote` pulls whatever upstream has; a toolchain or Compose bump there can break OMP's build. The committed pointer pins a known-good commit.
- **CI**: needs the JDK 17 toolchain (handled as above) and 4 GB of Gradle heap; the composite build also configures 2160's `app`, `source-torrent` and `embed-demo` projects (not built). Both untested on runners.
- **Size**: +28 MB per ABI. Options stay as in the spike: R8, or trimming player-core (`material-icons-extended`, rtsp, smoothstreaming, session).

## Stage 3: 2160 engine under OMP's player screen (Android TV)

Date: 2026-10-07. Commit `feat(atv): 2160 engine under OMP's player screen`. Submodule unchanged (`88d2b4c`).

OMP's player screen is unchanged: `PlayerActivity`, overlay, menus, DonateCard QR, `ChapterTicksView`, `Skips.kt`, `PlayerFlow`/`PlayerSession`, phone remote, progress/journal events, `EngineChooser`/`EngineSwitcher` and the VLC fallback. Only the engine under it changed.

### What was done
- New `player/Engine2160.kt` (`PlayerEngine`) on top of `tv.p2160.core.engine.PlayerController`. The controller plays one `PlaybackRequest`, so the engine creates **one controller per `open()`** and releases the previous one first.
- `EngineChooser`/`EngineSwitcher`: the "builtin" kind (`EngineKind.MEDIA3`, wire `"builtin"`; the setting `playerEngine` 'auto'|'builtin'|'vlc' is unchanged) now creates `Engine2160` in `PlayerActivity.engineHost.create`. The enum name stays `MEDIA3`: the 2160 engine is Media3 ExoPlayer underneath, and renaming would only churn the switcher and its tests. A KDoc note says so.
- **`Media3Engine.kt` is removed**, and `Media3EngineTest` becomes `Engine2160Test`. Engine2160 covers everything Media3Engine did (table below), and all tests pass. The old engine is still in git history (`523103d`).
- `PlayerEngine` gets two optional members, `nightMode: Boolean?` (null = the engine has none, so VLC and `FakeEngine` don't need changes) and `setNightMode(on)`.

### What maps to what

| OMP `PlayerEngine` | Engine2160 / 2160 |
|---|---|
| `attach(container)` | A Media3 `PlayerView` as before (no controller UI, no buffering spinner, FIT, black shutter, not focusable). It is bound to `controller.player` on every `open`. Subtitles (text, ASS as Media3 cues, PGS bitmaps) are drawn by its `SubtitleView`, as before. 2160's Compose `PlayerScreen` is not used. |
| `open(media, startMs)` | `PlayerController(app, PlaybackRequest(items = [MediaEntry(uri, subtitles, segments)], startPositionMs = startMs, headers))`. Then on its ExoPlayer: our listener, `pauseAtEndOfMediaItems = true`, the track preferences, and `playWhenReady = true`. The controller builds the media item asynchronously (title/subtitle IO), so until the items are in the player: `positionMs` reports the requested start, `seekTo`/`pause` are queued and applied right after the controller's own start seek (posted). |
| credentials `user:pass@` in the URL | `Engine2160.splitCredentials`: the URL without them plus `Authorization: Basic …` in `PlaybackRequest.headers`. 2160 sends the headers with the stream and the subtitle downloads. `User-Agent: OMP` as before. |
| `play`/`pause`/`seekTo`/`retry` | `player.play()` / `player.pause()` / `player.seekTo()` / `controller.retry()` (clears its error, then `prepare()` and `play()`). |
| `positionMs`/`durationMs`/`playWhenReady`/`isBuffering` | The ExoPlayer, the same as Media3Engine. |
| `onReady`/`onFirstFrame`/`onBuffering`/`onPlayingChanged`/`onTracksChanged`/`onEnded` | The same `Player.Listener` logic as Media3Engine: first frame, or READY for audio-only; end once, as a pause at the end or STATE_ENDED. |
| `onError(kind, detail)` | `Engine2160.errorKind` is the same table as before. The detail is `errorCodeName`, or `OUT_OF_MEMORY` (`PlayerBuffer.causedByOom`), so `EngineChooser.onError` behaves as before (DECODING_FAILED, OOM). **New:** errors that the controller's own listener has already recovered are not reported. Its listener runs first and calls `prepare()` (AUDIO_TRACK_INIT_FAILED with passthrough → decode instead; BEHIND_LIVE_WINDOW). The engine sees `player.playerError == null` and skips the report, so a TV that claims AC3/DTS output and cannot open it no longer sends the item to VLC. |
| `audioTracks`/`subtitleTracks` | Supported groups of `currentTracks` with ids `g<n>`, codec names and channels as before (+ `PCM`, DTS:X). External files are recognised by the controller's format id `ext:<item>:<uri hash>` → index in `EngineMedia.subtitles` (`Engine2160.externalIndex`). |
| `selectAudio`/`selectSubtitle` | `TrackSelectionOverride` on the controller's player, the same as before. It does not go through `controller.select()`, so no "habit" is recorded. |
| `setPreferences(TrackPrefs)` | Replaces 2160's selector languages (its settings default to `["ru"]`) with OMP's: preferred audio/subtitle language, overrides cleared, text disabled when subtitles are off. "Subtitles off" carries over to the next items as with Media3Engine. |
| external subtitles (`SubFile`) | `ExternalSubtitle(uri, name = "<label>.<ext>", language)`, only srt/ass/ssa/vtt as before. 2160 takes the MIME from the name's extension and the label from the rest. Bonus: 2160 downloads the file first and re-encodes cp1251 to UTF-8. |
| memory buffer cap (`PlayerBuffer.capBytes`) | **Not possible**, see Gaps. |
| passthrough / audio sink / FFmpeg fallback | 2160's `PlayerFactory`: `NextRenderersFactory` with `EXTENSION_RENDERER_MODE_ON` (MediaCodec first, nextlib FFmpeg after, same order as OMP's `OmpRenderers`), decoder fallback, `DefaultAudioSink` (float off) wrapped in `GuardedAudioSink`, audio attributes MOVIE + focus, becoming-noisy. Differences: 2160 also adds nextlib's **FFmpeg video** renderer after MediaCodec (OMP excluded it), and it lets tracks exceed the reported renderer capabilities. |
| `hostStopped`/`hostStarted` | Nothing to do (as before). `PlayerActivity` pauses the engine on stop. |
| `release()` | Our listener removed, view unbound and removed, `controller.release()` (it releases the ExoPlayer, the FFmpeg analyzer and the MediaSession). |

### Keeping 2160's own features out of OMP's way
- **History/resume**: the controller saves progress to its `ResumeStore` every ~5 s and restores tracks, speed and subtitle delay from it. The engine deletes the item's entry (`ResumeStore.keyFor(uri)`) before creating the controller and after releasing it. OMP's resume points (journal) stay the only ones, and `startPositionMs` is always explicit (0 = from the start).
- **Smart track habits**: they are applied only when a habit exists, and habits are recorded only through `controller.select()`/`disableSubtitles()`, which OMP never calls. Our `setPreferences` runs after the controller's own selector setup anyway.
- **Sound-based intro detection** (`IntroDetector`): for any file whose name looks like an episode (S01E02…), 15 s after start it would decode the first 10 minutes of audio a second time over the network from TorrServer. The engine passes `QUIET_SEGMENTS`: INTRO and CREDITS at `Long.MAX_VALUE/2`, which no position reaches, so the controller treats both as "known", skips the search, and never auto-skips. OMP's `Skips.kt` decides as before. This is a workaround; an upstream option would be cleaner (see Gaps).
- **Chapters**: the controller still opens the URL once with FFmpeg (`MediaAnalyzer.chapters`) to read chapters for its own state. That is one extra short HTTP read at start; OMP ignores the result (chapters come from the page).
- 2160 `Settings` (process-wide prefs `p2160_settings`) are not changed, except `nightMode` through the new menu row.

### 2160 features exposed / not exposed
- **Exposed: «Ночной звук»** (dynamic range compression + dialogue lift, §16). One text row in the existing player menu: «Ночной звук: Вкл/Выкл» / «Night sound: On/Off» (new I18n keys `player.nightRow`, `player.on`), shown only for engines with `nightMode != null`. Selecting it toggles `controller.setNightMode()` now and persists `Settings.nightMode` for the next items and runs (then multichannel is also downmixed to stereo at controller start). While it is on, **passthrough is off** (the receiver gets PCM), and turning it off restores passthrough only from the next item.
- **Free, no UI**: Dolby Vision without a decoder → HDR10 base layer (§15.5); M2TS/Blu-ray extractor (TrueHD, LPCM, DTS-HD, PGS); **Blu-ray ISO** when the URL's last path segment ends in `.iso` (TorrServer `/stream/Film.iso?...`, Range requests with our headers). Whether the page ever sends an `.iso` to the native player is not checked here (later). BDMV folders over HTTP are not supported by 2160.
- **Not exposed (would need new UI or conflicts with OMP)**: 2160's PlayerScreen and panels, subtitle style/size, subtitle delay, secondary subtitles, speed, video track/quality choice, resize modes, decoder preference (HARDWARE/FFMPEG), night schedule, `report()` warnings (software 4K decoding, DV without decoder, HDR on SDR), smart tracks, manual intro/credits marks, sound-based intro detection, MediaSession/background playback. Candidates for later: the decoder preference ("always FFmpeg" helps boxes with green screen) and the warnings as an OMP message.

### Manifest
Removed from the merged manifest with `tools:node="remove"` in OMP's `AndroidManifest.xml`:
- `tv.p2160.core.engine.PlaybackService` (exported MediaSessionService). Engine2160 does not need it: `PlaybackSessions.attach` starts it inside `runCatching`, and `startService` of an undeclared component returns null without throwing. The MediaSession itself is still created (media keys go to the activity first). This also affects stage 4 (`Player2160Activity` on the phone): there is no notification controls/background playback there unless it is put back.
- `androidx.media3.session.BluetoothValidationActivity` (exported, media3-session 1.11).
- Kept: `Player2160Activity` (`exported="false"`, for stage 4) and the permission `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (now unused; harmless, can be removed the same way).

### Verification
- `node scripts/gradle.mjs testDebugUnitTest`: **505 tests, 0 failures, 0 errors, 0 skipped** (499 − 4 Media3Engine + 10 Engine2160: error kinds, codec names, track mapping, external subtitle index by URI hash, subtitle names/MIME, credentials → Basic header, percent decoding, quiet segments, night sound only on the 2160 engine). `EngineChooserTest`/`EngineSwitcherTest`/`PlayerSessionTest` unchanged and green.
- `npm run android:debug`: **BUILD SUCCESSFUL**, no warnings in OMP's code. `capacitor.build.gradle` / `capacitor.settings.gradle` restored. The merged manifest has no `PlaybackService` or `BluetoothValidationActivity`. The arm64 dex has `Engine2160` and no `Media3Engine`.
- APK sizes (debug): arm64 68 029 448, armv7 65 453 843, universal 108 048 793 bytes. The same as stage 2.
- `npx vitest run`: **316 files, 3517 tests passed**.
- Not done: device checks (controller, Dune), CI, release build.

### Gaps in 2160's API (upstream requests; not blocking this stage)
1. **No buffer/LoadControl setting.** `PlayerFactory` uses the default `DefaultLoadControl` (≈131 MB video target). OMP capped it at a quarter of the heap (16–64 MB) because 4K on a 128 MB-heap Dune died of OOM. OMP has `largeHeap="true"`; on boxes where that is still small, "Авто" moves the item to VLC on OOM even mid-play (unchanged logic), and "Встроенный" shows the error. Needed upstream: e.g. `PlayerController(context, request, options)` with `targetBufferBytes`, or a `Settings`/request field.
2. **HTTP timeouts are fixed at 15 s connect / 20 s read** (OMP used 30 s / 60 s). A torrent that takes over 20 s to deliver its first bytes may now fail with NETWORK (OMP shows the error; no VLC switch for NETWORK). Needed upstream: configurable timeouts (same options object).
3. **No switch for intro detection / chapter analysis** (worked around with `QUIET_SEGMENTS`; chapters are still read once). Needed upstream: e.g. `PlaybackRequest.analyze = false`.
4. 2160 adds nextlib's **FFmpeg video** renderer after MediaCodec. A file the box cannot decode in hardware (e.g. 10-bit HEVC 4K on a weak SoC) may now be decoded in software instead of failing over to VLC. Check on the Dune; if it is bad, upstream should allow excluding software video (or `DecoderPreference.HARDWARE` for video only).

### Device test checklist (Dune, Android 9, 32-bit Realtek → LG TV → AV receiver)
Setting «Плеер» = «Встроенный» unless noted. Check `adb logcat -s OmpPlayer` as you go.
1. **Passthrough**: AC3 5.1, E-AC3 (incl. Atmos/JOC), DTS, DTS-HD MA, TrueHD (Atmos). The receiver shows the bitstream format where the box/TV chain allows it; otherwise there is sound via decode (no error, no VLC switch). Note any "recovered by the engine: ERROR_CODE_AUDIO_TRACK_INIT_FAILED" in the log.
2. **Night sound**: menu → «Ночной звук: Выкл» → select: the receiver switches to PCM, loud scenes are quieter. Turn it off; the next episode is passthrough again. The setting survives closing and reopening the player.
3. **HDR10 / HLG / Dolby Vision** (profile 5, profile 7/8 remux): the TV switches to HDR/DV; DV p7 plays as HDR10 (base layer).
4. **4K HEVC 10-bit high bitrate** for 10+ minutes: no OOM (largeHeap), no stutter; look for the FFmpeg video renderer in the log (software decoding).
5. **Track switching**: audio ↔ audio during playback (incl. passthrough ↔ PCM track); subtitle on/off/embedded/external; the menu labels («Русский · Дубляж · AC3 5.1», «… (файл)»).
6. **Subtitles**: SRT (UTF-8 and cp1251), ASS/SSA (styled; in «Авто» ASS still moves to VLC as before), PGS (Blu-ray remux), VTT; external files from the torrent; preferred languages from the TV settings; "subtitles off" carries to the next episode.
7. **Seek**: ◀/▶ accumulation, seek during start-up (right after opening), seek near the end, chapter keys (CH+/CH−).
8. **Resume**: start from a saved resume point; close and reopen; position reported to the page («История»), no jump to an old 2160 position.
9. **Next episode**: countdown at the end/credits, autoplay of the next item, ⏭/⏮, resume of the next item.
10. **Skip intro/credits**: «Пропустить заставку», auto skip with «Вернуть», credits → next item; nothing skips by itself beyond OMP's logic.
11. **Phone remote**: play/pause/seek/skip/next from the phone; state on the phone stays in sync.
12. **Donate QR** on pause and during the credits (also right after opening, it must not flash).
13. **VLC fallback**: «Авто» + a file the built-in engine cannot open (e.g. a codec the box lacks and FFmpeg does not cover, or a broken container) → "Встроенный плеер не открыл этот файл — включён VLC", same position; menu «Плеер: … → сменить» both ways; «VLC не справляется» → «Вернуться к встроенному».
14. **Slow torrent start** (few peers): the start waits instead of failing (20 s read timeout, Gap 2).
15. **TorrServer with auth** (user:password): video and external subtitles play.
16. **Blu-ray ISO** from a torrent (if the page sends it): plays the main title.
17. **Leaving the app** (Home) during playback: playback pauses; back in the app, it resumes correctly; no notification / no background sound.
