package com.spacesarmat.omp.audio

import com.spacesarmat.omp.CleartextPolicy
import com.spacesarmat.omp.LocalTorrServer
import java.nio.charset.StandardCharsets
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * One audiobook queue for [AudioPlayerService]: TorrServer stream URLs, in listening order.
 * A chapter of a single m4b is the same URL clipped with [AudioItem.startMs] / [AudioItem.endMs]
 * (0 end means the rest of the file). Pure parsing, so tests do not start a player.
 */
data class AudioItem(
    val url: String,
    val title: String,
    val fileId: Int,
    val startMs: Long,
    val endMs: Long,
)

data class AudioQueue(
    val book: String,
    val hash: String,
    val start: Int,
    val positionMs: Long,
    val items: List<AudioItem>,
)

/** A command from the page. [ms] is a relative seek, [speed] and [sleep] apply to those commands. */
data class AudioCommand(
    val name: String,
    val ms: Long = 0,
    val speed: Float = 1f,
    val sleep: String = AudioSession.SLEEP_OFF,
)

object AudioQueueParser {
    const val MAX_ITEMS = 2000
    private const val MAX_URL = 4000
    private const val MAX_TITLE = 200

    private val COMMANDS = setOf("toggle", "play", "pause", "seek", "next", "prev", "speed", "sleep", "stop")

    /** Null when the payload has no playable http(s) item or a cleartext URL the policy refuses. */
    fun parse(book: String?, hash: String?, start: Int, positionMs: Long, items: JSONArray?): AudioQueue? {
        if (items == null || items.length() == 0 || items.length() > MAX_ITEMS) return null
        val parsed = ArrayList<AudioItem>(items.length())
        for (i in 0 until items.length()) {
            val o = items.optJSONObject(i) ?: return null
            val item = item(o) ?: return null
            if (!CleartextPolicy.allowsUrl(item.url)) return null
            parsed.add(item)
        }
        val at = if (start < 0 || start >= parsed.size) 0 else start
        return AudioQueue(
            book = clip(book, MAX_TITLE).ifEmpty { parsed[at].title },
            hash = clip(hash, 80),
            start = at,
            positionMs = positionMs.coerceAtLeast(0),
            items = parsed,
        )
    }

    fun command(name: String?, ms: Double?, speed: Double?, sleep: String?): AudioCommand? {
        val n = name?.trim().orEmpty()
        if (n !in COMMANDS) return null
        return AudioCommand(
            name = n,
            ms = ms?.toLong() ?: 0L,
            speed = AudioSession.clampSpeed(speed?.toFloat() ?: 1f),
            sleep = AudioSession.normalizeSleep(sleep),
        )
    }

    /**
     * `user:password@` in [url] becomes an Authorization header. The player never sends the password in the URL.
     * No credentials: the URL unchanged and no header.
     */
    fun splitCredentials(url: String): Pair<String, String?> {
        val scheme = url.indexOf("://")
        if (scheme < 0) return url to null
        val from = scheme + 3
        var to = url.length
        for (ch in charArrayOf('/', '?', '#')) {
            val k = url.indexOf(ch, from)
            if (k in from until to) to = k
        }
        val at = url.lastIndexOf('@', to - 1)
        if (at < from) return url to null
        val info = url.substring(from, at)
        val user = percentDecode(info.substringBefore(':'))
        val pass = percentDecode(info.substringAfter(':', ""))
        val token = Base64.getEncoder().encodeToString("$user:$pass".toByteArray(StandardCharsets.UTF_8))
        return (url.substring(0, from) + url.substring(at + 1)) to "Basic $token"
    }

    /**
     * The embedded TorrServer ([LocalTorrServer.PORT] on loopback). A remote server does not keep that service up.
     * Credentials are ignored, so `user:pass@127.0.0.1:8090` still counts.
     */
    fun targetsLocalTorrServer(url: String): Boolean {
        val clean = splitCredentials(url).first
        val scheme = clean.indexOf("://")
        if (scheme < 0) return false
        val from = scheme + 3
        var to = clean.length
        for (ch in charArrayOf('/', '?', '#')) {
            val k = clean.indexOf(ch, from)
            if (k in from until to) to = k
        }
        var hostPort = clean.substring(from, to)
        if (hostPort.startsWith("[")) {
            val end = hostPort.indexOf(']')
            if (end < 0) return false
            val host = hostPort.substring(1, end)
            val port = portAfter(hostPort, end + 1)
            return isLoopback(host) && port == LocalTorrServer.PORT
        }
        val colon = hostPort.lastIndexOf(':')
        val host: String
        val port: Int
        if (colon >= 0) {
            host = hostPort.substring(0, colon)
            port = hostPort.substring(colon + 1).toIntOrNull() ?: return false
        } else {
            host = hostPort
            port = -1
        }
        return isLoopback(host) && port == LocalTorrServer.PORT
    }

    fun stateJson(
        active: Boolean,
        playing: Boolean,
        index: Int,
        positionMs: Long,
        durationMs: Long,
        speed: Float,
        sleep: String,
        title: String,
        book: String,
        fileId: Int,
        error: String?,
    ): JSONObject {
        val o = JSONObject()
        o.put("active", active)
        o.put("playing", playing)
        o.put("index", index)
        o.put("positionMs", positionMs)
        o.put("durationMs", durationMs)
        o.put("speed", speed.toDouble())
        o.put("sleep", sleep)
        o.put("title", title)
        o.put("book", book)
        o.put("fileId", fileId)
        if (!error.isNullOrEmpty()) o.put("error", error)
        return o
    }

    private fun item(o: JSONObject): AudioItem? {
        val url = o.optString("url").trim()
        if (url.length !in 1..MAX_URL) return null
        if (!url.startsWith("http://") && !url.startsWith("https://")) return null
        val start = o.optLong("startMs", 0).coerceAtLeast(0)
        val end = o.optLong("endMs", 0).coerceAtLeast(0)
        return AudioItem(
            url = url,
            title = clip(o.optString("title"), MAX_TITLE).ifEmpty { "—" },
            fileId = o.optInt("fileId", 0),
            startMs = start,
            endMs = if (end > start) end else 0,
        )
    }

    private fun portAfter(hostPort: String, at: Int): Int {
        if (at >= hostPort.length || hostPort[at] != ':') return -1
        return hostPort.substring(at + 1).toIntOrNull() ?: -1
    }

    private fun isLoopback(host: String): Boolean {
        val h = host.lowercase()
        return h == "127.0.0.1" || h == "localhost" || h == "::1"
    }

    private fun clip(s: String?, max: Int): String {
        val t = s?.trim()?.replace('\n', ' ')?.replace('\r', ' ').orEmpty()
        return if (t.length <= max) t else t.substring(0, max)
    }

    /** %XX as UTF-8; a «+» stays a plus (it is not a form encoding). */
    private fun percentDecode(s: String): String {
        if ('%' !in s) return s
        val out = ArrayList<Byte>(s.length)
        var i = 0
        while (i < s.length) {
            if (s[i] == '%' && i + 2 < s.length) {
                val hex = s.substring(i + 1, i + 3)
                val b = hex.toIntOrNull(16)
                if (b != null) {
                    out.add(b.toByte())
                    i += 3
                    continue
                }
            }
            val ch = s[i].code
            if (ch < 128) out.add(ch.toByte()) else out.addAll(s[i].toString().toByteArray(StandardCharsets.UTF_8).toList())
            i++
        }
        return String(out.toByteArray(), StandardCharsets.UTF_8)
    }
}
