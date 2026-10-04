package com.spacesarmat.omp.install

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject

/** Only HTTPS to GitHub: the gh-pages feeds, release pages, the API and the release asset CDN. */
object ReleaseHosts {
    val ALLOWED = setOf(
        "raw.githubusercontent.com",
        "github.com",
        "api.github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    )

    fun allowed(url: String?): Boolean {
        val u = url?.toHttpUrlOrNull() ?: return false
        return u.scheme == "https" && u.host in ALLOWED && (u.port == 443)
    }
}

/** One file of a release: what to download and how to check it. */
data class ReleasePackage(
    val item: Item,
    /** Local and remote file name (no directories). */
    val fileName: String,
    val version: String,
    val url: String,
    val sha256: String,
    /** Exact size in bytes; 0 = not published (then only [Releases] caps apply). */
    val size: Long,
)

/** HTTP for the release files; the real one is [OkReleaseHttp], tests use fakes. */
interface ReleaseHttp {
    /** A small text body (JSON) of at most [maxBytes]. */
    fun text(url: String, maxBytes: Int, cancel: CancelToken): String

    /** Opens [url] and passes the body and its length (-1 = unknown) to [read]; the stream is closed afterwards. */
    fun stream(url: String, cancel: CancelToken, read: (InputStream, Long) -> Unit)

    /**
     * Like [stream] from byte [offset] (HTTP Range): [read] gets the body, its length and the offset the body really
     * starts at — 0 when the server sent the whole file. The default does not resume.
     */
    fun streamFrom(url: String, offset: Long, cancel: CancelToken, read: (InputStream, Long, Long) -> Unit) =
        stream(url, cancel) { input, length -> read(input, length, 0L) }
}

/**
 * Latest OMP and Homebrew Channel releases. OMP: the update feeds on gh-pages (same ones the apps check), sha256 and
 * size from there. Homebrew Channel: the GitHub API «latest release»; its ipk is checked against the sha256 of the
 * release's webOS manifest (`ipkHash.sha256`) and GitHub's asset `digest`, whichever are published (both must agree),
 * plus the asset size.
 */
class Releases(private val http: ReleaseHttp, private val now: () -> Long = System::currentTimeMillis) {
    fun ompWebos(cancel: CancelToken): ReleasePackage =
        parseFeed(http.text(FEED_WEBOS + "?t=" + now(), FEED_MAX, cancel), Item.OMP, "omp.ipk")

    /** The APK for a box with these ABIs (primary first, see [ApkAbi]); empty = the universal APK. */
    fun ompAndroid(cancel: CancelToken, abis: List<String> = emptyList()): ReleasePackage =
        parseFeed(http.text(FEED_ANDROID + "?t=" + now(), FEED_MAX, cancel), Item.OMP, "omp.apk", abis)

    fun homebrewChannel(cancel: CancelToken): ReleasePackage {
        val rel = parseHbcRelease(http.text(HBC_LATEST, API_MAX, cancel))
        val manifestSha = rel.manifestUrl?.let { url ->
            try {
                parseHbcManifest(http.text(url, FEED_MAX, cancel))
            } catch (e: InstallFailure) {
                if (e.code == InstallCodes.CANCELLED) throw e
                null
            }
        }
        val sha = hbcHash(manifestSha, rel.digest)
        return ReleasePackage(Item.HBC, "hbchannel.ipk", rel.version, rel.ipkUrl, sha, rel.size)
    }

    companion object {
        const val FEED_WEBOS = "https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update.json"
        const val FEED_ANDROID = "https://raw.githubusercontent.com/spacesarmat/omp/gh-pages/update-android.json"
        const val HBC_LATEST = "https://api.github.com/repos/webosbrew/webos-homebrew-channel/releases/latest"
        private const val FEED_MAX = 64 * 1024
        private const val API_MAX = 512 * 1024
        private val SHA256 = Regex("^[0-9a-f]{64}$")
        private val VERSION = Regex("^v?[0-9]+(\\.[0-9]+){1,3}$")

        /**
         * update.json / update-android.json: version, ipkUrl (HTTPS GitHub), ipkHash (sha256), ipkSize. With [abis]
         * the per-ABI APK from `apks` is taken when the feed has one for that ABI ([ApkAbi.choose]).
         */
        fun parseFeed(json: String, item: Item, fileName: String, abis: List<String> = emptyList()): ReleasePackage {
            try {
                val o = JSONObject(json)
                val version = o.optString("version")
                val url = o.optString("ipkUrl")
                val sha = o.optString("ipkHash").lowercase()
                val size = o.optLong("ipkSize", 0L).coerceAtLeast(0L)
                if (!VERSION.matches(version) || !ReleaseHosts.allowed(url) || !SHA256.matches(sha)) {
                    throw InstallFailure(InstallCodes.RELEASE)
                }
                val apk = ApkAbi.choose(abis, ApkAbi.Apk(url, sha, size), ApkAbi.parseApks(o.optJSONObject("apks")))
                return ReleasePackage(item, fileName, version.removePrefix("v"), apk.url, apk.sha256, apk.size)
            } catch (e: JSONException) {
                throw InstallFailure(InstallCodes.RELEASE, cause = e)
            }
        }

        data class HbcRelease(val version: String, val ipkUrl: String, val size: Long, val digest: String?, val manifestUrl: String?)

        /** GitHub API release: the `.ipk` asset (url, size, `digest` «sha256:…») and the `.manifest.json` asset. */
        fun parseHbcRelease(json: String): HbcRelease {
            try {
                val o = JSONObject(json)
                val assets = o.optJSONArray("assets") ?: throw InstallFailure(InstallCodes.RELEASE)
                var ipk: JSONObject? = null
                var manifest: String? = null
                for (i in 0 until assets.length()) {
                    val a = assets.optJSONObject(i) ?: continue
                    val name = a.optString("name")
                    val url = a.optString("browser_download_url")
                    if (!ReleaseHosts.allowed(url)) continue
                    if (name.endsWith(".ipk") && ipk == null) ipk = a
                    if (name.endsWith(".manifest.json") && manifest == null) manifest = url
                }
                if (ipk == null) throw InstallFailure(InstallCodes.RELEASE)
                val size = ipk.optLong("size", 0L)
                if (size <= 0) throw InstallFailure(InstallCodes.RELEASE)
                val digest = ipk.optString("digest").lowercase().takeIf { it.startsWith("sha256:") }?.removePrefix("sha256:")
                    ?.takeIf { SHA256.matches(it) }
                val tag = o.optString("tag_name").removePrefix("v")
                return HbcRelease(tag.ifEmpty { "?" }, ipk.optString("browser_download_url"), size, digest, manifest)
            } catch (e: JSONException) {
                throw InstallFailure(InstallCodes.RELEASE, cause = e)
            }
        }

        /** webosbrew manifest: `ipkHash.sha256`; null when absent or malformed. */
        fun parseHbcManifest(json: String): String? = try {
            JSONObject(json).optJSONObject("ipkHash")?.optString("sha256")?.lowercase()?.takeIf { SHA256.matches(it) }
        } catch (_: JSONException) {
            null
        }

        /** The checksum to verify: manifest and digest must agree when both exist; at least one is required. */
        fun hbcHash(manifest: String?, digest: String?): String {
            if (manifest != null && digest != null && manifest != digest) throw InstallFailure(InstallCodes.CHECKSUM)
            return manifest ?: digest ?: throw InstallFailure(InstallCodes.RELEASE)
        }
    }
}

/**
 * Downloads a [ReleasePackage] into [dir] (app cache) with a size cap and verifies size and sha256. The returned file
 * belongs to the caller (delete it when done); on any failure nothing is left behind — except, with [resume], the
 * `.part` file after a network failure or a cancel, which the next fetch continues (HTTP Range). The sha256 always
 * covers the whole file, the kept part included.
 */
class ReleaseDownloader(private val http: ReleaseHttp, private val dir: File, private val resume: Boolean = false) {
    fun fetch(pkg: ReleasePackage, cap: Long, cancel: CancelToken, percent: (Int) -> Unit, verifying: () -> Unit = {}): File {
        if (pkg.size > cap) throw InstallFailure(InstallCodes.TOO_BIG)
        dir.mkdirs()
        val part = File(dir, pkg.fileName + ".part")
        val target = File(dir, pkg.fileName)
        target.delete()
        // only a known-size package resumes: its size and sha256 tell a finished file
        var offset = if (resume && pkg.size > 0 && part.isFile && part.length() in 1 until pkg.size) part.length() else 0L
        if (offset == 0L) part.delete()
        val needed = (if (pkg.size > 0) pkg.size else cap) - offset
        if (dir.usableSpace in 1 until needed + SPACE_MARGIN) throw InstallFailure(InstallCodes.PHONE_SPACE)
        val digest = MessageDigest.getInstance("SHA-256")
        var ok = false
        var keepPart = false
        try {
            http.streamFrom(pkg.url, offset, cancel) { input, length, start ->
                // the server sent the whole file: start over
                if (start != offset) {
                    if (start != 0L) throw InstallFailure(InstallCodes.NETWORK)
                    offset = 0L
                }
                val limit = if (pkg.size > 0) pkg.size else cap
                if (length > limit - offset) throw InstallFailure(InstallCodes.TOO_BIG)
                if (offset > 0) {
                    part.inputStream().use { old ->
                        val b = ByteArray(64 * 1024)
                        var left = offset
                        while (left > 0) {
                            val n = old.read(b, 0, minOf(b.size.toLong(), left).toInt())
                            if (n < 0) throw InstallFailure(InstallCodes.NETWORK)
                            digest.update(b, 0, n)
                            left -= n
                        }
                    }
                }
                val total = if (pkg.size > 0) pkg.size else length
                var done = offset
                var last = -1
                percent(if (total > 0) ((done * 100) / total).toInt().coerceIn(0, 100) else 0)
                java.io.FileOutputStream(part, offset > 0).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        cancel.check()
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        if (done > limit) throw InstallFailure(if (pkg.size > 0) InstallCodes.CHECKSUM else InstallCodes.TOO_BIG)
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        if (total > 0) {
                            val p = ((done * 100) / total).toInt().coerceIn(0, 100)
                            if (p != last) {
                                last = p
                                percent(p)
                            }
                        }
                    }
                }
                cancel.check()
                verifying()
                if (pkg.size > 0 && done != pkg.size) throw InstallFailure(InstallCodes.CHECKSUM)
            }
            val actual = digest.digest().joinToString("") { "%02x".format(it) }
            if (actual != pkg.sha256) throw InstallFailure(InstallCodes.CHECKSUM)
            if (!part.renameTo(target)) throw InstallFailure(InstallCodes.PHONE_SPACE)
            ok = true
            return target
        } catch (e: Throwable) {
            val f = when {
                e is InstallFailure -> e
                e is IOException && e.message?.contains("ENOSPC") == true -> InstallFailure(InstallCodes.PHONE_SPACE, cause = e)
                e is IOException && cancel.cancelled -> InstallFailure(InstallCodes.CANCELLED, cause = e)
                e is IOException -> InstallFailure(InstallCodes.NETWORK, cause = e)
                else -> throw e
            }
            keepPart = resume && (f.code == InstallCodes.NETWORK || f.code == InstallCodes.CANCELLED) && part.length() > 0
            throw f
        } finally {
            if (!keepPart) part.delete()
            if (!ok) target.delete()
        }
    }

    companion object {
        private const val SPACE_MARGIN = 8L * 1024 * 1024
    }
}

/** [ReleaseHttp] over OkHttp: redirects are followed by hand so every hop passes [ReleaseHosts]. */
class OkReleaseHttp(
    baseClient: OkHttpClient = OkHttpClient(),
    /** Every hop (the first URL and each redirect) must pass; tests swap in a local-server rule. */
    private val allowed: (String) -> Boolean = ReleaseHosts::allowed,
) : ReleaseHttp {
    private val client = baseClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    override fun text(url: String, maxBytes: Int, cancel: CancelToken): String {
        var text = ""
        stream(url, cancel) { input, length ->
            if (length > maxBytes) throw InstallFailure(InstallCodes.RELEASE)
            val bytes = input.readNBytesCompat(maxBytes + 1)
            if (bytes.size > maxBytes) throw InstallFailure(InstallCodes.RELEASE)
            text = String(bytes, Charsets.UTF_8)
        }
        return text
    }

    override fun stream(url: String, cancel: CancelToken, read: (InputStream, Long) -> Unit) =
        streamFrom(url, 0L, cancel) { input, length, _ -> read(input, length) }

    override fun streamFrom(url: String, offset: Long, cancel: CancelToken, read: (InputStream, Long, Long) -> Unit) {
        var current = url
        var from = offset
        for (hop in 0..MAX_REDIRECTS) {
            if (!allowed(current)) throw InstallFailure(InstallCodes.RELEASE)
            cancel.check()
            val rb = Request.Builder().url(current)
                .header("User-Agent", "OMP")
                .header("Accept", if (current.startsWith("https://api.github.com/")) "application/vnd.github+json" else "*/*")
            // no transparent gzip on a ranged request: offsets must be in file bytes
            if (from > 0) rb.header("Range", "bytes=$from-").header("Accept-Encoding", "identity")
            val req = rb.build()
            val call: Call = client.newCall(req)
            val hook = cancel.onCancel { call.cancel() }
            try {
                call.execute().use { resp ->
                    if (resp.isRedirect) {
                        val next = resp.header("Location")?.let { resp.request.url.resolve(it)?.toString() }
                            ?: throw InstallFailure(InstallCodes.NETWORK)
                        current = next
                        return@use
                    }
                    // the kept part is longer than the file (it changed?): download it whole
                    if (resp.code == 416 && from > 0) {
                        from = 0L
                        return@use
                    }
                    if (!resp.isSuccessful) throw InstallFailure(InstallCodes.NETWORK, "HTTP ${resp.code}")
                    val body = resp.body ?: throw InstallFailure(InstallCodes.NETWORK)
                    val start = if (resp.code == 206) rangeStart(resp.header("Content-Range")) else 0L
                    if (resp.code == 206 && start != from) throw InstallFailure(InstallCodes.NETWORK)
                    body.byteStream().use { read(it, body.contentLength(), start) }
                    return
                }
            } catch (e: IOException) {
                throw if (cancel.cancelled) InstallFailure(InstallCodes.CANCELLED, cause = e) else InstallFailure(InstallCodes.NETWORK, cause = e)
            } finally {
                hook.close()
            }
        }
        throw InstallFailure(InstallCodes.NETWORK)
    }

    companion object {
        private const val MAX_REDIRECTS = 5
        private val CONTENT_RANGE = Regex("^bytes (\\d+)-(\\d+)/(\\d+|\\*)$")

        /** Start offset of «bytes 100-199/200»; -1 when malformed. */
        fun rangeStart(header: String?): Long =
            CONTENT_RANGE.matchEntire(header?.trim() ?: "")?.groupValues?.get(1)?.toLongOrNull() ?: -1L
    }
}

/** InputStream.readNBytes is API 33+: reads up to [max] bytes. */
internal fun InputStream.readNBytesCompat(max: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (out.size() < max) {
        val n = read(buf, 0, minOf(buf.size, max - out.size()))
        if (n < 0) break
        out.write(buf, 0, n)
    }
    return out.toByteArray()
}
