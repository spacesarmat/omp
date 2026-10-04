package com.spacesarmat.omp.control

import com.spacesarmat.omp.sources.CloudflareCookies
import com.spacesarmat.omp.sources.CloudflareSolver
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

/**
 * «Пройти на телефоне» over the pairing channel (the TV runs the control server, the phone only calls it):
 *
 * - the phone app polls `POST /omp/cloudflare/poll` (bearer token) → `{ request: null }` or
 *   `{ request: { id, site, url } }` (url = the site root, never a query);
 * - the phone passes the check in a visible page with its own User-Agent and answers `POST /omp/cloudflare/answer`
 *   `{ id, result: "solved", host, cookies: [{ name, value }], ua, until }` (cookies of that host only, at most
 *   [CloudflareCookies.MAX_COOKIES], body ≤ [MAX_BODY]) or `{ id, result: "cancelled" | "failed" }`;
 * - the answer is `{ ok: true }` — never an echo.
 *
 * Pure (JVM-tested). Cookies and User-Agents are never logged or put into toString.
 */
object CloudflareProtocol {
    const val POLL = "/omp/cloudflare/poll"
    const val ANSWER = "/omp/cloudflare/answer"
    const val MAX_BODY = 32_768
    const val MAX_SITE = 60
    const val MAX_UA = 512
    private val ID = Regex("^[A-Za-z0-9-]{1,64}$")
    private val UA = Regex("^[\\x20-\\x7e]{1,$MAX_UA}$")
    private val KEYS = setOf("id", "result", "host", "cookies", "ua", "until")
    private val COOKIE_KEYS = setOf("name", "value")

    /** A check the TV asks the phone for. */
    class Request(val id: String, val site: String, val url: String)

    sealed class Answer(val id: String) {
        class Solved(id: String, val host: String, val cookies: List<Pair<String, String>>, val ua: String, val until: Long) : Answer(id) {
            override fun toString() = "Solved(${cookies.size} cookies)"
        }
        class Cancelled(id: String) : Answer(id)
        class Failed(id: String) : Answer(id)
        /** The phone cannot show it (OMP in the background without notifications): the TV says «open OMP». */
        class Unavailable(id: String) : Answer(id)
    }

    fun validId(id: String?): Boolean = id != null && ID.matches(id)

    /** A site name for the texts: trimmed, no control characters, 1..[MAX_SITE]. */
    fun cleanSite(raw: String?): String? {
        val s = raw?.filterNot { it.isISOControl() }?.trim() ?: return null
        return s.take(MAX_SITE).trim().ifEmpty { null }
    }

    /** The site root of [raw] when [raw] is exactly one (scheme://host[:port]/), else null. */
    fun siteRoot(raw: String?): HttpUrl? {
        val u = raw?.toHttpUrlOrNull() ?: return null
        val root = CloudflareSolver.siteRoot(u)
        return if (root.toString() == raw) root else null
    }

    fun requestJson(r: Request?): JSONObject {
        val o = JSONObject()
        if (r == null) return o.put("request", JSONObject.NULL)
        return o.put("request", JSONObject().put("id", r.id).put("site", r.site).put("url", r.url))
    }

    /** The phone's view of a poll answer; null when it does not follow the schema. A missing request is NONE. */
    fun parseRequest(o: JSONObject?): Request? {
        val r = o?.opt("request") as? JSONObject ?: return null
        val id = r.opt("id") as? String ?: return null
        if (!validId(id)) return null
        val site = cleanSite(r.opt("site") as? String) ?: return null
        val url = r.opt("url") as? String ?: return null
        if (siteRoot(url) == null) return null
        return Request(id, site, url)
    }

    /** null when the body does not follow the schema (unknown keys, sizes, a cookie name twice, no clearance). */
    fun parseAnswer(body: JSONObject): Answer? {
        val keys = body.keys()
        while (keys.hasNext()) if (keys.next() !in KEYS) return null
        val id = body.opt("id") as? String ?: return null
        if (!validId(id)) return null
        return when (body.opt("result")) {
            "cancelled", "failed", "unavailable" -> {
                if (body.length() != 2) return null
                when (body.opt("result")) {
                    "cancelled" -> Answer.Cancelled(id)
                    "failed" -> Answer.Failed(id)
                    else -> Answer.Unavailable(id)
                }
            }
            "solved" -> solved(id, body)
            else -> null
        }
    }

    private fun solved(id: String, body: JSONObject): Answer? {
        val host = body.opt("host") as? String ?: return null
        if (host.isEmpty() || host.length > 253 || host != host.lowercase()) return null
        val ua = body.opt("ua") as? String ?: return null
        if (!UA.matches(ua)) return null
        val until = body.opt("until") as? Number ?: return null
        val arr = body.opt("cookies") as? JSONArray ?: return null
        if (arr.length() < 1 || arr.length() > CloudflareCookies.MAX_COOKIES) return null
        val cookies = ArrayList<Pair<String, String>>()
        val names = HashSet<String>()
        for (i in 0 until arr.length()) {
            val c = arr.opt(i) as? JSONObject ?: return null
            val ck = c.keys()
            while (ck.hasNext()) if (ck.next() !in COOKIE_KEYS) return null
            val name = c.opt("name") as? String ?: return null
            val value = c.opt("value") as? String ?: return null
            if (!CloudflareCookies.validName(name) || !CloudflareCookies.validValue(value) || !names.add(name)) return null
            cookies.add(name to value)
        }
        if (CloudflareCookies.CLEARANCE !in names) return null
        return Answer.Solved(id, host, cookies, ua, until.toLong())
    }

    /** The answer body the phone sends for a solved check (cookies already cleaned); null when it cannot fit [MAX_BODY]. */
    fun solvedJson(id: String, host: String, pairs: List<Pair<String, String>>, ua: String, until: Long): String? {
        val clean = CloudflareCookies.clean(pairs)
        if (clean.none { it.first == CloudflareCookies.CLEARANCE } || !UA.matches(ua)) return null
        // the site's own cookies go first when the body would be too large; Cloudflare's stay
        var list = clean
        while (true) {
            val arr = JSONArray()
            for ((n, v) in list) arr.put(JSONObject().put("name", n).put("value", v))
            val s = JSONObject().put("id", id).put("result", "solved").put("host", host).put("cookies", arr)
                .put("ua", ua).put("until", until).toString()
            if (s.toByteArray(Charsets.UTF_8).size <= MAX_BODY) return s
            val drop = list.indexOfLast { !CloudflareCookies.isCloudflare(it.first) }
            if (drop < 0) return null
            list = list.filterIndexed { i, _ -> i != drop }
        }
    }

    fun endedJson(id: String, cancelled: Boolean): String =
        JSONObject().put("id", id).put("result", if (cancelled) "cancelled" else "failed").toString()

    fun unavailableJson(id: String): String = JSONObject().put("id", id).put("result", "unavailable").toString()

    /** The wait a phone asks for in a poll body ({ wait: ms }), 0..[MAX_WAIT_MS]; anything else is 0. */
    fun waitOf(body: JSONObject?): Long {
        val w = body?.opt("wait") as? Number ?: return 0
        val ms = w.toLong()
        return if (ms <= 0) 0 else minOf(ms, MAX_WAIT_MS)
    }

    /** A long poll: the TV holds it this long at most (the phone reads for longer). */
    const val MAX_WAIT_MS = 25_000L
    /** The poll body is tiny: more is never read. */
    const val MAX_POLL_BODY = 64
}

/**
 * The TV side of «Пройти на телефоне»: one request at a time, picked up by the first phone that polls it and answered
 * only by that phone. A poll may wait ([CloudflareProtocol.waitOf], a long poll) until a request appears; at most
 * [MAX_WAITERS] polls wait at once (the control server has few workers), others answer at once. [ask] blocks until the
 * phone answered, the TV cancelled, or a timeout: [pickupMs] for a phone to pick it up, then [answerMs] for the answer.
 * A phone counts as connected while it waits in a poll or polled within [liveMs]. A solved answer goes to [store]
 * (cookies into the encrypted jar, the phone's User-Agent for that host until `until`); `until` outside
 * (now, now + [MAX_UNTIL_MS]] — another clock — becomes now + [DEFAULT_TTL_MS]. A request the TV closed itself (passed
 * by remote, «Отмена») answers the phone [Reply.DONE]. Thread-safe.
 */
class CloudflareRelay(
    private val store: (root: HttpUrl, cookies: List<Pair<String, String>>, ua: String, until: Long) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pickupMs: Long = PICKUP_MS,
    private val answerMs: Long = ANSWER_MS,
    private val liveMs: Long = LIVE_MS,
    /** At least one phone is paired (the TV then says «open OMP on the phone» instead of «pair a phone»). */
    private val paired: () -> Boolean = { false },
) {
    enum class Outcome { SOLVED, CANCELLED, FAILED, UNAVAILABLE, NO_PHONE, NOT_TAKEN, TIMEOUT, STORE_FAILED, BUSY }

    /** What the router answers to a phone's answer. */
    enum class Reply { OK, BAD_REQUEST, UNKNOWN, DONE, STORE_FAILED }

    private class Pending(val id: String, val site: String, val root: HttpUrl) {
        val taken = CountDownLatch(1)
        val done = CountDownLatch(1)
        @Volatile var by: String? = null
        @Volatile var outcome = Outcome.TIMEOUT
    }

    private class Seen(val at: Long, val phone: String)

    private val lock = Object()
    private var pending: Pending? = null
    private val seen = HashMap<String, Seen>()
    /** Tokens waiting in a poll now (phone name). */
    private val waiting = HashMap<String, String>()
    /** Requests the TV closed itself: id → the phone that took it. */
    private val closed = LinkedHashMap<String, String?>()
    private val seq = AtomicLong(System.nanoTime() and 0xffffff)

    fun anyPaired(): Boolean = paired()

    /** The name of the phone waiting in a poll, or the one that polled most recently within [liveMs]; null when none. */
    fun phone(): String? = synchronized(lock) { livePhone() }

    private fun livePhone(): String? {
        waiting.values.firstOrNull()?.let { return it }
        val t = clock()
        return seen.values.filter { t - it.at <= liveMs }.maxByOrNull { it.at }?.phone
    }

    /** Blocking (never on the main thread). [root]: the site root. */
    fun ask(site: String, root: HttpUrl): Outcome {
        val p = synchronized(lock) {
            if (pending != null) return Outcome.BUSY
            if (livePhone() == null) return Outcome.NO_PHONE
            Pending("c" + seq.incrementAndGet(), CloudflareProtocol.cleanSite(site) ?: root.host, CloudflareSolver.siteRoot(root)).also {
                pending = it
                // a waiting long poll takes it at once
                lock.notifyAll()
            }
        }
        try {
            if (!p.taken.await(pickupMs, TimeUnit.MILLISECONDS)) return if (p.done.count == 0L) p.outcome else Outcome.NOT_TAKEN
            if (!p.done.await(answerMs, TimeUnit.MILLISECONDS)) return Outcome.TIMEOUT
            return p.outcome
        } finally {
            synchronized(lock) { if (pending === p) pending = null }
        }
    }

    /** The TV closed its dialog (passed it by remote or «Отмена»): [ask] ends with CANCELLED; the phone hears DONE. */
    fun cancel() {
        val p = synchronized(lock) {
            val cur = pending ?: return
            pending = null
            closed[cur.id] = cur.by
            while (closed.size > MAX_CLOSED) closed.remove(closed.keys.first())
            cur
        }
        end(p, Outcome.CANCELLED)
    }

    /**
     * A poll of a paired phone: remembers it and hands it the waiting request (the one it took, or a free one). With
     * [waitMs] > 0 it blocks until a request appears or the time is up (a long poll; never on the main thread).
     */
    fun poll(token: String, phone: String, waitMs: Long = 0): JSONObject = synchronized(lock) {
        seen[token] = Seen(clock(), phone)
        if (seen.size > MAX_PHONES) seen.entries.minByOrNull { it.value.at }?.let { seen.remove(it.key) }
        var r = take(token)
        if (r == null && waitMs > 0 && waiting.size < MAX_WAITERS && token !in waiting) {
            waiting[token] = phone
            try {
                val end = System.nanoTime() + waitMs * 1_000_000
                while (r == null) {
                    val left = (end - System.nanoTime()) / 1_000_000
                    if (left <= 0) break
                    lock.wait(left)
                    r = take(token)
                }
            } catch (e: InterruptedException) {
                // the server is stopping
            } finally {
                waiting.remove(token)
                seen[token] = Seen(clock(), phone)
            }
        }
        CloudflareProtocol.requestJson(r)
    }

    private fun take(token: String): CloudflareProtocol.Request? {
        val p = pending ?: return null
        if (p.done.count == 0L || (p.by != null && p.by != token)) return null
        p.by = token
        p.taken.countDown()
        return CloudflareProtocol.Request(p.id, p.site, p.root.toString())
    }

    /** A phone's answer; only the phone that took the request, only for its host. */
    fun answer(token: String, body: JSONObject): Reply {
        val a = CloudflareProtocol.parseAnswer(body) ?: return Reply.BAD_REQUEST
        val p = synchronized(lock) {
            val cur = pending
            if (cur == null || cur.id != a.id || cur.by != token || cur.done.count == 0L) {
                return if (closed.containsKey(a.id) && closed[a.id] == token) Reply.DONE else Reply.UNKNOWN
            }
            cur
        }
        return when (a) {
            is CloudflareProtocol.Answer.Cancelled -> end(p, Outcome.CANCELLED).let { Reply.OK }
            is CloudflareProtocol.Answer.Failed -> end(p, Outcome.FAILED).let { Reply.OK }
            is CloudflareProtocol.Answer.Unavailable -> end(p, Outcome.UNAVAILABLE).let { Reply.OK }
            is CloudflareProtocol.Answer.Solved -> {
                if (a.host != p.root.host) return Reply.BAD_REQUEST
                val t = clock()
                val until = if (a.until > t && a.until <= t + MAX_UNTIL_MS) a.until else t + DEFAULT_TTL_MS
                try {
                    store(p.root, a.cookies, a.ua, until)
                } catch (e: Exception) {
                    end(p, Outcome.STORE_FAILED)
                    return Reply.STORE_FAILED
                }
                end(p, Outcome.SOLVED)
                Reply.OK
            }
        }
    }

    private fun end(p: Pending, o: Outcome) {
        synchronized(lock) {
            if (p.done.count == 0L) return
            p.outcome = o
            p.done.countDown()
        }
        p.taken.countDown()
    }

    companion object {
        /** A phone with OMP open waits in a long poll and picks it up at once; one just back from the background, soon. */
        const val PICKUP_MS = 30_000L
        /** Time for the person to pass the check on the phone. */
        const val ANSWER_MS = 180_000L
        const val LIVE_MS = 30_000L
        const val DEFAULT_TTL_MS = CloudflareSolver.COPIED_TTL_MS
        const val MAX_UNTIL_MS = 24L * 60 * 60 * 1000
        const val MAX_WAITERS = 2
        private const val MAX_PHONES = 16
        private const val MAX_CLOSED = 8
    }
}
