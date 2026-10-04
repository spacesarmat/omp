package com.spacesarmat.omp.sources

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.HttpUrl

/**
 * The hidden page that passes a Cloudflare check (an off-screen WebView on Android, a fake in tests). Every call
 * comes on the [CloudflareSolver.Scheduler] thread (the main thread on Android).
 */
interface CloudflareBrowser {
    interface Events {
        fun onFinished()

        /** The main page could not be loaded at all (no network, DNS). */
        fun onError()
    }

    /** Starts loading [url] with [userAgent]. */
    fun open(url: String, userAgent: String, events: Events)

    /** The page probe ([CloudflareDetect.PROBE_JS]) result, null when it could not run. */
    fun probe(result: (String?) -> Unit)

    /** The browser's cookie header for [url] ("a=b; c=d"), null when none. */
    fun cookies(url: String): String?

    /**
     * Drops the browser's own copy of the cookies of [url]'s site: they live on in the encrypted jar only (the WebView
     * keeps its cookie store as a plain file).
     */
    fun forget(url: String)

    fun close()
}

/**
 * Passes a Cloudflare check in a hidden browser with the same User-Agent as [SiteHttp]: loads the site, waits up to
 * [timeoutMs] for the `cf_clearance` cookie, copies the site's cookies into the [SiteCookieJar]. One check per host at
 * a time: concurrent requests for the same host wait for the same result. Nothing is logged (no addresses, no cookies).
 *
 * Results: [Result.SOLVED]; [Result.INTERACTIVE] — a Turnstile tick is still shown after [turnstileGraceMs], or the
 * check is still on the page when time is up (a person has to pass it in a visible page); [Result.FAILED] — the page did
 * not load or the browser is unavailable.
 */
class CloudflareSolver(
    private val browsers: () -> CloudflareBrowser,
    private val scheduler: Scheduler,
    private val jar: SiteCookieJar,
    private val userAgent: String = SiteHttp.USER_AGENT,
    private val timeoutMs: Long = TIMEOUT_MS,
    private val pollMs: Long = POLL_MS,
    private val turnstileGraceMs: Long = TURNSTILE_GRACE_MS,
    private val wallClock: () -> Long = System::currentTimeMillis,
) : CloudflareSolving {
    enum class Result { SOLVED, INTERACTIVE, FAILED }

    /** Runs blocks one after another on one thread (the main looper on Android). */
    interface Scheduler {
        fun post(delayMs: Long, block: () -> Unit)
        fun now(): Long
    }

    private val waiting = HashMap<String, MutableList<(Result) -> Unit>>()

    /** Blocking, never on the scheduler thread. */
    override fun solve(url: HttpUrl): Result {
        val latch = CountDownLatch(1)
        var result = Result.FAILED
        solveAsync(url) {
            result = it
            latch.countDown()
        }
        return if (latch.await(timeoutMs + WAIT_SLACK_MS, TimeUnit.MILLISECONDS)) result else Result.FAILED
    }

    /** [done] is called once, on the scheduler thread. A check already running for the host is joined. */
    fun solveAsync(url: HttpUrl, done: (Result) -> Unit) {
        val host = url.host.lowercase()
        synchronized(waiting) {
            val list = waiting[host]
            if (list != null) {
                list.add(done)
                return
            }
            waiting[host] = mutableListOf(done)
        }
        val root = siteRoot(url)
        scheduler.post(0) { Session(host, root).start() }
    }

    /** Hosts with a check running now (tests, the visible check of Task 8). */
    fun running(): Set<String> = synchronized(waiting) { waiting.keys.toSet() }

    private inner class Session(private val host: String, private val root: HttpUrl) : CloudflareBrowser.Events {
        private var browser: CloudflareBrowser? = null
        private var started = 0L
        private var finished = false
        private var loaded = false
        private var turnstileSince = -1L
        private var last = CloudflareDetect.Page.CHALLENGE

        fun start() {
            started = scheduler.now()
            val b = try {
                browsers()
            } catch (e: Throwable) {
                return finish(Result.FAILED)
            }
            browser = b
            try {
                b.open(root.toString(), userAgent, this)
            } catch (e: Throwable) {
                return finish(Result.FAILED)
            }
            scheduler.post(pollMs) { poll() }
            // a probe that never answers (a stuck page) still ends the check
            scheduler.post(timeoutMs + pollMs) { finish(if (last == CloudflareDetect.Page.CLEAR) Result.FAILED else Result.INTERACTIVE) }
        }

        override fun onFinished() {
            loaded = true
        }

        override fun onError() {
            finish(Result.FAILED)
        }

        private fun poll() {
            if (finished) return
            val b = browser ?: return
            if (hasClearance(b)) return solved(b)
            if (scheduler.now() - started >= timeoutMs) {
                return finish(if (last == CloudflareDetect.Page.CLEAR) Result.FAILED else Result.INTERACTIVE)
            }
            b.probe { probe ->
                if (finished) return@probe
                val page = CloudflareDetect.page(probe)
                last = page
                val t = scheduler.now()
                when {
                    hasClearance(b) -> return@probe solved(b)
                    // the check is gone from a loaded page: the site's own cookies are enough
                    page == CloudflareDetect.Page.CLEAR && loaded -> return@probe solved(b)
                    page == CloudflareDetect.Page.TURNSTILE -> {
                        if (turnstileSince < 0) turnstileSince = t
                        if (t - turnstileSince >= turnstileGraceMs) return@probe finish(Result.INTERACTIVE)
                    }
                    else -> turnstileSince = -1
                }
                scheduler.post(pollMs) { poll() }
            }
        }

        private fun hasClearance(b: CloudflareBrowser): Boolean =
            parseCookieHeader(b.cookies(root.toString())).any { it.first == CLEARANCE }

        private fun solved(b: CloudflareBrowser) {
            try {
                copyCookies(root, parseCookieHeader(b.cookies(root.toString())))
            } catch (e: Exception) {
                return finish(Result.FAILED)
            }
            finish(Result.SOLVED)
        }

        private fun finish(r: Result) {
            if (finished) return
            finished = true
            try {
                browser?.forget(root.toString())
            } catch (e: Throwable) {
                // nothing to drop
            }
            try {
                browser?.close()
            } catch (e: Throwable) {
                // closing a broken page must not lose the result
            }
            browser = null
            val list = synchronized(waiting) { waiting.remove(host) } ?: return
            for (cb in list) cb(r)
        }
    }

    /**
     * Browser cookies into the jar for the whole site: the Cloudflare ones always (a fresh check replaces the old
     * clearance), others only when the jar has none of that name (a tracker login in the jar wins). The browser does not
     * say when a cookie ends: [COPIED_TTL_MS] is assumed; an earlier end shows as a new check, passed again.
     */
    internal fun copyCookies(root: HttpUrl, pairs: List<Pair<String, String>>) {
        if (pairs.isEmpty()) return
        val have = jar.loadForRequest(root).map { it.name }.toSet()
        val domain = SiteCookieJar.siteOf(root)
        val until = wallClock() + COPIED_TTL_MS
        val out = ArrayList<Cookie>()
        for ((name, value) in pairs) {
            val cf = name == CLEARANCE || name.startsWith("__cf") || name.startsWith("cf_")
            if (!cf && name in have) continue
            try {
                val b = Cookie.Builder().name(name).value(value).path("/").expiresAt(until)
                if (domain == root.host) b.hostOnlyDomain(domain) else b.domain(domain)
                if (root.isHttps) b.secure()
                out.add(b.build())
            } catch (e: IllegalArgumentException) {
                // a cookie OkHttp refuses is skipped
            }
        }
        jar.saveFromResponse(root, out)
    }

    companion object {
        const val TIMEOUT_MS = 20_000L
        const val POLL_MS = 500L
        const val TURNSTILE_GRACE_MS = 8_000L
        const val COPIED_TTL_MS = 30L * 60 * 1000
        const val CLEARANCE = "cf_clearance"
        private const val WAIT_SLACK_MS = 5_000L

        /** scheme://host[:port]/ of [url]: the check is per site, a query (a search, a key) never goes to the browser. */
        fun siteRoot(url: HttpUrl): HttpUrl = url.newBuilder().encodedPath("/").query(null).fragment(null).username("").password("").build()

        /** "a=b; c=d" → pairs; malformed parts are skipped. */
        fun parseCookieHeader(header: String?): List<Pair<String, String>> {
            if (header.isNullOrBlank()) return emptyList()
            val out = ArrayList<Pair<String, String>>()
            for (part in header.split(';')) {
                val i = part.indexOf('=')
                if (i <= 0) continue
                val name = part.substring(0, i).trim()
                val value = part.substring(i + 1).trim()
                if (name.isNotEmpty()) out.add(name to value)
            }
            return out
        }
    }
}

/** What [SiteHttp] needs from the built-in check (tests pass a fake). */
interface CloudflareSolving {
    fun solve(url: HttpUrl): CloudflareSolver.Result
}
