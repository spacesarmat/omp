package com.spacesarmat.omp.control

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONException
import org.json.JSONObject

/** One POST with a bearer token to the TV's control server (HttpURLConnection on the device, a fake in tests). */
interface WatchTransport {
    /** (status, body). Throws [IOException] when the TV does not answer. */
    @Throws(IOException::class)
    fun post(url: String, token: String, body: String): Pair<Int, String>
}

/**
 * The phone side of «Пройти на телефоне»: while the phone is paired with an Android TV ([configure]), it polls the
 * TV for a Cloudflare check ([CloudflareProtocol.POLL]) — every [FG_MS] with the app open, [BG_MS] in the background,
 * and not at all after [BG_LIMIT_MS] in the background (until the app is opened again); failures back off up to
 * [MAX_BACKOFF_MS]. A new request goes to [onRequest] (the app shows the sheet, or a notification in the background) and
 * stays [pending] for [REQUEST_TTL_MS]. [answer] sends the result back. The loop is [step] (pure, tested); [start] runs
 * it on a daemon thread. The token, cookies and User-Agent are never logged.
 */
class CloudflareWatch(
    private val transport: WatchTransport,
    private val foreground: () -> Boolean,
    private val onRequest: (CloudflareProtocol.Request, Boolean) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private class Target(val base: String, val token: String)

    private val lock = Object()
    @Volatile private var target: Target? = null
    private var nextAt = 0L
    private var failures = 0
    private var lastForeground = 0L
    private var lastId: String? = null
    private var pending: CloudflareProtocol.Request? = null
    private var pendingAt = 0L
    private var thread: Thread? = null

    /** Polls [base] (`http://ip:port`) with [token]; null stops. A new target starts polling at once. */
    fun configure(base: String?, token: String?) {
        synchronized(lock) {
            val t = if (base != null && token != null) Target(base.trimEnd('/'), token) else null
            val cur = target
            if (cur?.base == t?.base && cur?.token == t?.token) return
            target = t
            nextAt = 0
            failures = 0
            if (t == null) pending = null else lastForeground = clock()
            lock.notifyAll()
        }
    }

    /** The request still waiting for the person (the app opened from the notification), null when none. */
    fun pending(): CloudflareProtocol.Request? = synchronized(lock) {
        val p = pending ?: return null
        if (clock() - pendingAt > REQUEST_TTL_MS) {
            pending = null
            return null
        }
        p
    }

    /** One loop turn; returns how long to wait before the next one. */
    fun step(): Long {
        val t: Target
        synchronized(lock) {
            t = target ?: return IDLE_MS
            val now = clock()
            val fg = foreground()
            if (fg) lastForeground = now
            if (!fg && now - lastForeground > BG_LIMIT_MS) return IDLE_MS
            if (now < nextAt) return minOf(nextAt - now, IDLE_MS)
        }
        val fg = foreground()
        var gone = false
        var found: CloudflareProtocol.Request? = null
        var delay: Long
        try {
            val (status, body) = transport.post(t.base + CloudflareProtocol.POLL, t.token, "{}")
            when (status) {
                200 -> {
                    failures = 0
                    found = parse(body)
                    delay = if (fg) FG_MS else BG_MS
                }
                // the TV forgot this phone: nothing to poll until the app pairs again
                401 -> {
                    gone = true
                    delay = IDLE_MS
                }
                // an older OMP on the TV without the route
                404 -> delay = OLD_TV_MS
                else -> delay = backoff(fg)
            }
        } catch (e: IOException) {
            delay = backoff(fg)
        }
        var fresh: CloudflareProtocol.Request? = null
        synchronized(lock) {
            if (target !== t) return 0
            if (gone) {
                target = null
                return IDLE_MS
            }
            nextAt = clock() + delay
            val f = found
            if (f != null && f.id != lastId) {
                lastId = f.id
                pending = f
                pendingAt = clock()
                fresh = f
            }
        }
        fresh?.let { onRequest(it, fg) }
        return minOf(delay, IDLE_MS)
    }

    private fun backoff(fg: Boolean): Long {
        failures = minOf(failures + 1, 6)
        val base = if (fg) FG_MS else BG_MS
        return minOf(MAX_BACKOFF_MS, base shl failures)
    }

    private fun parse(body: String): CloudflareProtocol.Request? = try {
        val o = JSONObject(body)
        if (o.opt("request") == JSONObject.NULL) null else CloudflareProtocol.parseRequest(o)
    } catch (e: JSONException) {
        null
    }

    /** Sends the answer body for [id]; the request is no longer pending. Blocking. Returns the HTTP status, -1 when none. */
    fun answer(id: String, body: String): Int {
        val t = synchronized(lock) {
            if (pending?.id == id) pending = null
            target
        } ?: return -1
        return try {
            transport.post(t.base + CloudflareProtocol.ANSWER, t.token, body).first
        } catch (e: IOException) {
            -1
        }
    }

    /** Runs [step] on a daemon thread until the process ends. */
    fun start() {
        synchronized(lock) {
            if (thread != null) return
            thread = Thread({
                while (true) {
                    val wait = try {
                        step()
                    } catch (e: Exception) {
                        IDLE_MS
                    }
                    synchronized(lock) {
                        if (wait > 0) {
                            try {
                                lock.wait(wait)
                            } catch (e: InterruptedException) {
                                return@Thread
                            }
                        }
                    }
                }
            }, "omp-cf-watch").apply {
                isDaemon = true
                start()
            }
        }
    }

    companion object {
        const val FG_MS = 3_000L
        const val BG_MS = 10_000L
        const val IDLE_MS = 1_000L
        const val BG_LIMIT_MS = 30L * 60 * 1000
        const val MAX_BACKOFF_MS = 30_000L
        const val OLD_TV_MS = 5L * 60 * 1000
        const val REQUEST_TTL_MS = CloudflareRelay.ANSWER_MS
    }
}

/** [WatchTransport] over HttpURLConnection: 3 s to connect, 5 s to answer, JSON, at most 64 KiB read. */
class HttpWatchTransport : WatchTransport {
    override fun post(url: String, token: String, body: String): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 3_000
            c.readTimeout = 5_000
            c.doOutput = true
            c.instanceFollowRedirects = false
            c.useCaches = false
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/json")
            val bytes = body.toByteArray(Charsets.UTF_8)
            c.setFixedLengthStreamingMode(bytes.size)
            c.outputStream.use { it.write(bytes) }
            val status = c.responseCode
            val stream = if (status >= 400) c.errorStream else c.inputStream
            val text = stream?.use { s ->
                val buf = ByteArray(65_536)
                var n = 0
                while (n < buf.size) {
                    val r = s.read(buf, n, buf.size - n)
                    if (r < 0) break
                    n += r
                }
                String(buf, 0, n, Charsets.UTF_8)
            } ?: ""
            return status to text
        } finally {
            c.disconnect()
        }
    }
}
