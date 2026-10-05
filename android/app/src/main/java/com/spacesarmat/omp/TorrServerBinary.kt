package com.spacesarmat.omp

import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.InstallCodes
import com.spacesarmat.omp.install.InstallFailure
import com.spacesarmat.omp.install.Item
import com.spacesarmat.omp.install.ReleaseDownloader
import com.spacesarmat.omp.install.ReleaseHttp
import com.spacesarmat.omp.install.ReleasePackage
import java.io.File
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONException
import org.json.JSONObject

/** The pinned TorrServer download (res/raw/torrserver.json, written by scripts/torrserver-bump.mjs). */
data class TorrServerPin(val tag: String, val url: String, val sha256: String, val size: Long) {
    /**
     * Download hops: the pinned URL itself, then only GitHub's release-asset CDN (where github.com redirects).
     */
    fun hopAllowed(hop: String): Boolean {
        if (hop == url) return true
        val u = hop.toHttpUrlOrNull() ?: return false
        return u.scheme == "https" && u.port == 443 && u.host in ASSET_HOSTS
    }

    companion object {
        private val TAG = Regex("^[A-Za-z0-9._-]{1,64}$")
        private val SHA256 = Regex("^[0-9a-f]{64}$")
        private const val MAX_SIZE = 256L * 1024 * 1024
        const val URL_PREFIX = "https://github.com/YouROK/TorrServer/releases/download/"
        const val ASSET = "TorrServer-android-arm64"
        val ASSET_HOSTS = setOf("objects.githubusercontent.com", "release-assets.githubusercontent.com")

        /** Null when the file is malformed or is not exactly the YouROK/TorrServer arm64 asset of its tag. */
        fun parse(json: String): TorrServerPin? = try {
            val o = JSONObject(json)
            val pin = TorrServerPin(o.optString("tag"), o.optString("url"), o.optString("sha256"), o.optLong("size", 0L))
            pin.takeIf {
                TAG.matches(it.tag) && SHA256.matches(it.sha256) && it.url == URL_PREFIX + it.tag + "/" + ASSET &&
                    it.size in 1..MAX_SIZE
            }
        } catch (_: JSONException) {
            null
        }
    }
}

/**
 * What the loader needs from the binary's ELF header: arm64, interpreter (bionic linker) and the smallest PT_LOAD
 * alignment — a segment aligned to 4 KB cannot be mapped on a device with 16 KB pages (some Android 15+ phones).
 */
data class ElfInfo(val machine: Int, val interp: String?, val loadAlign: Long) {
    /** Loadable here: arm64, linked against bionic, segments aligned to at least the page size. */
    fun fits(pageSize: Long) =
        machine == EM_AARCH64 && interp == TorrServerBinary.LINKER64 && loadAlign >= pageSize && loadAlign % pageSize == 0L

    companion object {
        const val EM_AARCH64 = 183
        private const val PT_LOAD = 1
        private const val PT_INTERP = 3

        /** Little-endian ELF64 header with its program headers in [head]; null when it is not one. */
        fun parse(head: ByteArray): ElfInfo? {
            try {
                if (head.size < 64 || head[0] != 0x7f.toByte() || head[1] != 'E'.code.toByte() || head[2] != 'L'.code.toByte() ||
                    head[3] != 'F'.code.toByte() || head[4].toInt() != 2 || head[5].toInt() != 1
                ) return null
                val bb = java.nio.ByteBuffer.wrap(head).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                val machine = bb.getShort(18).toInt() and 0xffff
                val phoff = bb.getLong(32)
                val phentsize = bb.getShort(54).toInt() and 0xffff
                val phnum = bb.getShort(56).toInt() and 0xffff
                if (phoff <= 0 || phentsize < 56 || phnum == 0 || phoff + phnum.toLong() * phentsize > head.size) return null
                var interp: String? = null
                var align = Long.MAX_VALUE
                for (i in 0 until phnum) {
                    val o = (phoff + i.toLong() * phentsize).toInt()
                    when (bb.getInt(o)) {
                        PT_LOAD -> align = minOf(align, bb.getLong(o + 48))
                        PT_INTERP -> {
                            val off = bb.getLong(o + 8)
                            val len = bb.getLong(o + 32)
                            if (off < 0 || len <= 0 || len > 256 || off + len > head.size) return null
                            interp = String(head, off.toInt(), len.toInt(), Charsets.US_ASCII).trimEnd('\u0000')
                        }
                    }
                }
                if (align == Long.MAX_VALUE) return null
                return ElfInfo(machine, interp, align)
            } catch (_: IndexOutOfBoundsException) {
                return null
            }
        }

        /** The first 4 KB of [file] parsed; null when unreadable. */
        fun read(file: File): ElfInfo? = try {
            val buf = ByteArray(4096)
            val n = file.inputStream().use { input ->
                var total = 0
                while (total < buf.size) {
                    val r = input.read(buf, total, buf.size - total)
                    if (r < 0) break
                    total += r
                }
                total
            }
            parse(buf.copyOf(n))
        } catch (_: java.io.IOException) {
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
     * binary, if any, is gone only when the swap itself failed. A download broken by the network or a cancel is kept
     * (`download/torrserver-<sha>.part`) and continued by the next call; the sha256 covers the whole file.
     */
    fun install(http: ReleaseHttp, cancel: CancelToken, percent: (Int) -> Unit, verifying: () -> Unit = {}) {
        dir.mkdirs()
        val tmp = File(dir, "download")
        val name = NAME + "-" + pin.sha256.take(16)
        // a part of another pinned release is useless
        tmp.listFiles()?.forEach { if (it.name != "$name.part") it.deleteRecursively() }
        var ok = false
        try {
            val pkg = ReleasePackage(Item.TORRSERVER, name, pin.tag, pin.url, pin.sha256, pin.size)
            val got = ReleaseDownloader(http, tmp, resume = true).fetch(pkg, pin.size, cancel, percent, verifying)
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
            ok = true
        } finally {
            if (ok || tmp.list().isNullOrEmpty()) tmp.deleteRecursively()
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
            InstallCodes.NETWORK -> I18n.s("ts.dlNetwork")
            InstallCodes.CHECKSUM, InstallCodes.TOO_BIG -> I18n.s("ts.dlCorrupt")
            InstallCodes.PHONE_SPACE -> I18n.s("ts.dlSpace", "mb" to mb.toString())
            InstallCodes.CANCELLED -> CANCELLED
            else -> I18n.s("ts.dlOther")
        }

        val CANCELLED: String get() = I18n.s("ts.dlCancelled")
        /** An exit within this long of the launch counts as «did not start». */
        const val QUICK_EXIT_MS = 10_000L

        /** Give-up text: both runs died right after the launch → [CANNOT_RUN], else [crashed]. */
        fun exitMessage(quick: Boolean, quickBefore: Boolean, crashed: String) = if (quick && quickBefore) CANNOT_RUN else crashed

        /** The binary does not load on this device (16 KB pages, linker refused it, crashes at once). */
        val CANNOT_RUN: String get() = I18n.s("ts.cannotRun")
    }
}
