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

/** The «Инфо» panel (Info / yellow key): what it shows, every part one short line. Pure. */
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

    /**
     * «HEVC», «AVC», «AV1»… from a Media3 MIME type (with its `codecs` string) or a VLC fourcc; '' when unknown. A
     * Dolby Vision stream gives its base codec (dvhe / dvh1 → HEVC, dav1 → AV1, dvav / dva1 → AVC): DV is its HDR
     * mark ([hdrOf]), never the codec too.
     */
    fun videoCodec(mimeOrFourcc: String?, codecs: String? = null): String {
        val m = mimeOrFourcc?.trim()?.lowercase(Locale.ROOT).orEmpty()
        if (m == "video/dolby-vision" || m in DV_FOURCC) {
            val c = (codecs ?: "").trim().lowercase(Locale.ROOT).substringBefore('.')
            return when {
                c in DV_HEVC || m in DV_HEVC -> "HEVC"
                c == "dav1" || m == "dav1" -> "AV1"
                c in DV_AVC || m in DV_AVC -> "AVC"
                else -> "HEVC"
            }
        }
        return when (m) {
            "video/hevc", "hevc", "h265", "hvc1", "hev1" -> "HEVC"
            "video/avc", "h264", "avc1", "avc" -> "AVC"
            "video/av01", "av01", "av1" -> "AV1"
            "video/x-vnd.on2.vp9", "vp90", "vp9" -> "VP9"
            "video/x-vnd.on2.vp8", "vp80", "vp8" -> "VP8"
            "video/mpeg2", "mpgv", "mp2v", "mpeg2" -> "MPEG-2"
            "video/mp4v-es", "mp4v", "xvid", "divx" -> "MPEG-4"
            "video/wvc1", "wvc1", "vc1", "vc-1" -> "VC-1"
            "" -> ""
            else -> m.substringAfter('/').uppercase(Locale.ROOT)
        }
    }

    private val DV_HEVC = setOf("dvhe", "dvh1")
    private val DV_AVC = setOf("dvav", "dva1")
    private val DV_FOURCC = DV_HEVC + DV_AVC + "dav1"

    /** The short HDR mark of the chip: «DV», «HDR10», «HLG»; '' for SDR. */
    fun hdrMark(hdr: String): String = if (hdr == "Dolby Vision") "DV" else hdr

    private fun num(v: Double, decimals: Boolean): String {
        val s = if (decimals) String.format(Locale.ROOT, "%.1f", v) else String.format(Locale.ROOT, "%.0f", v)
        return if (I18n.lang == "en") s else s.replace('.', ',')
    }

    /** «1,2 МБ» style sizes (B, KB, MB, GB). */
    fun bytes(n: Long): String {
        val (v, u) = bytesParts(n.toDouble())
        return "$v $u"
    }

    /** A size as value and unit: («3,1», «МБ»). */
    private fun bytesParts(n: Double): Pair<String, String> {
        val units = listOf("info.b", "info.kb", "info.mb", "info.gb")
        var v = n.coerceAtLeast(0.0)
        var u = 0
        while (v >= 1024 && u < units.size - 1) {
            v /= 1024
            u++
        }
        return num(v, u > 0 && v < 100) to I18n.s(units[u])
    }

    /** A transfer rate (bytes per second) as value and unit: («3,1», «МБ/с»), («0», «КБ/с») for nothing. */
    fun rateParts(bytesPerSec: Double): Pair<String, String> {
        if (bytesPerSec < 1) return "0" to I18n.s("info.perSec", "v" to I18n.s("info.kb"))
        val (v, u) = bytesParts(bytesPerSec)
        return v to I18n.s("info.perSec", "v" to u)
    }

    /** A bitrate (bit/s) as value and unit: («15,1», «Мбит/с»). */
    fun bitrateParts(bps: Long): Pair<String, String> {
        val mbit = bps / 1_000_000.0
        return num(mbit, mbit < 100) to I18n.s("info.mbit")
    }

    private val EPISODE = Regex("\\bS\\d{1,2}E\\d{1,3}(?:-E?\\d{1,3})?\\b", RegexOption.IGNORE_CASE)

    /** The header's short title: the episode code («S04E02») when the title has one, else the title. */
    fun shortTitle(title: String): String = EPISODE.find(title)?.value?.uppercase(Locale.ROOT) ?: title

    /** How full the buffer bar is: the player's seconds ahead against [BUFFER_TARGET_S], else TorrServer's preload against its cache. */
    const val BUFFER_TARGET_S = 30.0

    /**
     * The panel («variant B»): a header (short title; chip HDR mark + codec + size), three tiles (seeds / peers,
     * download, bitrate; «—» when unknown), the sound line, the buffer (bar + «522 МБ · 17 с»). Pure.
     */
    fun panel(title: String, media: EngineMediaInfo, audio: EngineTrack?, stats: TorrentStats?): InfoPanel {
        val chip = ArrayList<String>()
        if (media.videoCodec.isNotEmpty()) chip.add(media.videoCodec)
        if (media.width > 0 && media.height > 0) chip.add("${media.width}×${media.height}")
        val none = "—" to ""
        val seeds = if (stats == null) none else "${stats.seeders} / ${stats.activePeers}" to ""
        val down = if (stats == null) none else rateParts(stats.downSpeed)
        val rate = if (media.bitrate > 0) bitrateParts(media.bitrate) else none
        val sound = ArrayList<String>()
        if (audio != null) {
            if (audio.codec.isNotEmpty()) sound.add(audio.codec)
            TrackOptions.channels(audio.channels).takeIf { it.isNotEmpty() }?.let { sound.add(it) }
        }
        val soundText = (if (sound.isEmpty()) "" else sound.joinToString(" ")) +
            when (media.passthrough) {
                true -> (if (sound.isEmpty()) "" else " · ") + I18n.s("info.passthrough")
                false -> (if (sound.isEmpty()) "" else " · ") + I18n.s("info.decoded")
                null -> ""
            }
        val server = stats?.let { if (it.preloaded > 0) it.preloaded else it.cacheFilled } ?: 0L
        val bufferParts = ArrayList<String>()
        if (server > 0) bufferParts.add(bytes(server))
        if (media.bufferedMs >= 0) bufferParts.add(I18n.s("info.seconds", "v" to (media.bufferedMs / 1000).toString()))
        val fill = when {
            media.bufferedMs >= 0 -> (media.bufferedMs / 1000.0 / BUFFER_TARGET_S).coerceIn(0.0, 1.0)
            stats != null && stats.preloaded > 0 && stats.cacheCapacity > 0 -> (stats.preloaded.toDouble() / stats.cacheCapacity).coerceIn(0.0, 1.0)
            else -> 0.0
        }
        return InfoPanel(
            title = shortTitle(title),
            hdr = hdrMark(media.hdr),
            chip = chip.joinToString(" · "),
            tiles = listOf(
                InfoTile(I18n.s("info.seedsPeers"), seeds.first, seeds.second),
                InfoTile(I18n.s("info.download"), down.first, down.second),
                InfoTile(I18n.s("info.bitrate"), rate.first, rate.second),
            ),
            sound = soundText.ifEmpty { "—" },
            bufferFill = fill,
            buffer = if (bufferParts.isEmpty()) "—" else bufferParts.joinToString(" · "),
        )
    }
}

/** A tile of the «Инфо» panel: a small muted label, the value (tabular digits) and its unit. */
data class InfoTile(val label: String, val value: String, val unit: String)

/** The «Инфо» panel: header (title, HDR mark, chip), tiles, the sound line, the buffer bar (0..1) and its text. */
data class InfoPanel(
    val title: String,
    val hdr: String,
    val chip: String,
    val tiles: List<InfoTile>,
    val sound: String,
    val bufferFill: Double,
    val buffer: String,
)

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
