// Capacitor regenerates android/capacitor-cordova-android-plugins/build.gradle on every `cap sync` with a
// flatDir repository (we ship no Cordova plugins or local .aar files), which makes Gradle warn on each build.

/** The Gradle file without any `flatDir { ... }` block (simple, unnested braces only). */
export function stripFlatDir(text) {
  return text.replace(/^[ \t]*flatDir\s*\{[^{}]*\}[ \t]*\r?\n?/gm, '');
}
