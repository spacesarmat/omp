package com.spacesarmat.omp

import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.InstallCodes
import com.spacesarmat.omp.install.InstallFailure
import com.spacesarmat.omp.install.Item
import com.spacesarmat.omp.install.ReleaseDownloader
import com.spacesarmat.omp.install.ReleaseHosts
import com.spacesarmat.omp.install.ReleaseHttp
import com.spacesarmat.omp.install.ReleasePackage
import java.io.File
import org.json.JSONException
import org.json.JSONObject

/** The pinned TorrServer download (res/raw/torrserver.json, written by scripts/torrserver-bump.mjs). */
data class TorrServerPin(val tag: String, val url: String, val sha256: String, val size: Long) {
    companion object {
        private val TAG = Regex("^[A-Za-z0-9._-]{1,64}$")
        private val SHA256 = Regex("^[0-9a-f]{64}$")
        private const val MAX_SIZE = 256L * 1024 * 1024

        /** Null when the file is malformed or points anywhere but the GitHub release CDN. */
        fun parse(json: String): TorrServerPin? = try {
            val o = JSONObject(json)
            val pin = TorrServerPin(o.optString("tag"), o.optString("url"), o.optString("sha256"), o.optLong("size", 0L))
            pin.takeIf {
                TAG.matches(it.tag) && SHA256.matches(it.sha256) && ReleaseHosts.allowed(it.url) && it.size in 1..MAX_SIZE
            }
        } catch (_: JSONException) {
            null
        }
    }
}

/** What the phone has: the pinned binary, an older verified one (still runs), or nothing usable. */
enum class BinaryState(val id: String) { READY("ready"), OUTDATED("outdated"), MISSING("missing") }

/**
 * The embedded TorrServer binary in app-private storage ([dir], under noBackupFilesDir), downloaded on demand from
 * the pinned GitHub release asset and checked against its sha256 and size. A marker (`version.json`: tag, sha256,
 * size) is written only after a verified install, so an interrupted download or swap reads as [BinaryState.MISSING].
 *
 * Android 10+ forbids exec() of app data files for apps targeting API 29+ (SELinux: no `execute_no_trans` on
 * app_data_file), but still allows mapping them executable. The TorrServer android build is a PIE linked against
 * bionic (interpreter /system/bin/linker64), so it is started through the system linker ([command]).
 */
class TorrServerBinary(private val dir: File, val pin: TorrServerPin) {
    val file = File(dir, NAME)
    private val marker = File(dir, MARKER)

    fun state(): BinaryState {
        if (!file.isFile) return BinaryState.MISSING
        val m = try {
            JSONObject(marker.readText())
        } catch (_: Exception) {
            return BinaryState.MISSING
        }
        if (m.optLong("size", -1L) != file.length()) return BinaryState.MISSING
        return if (m.optString("tag") == pin.tag && m.optString("sha256") == pin.sha256) BinaryState.READY else BinaryState.OUTDATED
    }

    /** A verified binary is in place (the pinned one or an older one). */
    fun runnable() = state() != BinaryState.MISSING

    /**
     * Downloads the pinned binary (size cap = the pinned size), verifies it, swaps it in read-only and executable, then
     * writes the marker. Throws [InstallFailure] (NETWORK, CHECKSUM, PHONE_SPACE, CANCELLED, …); on failure the old
     * binary, if any, is gone only when the swap itself failed.
     */
    fun install(http: ReleaseHttp, cancel: CancelToken, percent: (Int) -> Unit, verifying: () -> Unit = {}) {
        dir.mkdirs()
        val tmp = File(dir, "download")
        try {
            val pkg = ReleasePackage(Item.TORRSERVER, NAME, pin.tag, pin.url, pin.sha256, pin.size)
            val got = ReleaseDownloader(http, tmp).fetch(pkg, pin.size, cancel, percent, verifying)
            cancel.check()
            marker.delete()
            if (file.exists()) {
                file.setWritable(true, true)
                file.delete()
            }
            if (!got.renameTo(file)) throw InstallFailure(InstallCodes.PHONE_SPACE)
            // owner-only read + execute, no write: a verified file is never modified in place
            file.setReadable(false, false)
            file.setReadable(true, true)
            file.setExecutable(false, false)
            if (!file.setExecutable(true, true) || !file.canExecute()) throw InstallFailure(InstallCodes.UNKNOWN)
            file.setWritable(false, false)
            val m = JSONObject().put("tag", pin.tag).put("sha256", pin.sha256).put("size", file.length())
            val part = File(dir, "$MARKER.part")
            part.writeText(m.toString())
            if (!part.renameTo(marker)) {
                part.delete()
                throw InstallFailure(InstallCodes.PHONE_SPACE)
            }
        } finally {
            tmp.deleteRecursively()
        }
    }

    companion object {
        const val NAME = "torrserver"
        const val MARKER = "version.json"
        const val LINKER64 = "/system/bin/linker64"

        /** TorrServer is built for arm64 only; a 32-bit APK on an arm64 phone runs it too (separate process). */
        fun supported(abis: List<String>) = abis.any { it == "arm64-v8a" }

        /**
         * The argv that starts [binary]: through the system linker on Android 10+ (API 29), where exec() of app data
         * files is denied; directly on Android 8–9, which still allow it.
         */
        fun command(sdkInt: Int, binary: String, args: List<String>): List<String> =
            if (sdkInt >= 29) listOf(LINKER64, binary) + args else listOf(binary) + args

        /** Russian text with the next step for a download failure code; [mb] = download size. */
        fun downloadError(code: String, mb: Long): String = when (code) {
            InstallCodes.NETWORK -> "Не удалось скачать TorrServer: нет связи с GitHub. Проверьте интернет и повторите."
            InstallCodes.CHECKSUM, InstallCodes.TOO_BIG -> "Файл TorrServer пришёл повреждённым и удалён. Повторите загрузку."
            InstallCodes.PHONE_SPACE -> "Не хватает места: нужно около $mb МБ. Освободите место на телефоне и повторите."
            InstallCodes.CANCELLED -> CANCELLED
            else -> "Не удалось скачать TorrServer. Повторите позже."
        }

        const val CANCELLED = "Загрузка отменена"
    }
}
