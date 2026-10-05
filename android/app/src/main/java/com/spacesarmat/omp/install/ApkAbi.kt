package com.spacesarmat.omp.install

import org.json.JSONObject

/**
 * Which OMP APK suits a device. The Android update feed (update-android.json) has the universal APK at the top level
 * (ipkUrl / ipkHash / ipkSize, the only fields 0.14.x clients read) and per-ABI APKs under `apks`
 * ({ "arm64": { url, sha256, size }, "armv7": { … } }).
 *
 * Rule: the device's primary ABI (first of Build.SUPPORTED_ABIS, or of `ro.product.cpu.abilist` over adb) decides:
 * arm64-v8a → «arm64», armeabi-v7a → «armv7» (a 64-bit CPU with a 32-bit system lists armeabi-v7a first), anything
 * else (x86/x86_64 with ARM translation, unknown, empty) → the universal APK. A missing or malformed per-ABI entry
 * also falls back to the universal APK.
 */
object ApkAbi {
    data class Apk(val url: String, val sha256: String, val size: Long)

    const val ARM64 = "arm64"
    const val ARMV7 = "armv7"
    private val SHA256 = Regex("^[0-9a-f]{64}$")
    private val ABI = Regex("^[A-Za-z0-9_-]{1,32}$")

    /** Feed key for a device ABI list (primary first); null = universal. */
    fun key(abis: List<String>): String? = when (abis.firstOrNull()?.trim()) {
        "arm64-v8a" -> ARM64
        "armeabi-v7a" -> ARMV7
        else -> null
    }

    /** `ro.product.cpu.abilist` («arm64-v8a,armeabi-v7a,armeabi») → ABIs; odd tokens are dropped. */
    fun parseAbiList(text: String?): List<String> =
        (text ?: "").trim().split(',').map { it.trim() }.filter { ABI.matches(it) }.take(8)

    /** The `apks` object of the feed; only HTTPS GitHub release URLs with a valid sha256 are kept. */
    fun parseApks(o: JSONObject?): Map<String, Apk> {
        if (o == null) return emptyMap()
        val out = LinkedHashMap<String, Apk>()
        for (k in listOf(ARM64, ARMV7)) {
            val e = o.optJSONObject(k) ?: continue
            val url = e.optString("url")
            val sha = e.optString("sha256").lowercase()
            val size = e.optLong("size", 0L).coerceAtLeast(0L)
            if (!ReleaseHosts.allowed(url) || !SHA256.matches(sha)) continue
            out[k] = Apk(url, sha, size)
        }
        return out
    }

    /** The APK for [abis]: its per-ABI entry when the feed has one, else [universal]. */
    fun choose(abis: List<String>, universal: Apk, apks: Map<String, Apk>): Apk =
        key(abis)?.let { apks[it] } ?: universal
}
