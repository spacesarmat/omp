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

    fun ompAndroid(cancel: CancelToken): ReleasePackage =
        parseFeed(http.text(FEED_ANDROID + "?t=" + now(), FEED_MAX, cancel), Item.OMP, "omp.apk")

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

        /** update.json / update-android.json: version, ipkUrl (HTTPS GitHub), ipkHash (sha256), ipkSize. */
        fun parseFeed(json: String, item: Item, fileName: String): ReleasePackage {
            try {
                val o = JSONObject(json)
                val version = o.optString("version")
                val url = o.optString("ipkUrl")
                val sha = o.optString("ipkHash").lowercase()
                val size = o.optLong("ipkSize", 0L).coerceAtLeast(0L)
                if (!VERSION.matches(version) || !ReleaseHosts.allowed(url) || !SHA256.matches(sha)) {
                    throw InstallFailure(InstallCodes.RELEASE)
                }
                return ReleasePackage(item, fileName, version.removePrefix("v"), url, sha, size)
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
 * belongs to the caller (delete it when done); on any failure nothing is left behind.
 */
class ReleaseDownloader(private val http: ReleaseHttp, private val dir: File) {
    fun fetch(pkg: ReleasePackage, cap: Long, cancel: CancelToken, percent: (Int) -> Unit, verifying: () -> Unit = {}): File {
        if (pkg.size > cap) throw InstallFailure(InstallCodes.TOO_BIG)
        dir.mkdirs()
        val part = File(dir, pkg.fileName + ".part")
        val target = File(dir, pkg.fileName)
        part.delete()
        target.delete()
        val needed = if (pkg.size > 0) pkg.size else cap
        if (dir.usableSpace in 1 until needed + SPACE_MARGIN) throw InstallFailure(InstallCodes.PHONE_SPACE)
        val digest = MessageDigest.getInstance("SHA-256")
        var ok = false
        try {
            http.stream(pkg.url, cancel) { input, length ->
                val limit = if (pkg.size > 0) pkg.size else cap
                if (length > limit) throw InstallFailure(InstallCodes.TOO_BIG)
                val total = if (pkg.size > 0) pkg.size else length
                var done = 0L
                var last = -1
                percent(0)
                part.outputStream().use { out ->
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
        } catch (e: IOException) {
            if (e.message?.contains("ENOSPC") == true) throw InstallFailure(InstallCodes.PHONE_SPACE, cause = e)
            throw if (cancel.cancelled) InstallFailure(InstallCodes.CANCELLED, cause = e) else InstallFailure(InstallCodes.NETWORK, cause = e)
        } finally {
            part.delete()
            if (!ok) target.delete()
        }
    }

    companion object {
        private const val SPACE_MARGIN = 8L * 1024 * 1024
    }
}

/** [ReleaseHttp] over OkHttp: redirects are followed by hand so every hop passes [ReleaseHosts]. */
class OkReleaseHttp : ReleaseHttp {
    private val client = OkHttpClient.Builder()
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

    override fun stream(url: String, cancel: CancelToken, read: (InputStream, Long) -> Unit) {
        var current = url
        for (hop in 0..MAX_REDIRECTS) {
            if (!ReleaseHosts.allowed(current)) throw InstallFailure(InstallCodes.RELEASE)
            cancel.check()
            val req = Request.Builder().url(current)
                .header("User-Agent", "OMP")
                .header("Accept", if (current.startsWith("https://api.github.com/")) "application/vnd.github+json" else "*/*")
                .build()
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
                    if (!resp.isSuccessful) throw InstallFailure(InstallCodes.NETWORK, "HTTP ${resp.code}")
                    val body = resp.body ?: throw InstallFailure(InstallCodes.NETWORK)
                    body.byteStream().use { read(it, body.contentLength()) }
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
