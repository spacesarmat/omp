package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.Base64
import java.util.Locale

/**
 * What the engine knows about the item playing, for the «Инфо» panel: video codec, size, HDR kind, bitrate (bit/s,
 * 0: unknown), whether the audio goes out as passthrough (null: the engine cannot tell), the player's own buffer ahead.
 */
data class EngineMediaInfo(
    val videoCodec: String = "",
    val width: Int = 0,
    val height: Int = 0,
    val hdr: String = "",
    val bitrate: Long = 0,
    val passthrough: Boolean? = null,
    val bufferedMs: Long = -1,
)

/** TorrServer's view of the torrent (`/cache` get: Torrent + cache), for the «Инфо» panel. */
data class TorrentStats(
    val seeders: Int = 0,
    val activePeers: Int = 0,
    val totalPeers: Int = 0,
    /** Bytes per second. */
    val downSpeed: Double = 0.0,
    val upSpeed: Double = 0.0,
    /** Bytes loaded ahead of the reader (preload), 0 when unknown. */
    val preloaded: Long = 0,
    val cacheFilled: Long = 0,
    val cacheCapacity: Long = 0,
)

/**
 * TorrServer statistics of the torrent of a stream URL, as the LG player's statistics overlay reads them
 * (POST /cache { action: "get", hash }, src/api/torrserver.ts cache()). Pure parts plus a blocking fetch.
 */
object TorrServerStats {
    /** The request for a stream URL: the /cache URL (no credentials), the Basic header (or null) and the hash. */
    data class Request(val url: String, val authorization: String?, val hash: String)

    /** Null for a URL that is not a TorrServer stream (`…/stream…?link=<hash>`). */
    fun request(streamUrl: String): Request? {
        val u = try {
            URI(streamUrl)
        } catch (_: Exception) {
            return null
        }
        val scheme = u.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "http" && scheme != "https") return null
        val path = u.rawPath ?: return null
        val at = path.indexOf("/stream")
        if (at < 0) return null
        val link = (u.rawQuery ?: "").split('&').firstOrNull { it.startsWith("link=") }?.substringAfter('=') ?: return null
        val hash = decode(link).trim()
        if (hash.isEmpty()) return null
        val host = u.rawAuthority?.substringAfter('@') ?: return null
        val auth = u.rawUserInfo?.let { info ->
            val user = decode(info.substringBefore(':'))
            val pass = decode(info.substringAfter(':', ""))
            "Basic " + Base64.getEncoder().encodeToString("$user:$pass".toByteArray(Charsets.UTF_8))
        }
        return Request("$scheme://$host${path.substring(0, at)}/cache", auth, hash)
    }

    private fun decode(s: String): String = URLDecoder.decode(s.replace("+", "%2B"), "UTF-8")

    /** The answer of /cache; null when it is not an object. */
    fun parse(body: String): TorrentStats? {
        val o = try {
            JSONObject(body)
        } catch (_: Exception) {
            return null
        }
        val t = o.optJSONObject("Torrent") ?: JSONObject()
        return TorrentStats(
            seeders = t.optInt("connected_seeders", 0),
            activePeers = t.optInt("active_peers", 0),
            totalPeers = t.optInt("total_peers", 0),
            downSpeed = t.optDouble("download_speed", 0.0).let { if (it.isNaN()) 0.0 else it },
            upSpeed = t.optDouble("upload_speed", 0.0).let { if (it.isNaN()) 0.0 else it },
            preloaded = t.optLong("preloaded_bytes", 0L),
            cacheFilled = o.optLong("Filled", 0L),
            cacheCapacity = o.optLong("Capacity", 0L),
        )
    }

    /** Asks TorrServer (blocking, off the UI thread); null on any failure. */
    fun fetch(r: Request): TorrentStats? {
        var c: HttpURLConnection? = null
        return try {
            c = URL(r.url).openConnection() as HttpURLConnection
            c.connectTimeout = 3_000
            c.readTimeout = 3_000
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("User-Agent", "OMP")
            r.authorization?.let { c.setRequestProperty("Authorization", it) }
            c.outputStream.use { it.write(JSONObject().put("action", "get").put("hash", r.hash).toString().toByteArray(Charsets.UTF_8)) }
            if (c.responseCode !in 200..299) null else parse(c.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() })
        } catch (_: Exception) {
            null
        } finally {
            c?.disconnect()
        }
    }
}

/** The text of the «Инфо» panel (Info / yellow key): one fact per line, readable from the sofa. Pure. */
object PlayerInfoText {
    /** The file name of a TorrServer stream URL (`/stream/<name>?…`), decoded; '' when there is none. */
    fun fileName(streamUrl: String): String {
        val path = try {
            URI(streamUrl).rawPath ?: ""
        } catch (_: Exception) {
            return ""
        }
        val at = path.indexOf("/stream/")
        if (at < 0) return ""
        val raw = path.substring(at + "/stream/".length).substringAfterLast('/')
        return try {
            URLDecoder.decode(raw.replace("+", "%2B"), "UTF-8")
        } catch (_: Exception) {
            raw
        }
    }

    /** «HEVC», «H.264», «AV1»… from a Media3 MIME type or a VLC fourcc; '' when unknown. */
    fun videoCodec(mimeOrFourcc: String?): String = when (mimeOrFourcc?.trim()?.lowercase(Locale.ROOT)) {
        "video/hevc", "hevc", "h265", "hvc1", "hev1" -> "HEVC"
        "video/avc", "h264", "avc1", "avc" -> "H.264"
        "video/av01", "av01", "av1" -> "AV1"
        "video/x-vnd.on2.vp9", "vp90", "vp9" -> "VP9"
        "video/x-vnd.on2.vp8", "vp80", "vp8" -> "VP8"
        "video/mpeg2", "mpgv", "mp2v", "mpeg2" -> "MPEG-2"
        "video/mp4v-es", "mp4v", "xvid", "divx" -> "MPEG-4"
        "video/wvc1", "wvc1", "vc1", "vc-1" -> "VC-1"
        "video/dolby-vision", "dvhe", "dvh1", "dav1" -> "Dolby Vision"
        else -> mimeOrFourcc?.substringAfter('/')?.uppercase(Locale.ROOT).orEmpty()
    }

    /** «1,2 МБ» style sizes (B, KB, MB, GB). */
    fun bytes(n: Long): String {
        val units = listOf("info.b", "info.kb", "info.mb", "info.gb")
        var v = n.toDouble().coerceAtLeast(0.0)
        var u = 0
        while (v >= 1024 && u < units.size - 1) {
            v /= 1024
            u++
        }
        val num = if (u == 0 || v >= 100) String.format(Locale.ROOT, "%.0f", v) else String.format(Locale.ROOT, "%.1f", v)
        return (if (I18n.lang == "en") num else num.replace('.', ',')) + " " + I18n.s(units[u])
    }

    /** «5,4 Мбит/с» from bytes per second (the video bitrate). */
    fun speed(bytesPerSec: Double): String {
        val mbit = bytesPerSec * 8 / 1_000_000
        val num = if (mbit >= 10) String.format(Locale.ROOT, "%.0f", mbit) else String.format(Locale.ROOT, "%.1f", mbit)
        return I18n.s("info.mbps", "v" to if (I18n.lang == "en") num else num.replace('.', ','))
    }

    private fun bitrate(bps: Long): String = speed(bps / 8.0)

    /** «2,1 МБ/с», «350 КБ/с», «0» for nothing: a transfer rate in bytes per second. */
    fun rate(bytesPerSec: Double): String {
        if (bytesPerSec < 1) return "0"
        return I18n.s("info.perSec", "v" to bytes(bytesPerSec.toLong()))
    }

    /** «1 сид», «3 сида», «7 сидов» (ru); «1 seed», «7 seeds» (en). Keys `<key>.one/few/many`. */
    fun plural(key: String, n: Int): String {
        val form = if (I18n.lang == "en") {
            if (n == 1) "one" else "many"
        } else {
            val m10 = n % 10
            val m100 = n % 100
            when {
                m10 == 1 && m100 != 11 -> "one"
                m10 in 2..4 && m100 !in 12..14 -> "few"
                else -> "many"
            }
        }
        return I18n.s("$key.$form", "n" to n.toString())
    }

    /**
     * The panel: the title (and the file when it says something else), then rows «label — value»: the video (codec ·
     * size · HDR · bitrate), the sound (codec · channels · passthrough), the torrent in one row (seeds · peers ·
     * ↓ speed · ↑ speed), the buffer (TorrServer preload / cache · the player's own). Unknown parts are left out;
     * stats null: «нет данных» for the torrent.
     */
    fun panel(title: String, file: String, media: EngineMediaInfo, audio: EngineTrack?, stats: TorrentStats?): InfoPanel {
        val rows = ArrayList<InfoRow>()
        val video = ArrayList<String>()
        if (media.videoCodec.isNotEmpty()) video.add(media.videoCodec)
        if (media.width > 0 && media.height > 0) video.add("${media.width}×${media.height}")
        if (media.hdr.isNotEmpty()) video.add(media.hdr)
        if (media.bitrate > 0) video.add(bitrate(media.bitrate))
        if (video.isNotEmpty()) rows.add(InfoRow(I18n.s("info.video"), video.joinToString(" · ")))
        if (audio != null) {
            val a = ArrayList<String>()
            if (audio.codec.isNotEmpty()) a.add(audio.codec)
            TrackOptions.channels(audio.channels).takeIf { it.isNotEmpty() }?.let { a.add(it) }
            when (media.passthrough) {
                true -> a.add(I18n.s("info.passthrough"))
                false -> a.add(I18n.s("info.decoded"))
                null -> Unit
            }
            if (a.isNotEmpty()) rows.add(InfoRow(I18n.s("info.audio"), a.joinToString(" · ")))
        }
        val buffer = ArrayList<String>()
        if (stats == null) {
            rows.add(InfoRow(I18n.s("info.torrent"), I18n.s("info.noData")))
        } else {
            val peers = plural("info.peers", stats.activePeers) +
                if (stats.totalPeers > stats.activePeers) " " + I18n.s("info.ofTotal", "n" to stats.totalPeers.toString()) else ""
            rows.add(
                InfoRow(
                    I18n.s("info.torrent"),
                    listOf(plural("info.seeds", stats.seeders), peers, "↓ " + rate(stats.downSpeed), "↑ " + rate(stats.upSpeed)).joinToString(" · "),
                ),
            )
            val ahead = if (stats.preloaded > 0) stats.preloaded else stats.cacheFilled
            if (ahead > 0) buffer.add(I18n.s("info.bufferServer", "v" to bytes(ahead)))
        }
        if (media.bufferedMs >= 0) buffer.add(I18n.s("info.bufferPlayer", "v" to (media.bufferedMs / 1000).toString()))
        if (buffer.isNotEmpty()) rows.add(InfoRow(I18n.s("info.buffer"), buffer.joinToString(" · ")))
        return InfoPanel(title, if (file != title) file else "", rows)
    }
}

/** One row of the «Инфо» panel: a muted label and its value. */
data class InfoRow(val label: String, val value: String)

/** The «Инфо» panel: the title, the file name ('' when it is the title or unknown) and the rows. */
data class InfoPanel(val title: String, val file: String, val rows: List<InfoRow>)

/**
 * The torrent statistics shown in «Инфо»: only for the torrent of the current item, cleared when its fetch fails
 * («нет данных», never frozen numbers), when the item is not a TorrServer stream and when the panel closes.
 */
class InfoStatsState {
    var stats: TorrentStats? = null
        private set
    private var hash: String? = null

    /** The current item's torrent ([h] null: not a TorrServer stream); another torrent drops the old numbers. */
    fun forTorrent(h: String?) {
        if (h != hash) {
            hash = h
            stats = null
        }
    }

    /** An answer for torrent [h] (null: the fetch failed): applies only to the current torrent. */
    fun answer(h: String, s: TorrentStats?) {
        if (h == hash) stats = s
    }

    /** The panel closed: reopening starts without stale numbers. */
    fun closed() {
        hash = null
        stats = null
    }
}
