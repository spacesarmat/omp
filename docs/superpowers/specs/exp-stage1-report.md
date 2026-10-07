# Experimental branch, stage 1: OMP on the 2160player toolchain

Date: 2026-10-07. Branch `exp/2160-engine`. Commit `build(android): AGP 9.4, Kotlin 2.4, compileSdk 37`.
Design: `2026-10-07-exp-2160-engine-design.md`. The target versions come from `spacesarmat/2160player` `gradle/libs.versions.toml` and its wrapper.

## Versions

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

## Changes in OMP's own files
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

## Capacitor plugins
Modules: `capacitor-android` (@capacitor/android 8.x), `capacitor-mlkit-barcode-scanning`, `capacitor-app`, `capacitor-clipboard`, and the generated `capacitor-cordova-android-plugins`.

**No plugin issue needs a fix.** All five modules configure and compile under AGP 9.4.1, Gradle 9.6.0 and compileSdk 37 without patches:
- Each plugin still declares `classpath 'com.android.tools.build:gradle:8.13.0'` in its own `buildscript`. The root classloader's AGP 9.4.1 wins, as it did before. No error and no duplicate plugin.
- `lintOptions { ... }` (deprecated DSL) in all plugins is still accepted by AGP 9.4.1.
- No plugin uses `applicationVariants`/`libraryVariants`. No plugin has Kotlin sources, so `compileDebugKotlin` is NO-SOURCE.
- `capacitor-android` has `lintOptions { abortOnError, warningsAsErrors }`. The release build, including `lintVitalAnalyzeRelease`, passes.

No change to `node_modules`, no patch-package, no `subprojects {}` overrides. `capacitor.build.gradle` and `capacitor.settings.gradle` were restored with `git checkout` after each `cap sync`.

Remaining deprecations, which are warnings only and will become errors in **Gradle 10**: "Implicit lookup of properties in parent projects". Every plugin `build.gradle` (and OMP's `app/build.gradle`, for `$androidxAppCompatVersion` etc.) reads the root `ext` versions without a `rootProject.ext.` prefix. Gradle 9.x is fine with this. Capacitor will have to update its templates before Gradle 10.

## Verification
- `npm run android:debug` (cap sync + `assembleDebug`): **BUILD SUCCESSFUL**, from a clean build too.
- `node scripts/gradle.mjs testDebugUnitTest`: **499 tests, 0 failures, 0 skipped**. Same as before the change (499).
- `npx vitest run`: **316 files, 3517 tests passed**.
- Release variant: `assembleRelease` without a keystore stops with the expected error «Нет ключа подписи Android…», which proves configuration works. A full `assembleRelease` with the env variables `ANDROID_KEYSTORE_*` pointing at the local Android debug keystore **succeeds**. `apksigner` shows the APK signed with that key, so the env-based signing still works. Those APKs were deleted.
- Debug APK badging: `compileSdkVersion='37'`, `targetSdkVersion:'36'`, versionCode 1900.
- Not done: no device checks on Dune or S21 (the controller does these), and CI was not run.

## APK sizes (debug, bytes)

| APK | AGP 8.13 | AGP 9.4 | diff |
|---|---|---|---|
| arm64 (`app-arm64-v8a-debug.apk`) | 41 818 164 | 39 768 247 | −2.05 MB |
| armv7 (`app-armeabi-v7a-debug.apk`) | 37 363 142 | 37 498 857 | +0.14 MB |
| universal (`app-universal-debug.apk`) | 65 963 617 | 63 913 688 | −2.05 MB |

- The arm64 drop is `lib/arm64-v8a/libc++_shared.so`, which goes from 9.29 MB to 1.37 MB uncompressed. AGP 8.13 reported "Unable to strip … libc++_shared.so … packaging them as they are". AGP 9.4 strips it. No file was removed: the entry lists are the same except for one new dex shard.
- dex grows by about 135 KB. Kotlin 2.4 generates different code, and the classes are split into 17 dex files instead of 16.
- Release with the debug key, for reference: arm64 35.6 MB, armv7 33.5 MB, universal 58.6 MB.

## Risks and notes
- **targetSdk 37 is postponed.** It needs `ACCESS_LOCAL_NETWORK` handling (runtime request, fallback UX) and a review of the other API 37 behaviour changes. This is a separate task.
- **Gradle 10** will turn the implicit parent-property lookup into an error, in the Capacitor plugin templates and in OMP's `app/build.gradle`. Not urgent on Gradle 9.6.
- **Kotlin 2.4** compiles OMP's code without errors. There are new warnings only, such as `UNEXHAUSTIVE_WHEN_BASED_ON_JAVA_ANNOTATIONS` and `PLATFORM_CLASS_MAPPED_TO_KOTLIN`. Runtime behaviour is covered by the unit tests, but not yet by a device check.
- `libc++_shared.so` is now stripped on arm64. This is expected to be harmless (symbols only), but libVLC, ExoPlayer FFmpeg and ML Kit should be smoke-tested on the S21 and Dune.
- CI now relies on `platforms;android-37.0` being available to `sdkmanager` on the runner. The package id matches the local SDK's `package.xml`.
- `org.gradle.jvmargs` is still `-Xmx1536m`. Debug and release built fine. Stage 2 (player-core) needs `-Xmx4g`, as the spike found.
