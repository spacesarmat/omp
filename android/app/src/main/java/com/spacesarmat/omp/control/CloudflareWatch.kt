package com.spacesarmat.omp.control

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONException
import org.json.JSONObject

/** One POST with a bearer token to the TV's control server (HttpURLConnection on the device, a fake in tests). */
interface WatchTransport {
    /** (status, body). Throws [IOException] when the TV does not answer within [readTimeoutMs]. */
    @Throws(IOException::class)
    fun post(url: String, token: String, body: String, readTimeoutMs: Int): Pair<Int, String>
}

/**
 * The phone side of «Пройти на телефоне». The page configures it only while an Android TV is paired and at least one
 * site has «Обходить проверку Cloudflare» on. It long-polls the TV ([CloudflareProtocol.POLL], the TV holds the poll
 * up to [CloudflareProtocol.MAX_WAIT_MS]) only on Wi-Fi/Ethernet ([onLan]) and only while OMP is open or for
 * [GRACE_MS] after it was left; otherwise the thread sleeps until [wake] (the app comes back, the network changes,
 * [configure]). Failures back off up to [MAX_BACKOFF_MS]. A new request goes to [onRequest]; when the phone cannot show
 * it (false: in the background without notifications) it is declined at once, so the TV says «Откройте OMP на телефоне».
 * A shown request stays [pending] for [REQUEST_TTL_MS]. The loop is [step] (pure, tested); [start] runs it on a daemon
 * thread. The token, cookies and User-Agent are never logged.
 */
class CloudflareWatch(
    private val transport: WatchTransport,
    private val foreground: () -> Boolean,
    private val onLan: () -> Boolean,
    /** true when the request was shown (sheet or notification). */
    private val onRequest: (CloudflareProtocol.Request, Boolean) -> Boolean,
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

    /** The app came to the front or the network changed: look again now. */
    fun wake() {
        synchronized(lock) {
            if (foreground()) lastForeground = clock()
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

    /** One loop turn; returns how long to wait before the next one, [SLEEP] = until [wake]. */
    fun step(): Long {
        val t: Target
        val fg: Boolean
        synchronized(lock) {
            t = target ?: return SLEEP
            val now = clock()
            fg = foreground()
            if (fg) lastForeground = now
            if (!fg && now - lastForeground > GRACE_MS) return SLEEP
            if (!onLan()) return SLEEP
            if (now < nextAt) return nextAt - now
        }
        val started = clock()
        var gone = false
        var found: CloudflareProtocol.Request? = null
        val delay: Long = try {
            val (status, body) = transport.post(t.base + CloudflareProtocol.POLL, t.token, POLL_BODY, READ_TIMEOUT_MS)
            when (status) {
                200 -> {
                    failures = 0
                    found = parse(body)
                    // a TV that answered at once (another phone waits): not more often than this
                    maxOf(0L, MIN_CYCLE_MS - (clock() - started))
                }
                // the TV forgot this phone: nothing to poll until the app pairs again
                401 -> {
                    gone = true
                    0L
                }
                // an older OMP on the TV without the route
                404 -> OLD_TV_MS
                else -> backoff()
            }
        } catch (e: IOException) {
            backoff()
        }
        var fresh: CloudflareProtocol.Request? = null
        synchronized(lock) {
            if (target !== t) return 0
            if (gone) {
                target = null
                return SLEEP
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
        fresh?.let { r ->
            val shown = try {
                onRequest(r, fg)
            } catch (e: Exception) {
                false
            }
            if (!shown) answer(r.id, CloudflareProtocol.unavailableJson(r.id))
        }
        return delay
    }

    private fun backoff(): Long {
        failures = minOf(failures + 1, 6)
        return minOf(MAX_BACKOFF_MS, BACKOFF_MS shl failures)
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
            transport.post(t.base + CloudflareProtocol.ANSWER, t.token, body, ANSWER_TIMEOUT_MS).first
        } catch (e: IOException) {
            -1
        }
    }

    /** Runs [step] on a daemon thread until the process ends; it sleeps while there is nothing to do. */
    fun start() {
        synchronized(lock) {
            if (thread != null) return
            thread = Thread({
                while (true) {
                    val wait = try {
                        step()
                    } catch (e: Exception) {
                        MAX_BACKOFF_MS
                    }
                    synchronized(lock) {
                        try {
                            if (wait == SLEEP) lock.wait() else if (wait > 0) lock.wait(wait)
                        } catch (e: InterruptedException) {
                            return@Thread
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
        /** Until [wake]. */
        const val SLEEP = -1L
        const val GRACE_MS = 5L * 60 * 1000
        const val MIN_CYCLE_MS = 3_000L
        const val BACKOFF_MS = 2_000L
        const val MAX_BACKOFF_MS = 60_000L
        const val OLD_TV_MS = 10L * 60 * 1000
        const val REQUEST_TTL_MS = CloudflareRelay.ANSWER_MS
        val POLL_BODY: String = JSONObject().put("wait", CloudflareProtocol.MAX_WAIT_MS).toString()
        /** Longer than the TV holds a poll. */
        const val READ_TIMEOUT_MS = (CloudflareProtocol.MAX_WAIT_MS + 5_000).toInt()
        const val ANSWER_TIMEOUT_MS = 10_000
    }
}

/** [WatchTransport] over HttpURLConnection: 3 s to connect, JSON, at most 64 KiB read. */
class HttpWatchTransport : WatchTransport {
    override fun post(url: String, token: String, body: String, readTimeoutMs: Int): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 3_000
            c.readTimeout = readTimeoutMs
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
