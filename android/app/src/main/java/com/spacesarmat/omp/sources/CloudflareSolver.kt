package com.spacesarmat.omp.sources

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
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
 *
 * Every WebView check (this hidden one and Task 8's visible one) goes through one [CheckGate]: the WebView cookie store
 * is global, and a check cleans the site's state when it ends, so two checks never overlap. A check waits up to
 * [timeoutMs] for the gate.
 */
class CloudflareSolver(
    private val browsers: () -> CloudflareBrowser,
    private val scheduler: Scheduler,
    private val jar: SiteCookieJar,
    /** The one User-Agent of the site requests (the WebView's own on Android: UA and client hints agree). */
    private val userAgent: () -> String = { SiteHttp.USER_AGENT },
    private val timeoutMs: Long = TIMEOUT_MS,
    private val pollMs: Long = POLL_MS,
    private val turnstileGraceMs: Long = TURNSTILE_GRACE_MS,
    private val wallClock: () -> Long = System::currentTimeMillis,
    private val gate: CheckGate = WEB_CHECKS,
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
        // up to timeoutMs waiting for the gate, then the check itself
        return if (latch.await(2 * timeoutMs + WAIT_SLACK_MS, TimeUnit.MILLISECONDS)) result else Result.FAILED
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
        val s = Session(host, root)
        scheduler.post(0) { s.enter(scheduler.now()) }
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
        private var entered = false

        /** Waits for the gate (another WebView check running) at most [timeoutMs]. */
        fun enter(since: Long) {
            if (gate.tryEnter()) {
                entered = true
                return start()
            }
            if (scheduler.now() - since >= timeoutMs) return finish(Result.FAILED)
            scheduler.post(pollMs) { enter(since) }
        }

        private fun start() {
            started = scheduler.now()
            val b = try {
                browsers()
            } catch (e: Throwable) {
                return finish(Result.FAILED)
            }
            browser = b
            try {
                b.open(root.toString(), userAgent(), this)
            } catch (e: Throwable) {
                return finish(Result.FAILED)
            }
            scheduler.post(pollMs) { poll() }
            // a probe that never answers (a stuck page) still ends the check
            scheduler.post(timeoutMs + pollMs) {
                if (finished) return@post
                // a clearance that arrived while the probe hung still counts
                val br = browser
                if (br != null && hasClearanceSafe(br)) return@post solved(br)
                finish(if (last == CloudflareDetect.Page.CLEAR) Result.FAILED else Result.INTERACTIVE)
            }
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

        private fun hasClearanceSafe(b: CloudflareBrowser): Boolean = try {
            hasClearance(b)
        } catch (e: Throwable) {
            false
        }

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
            if (entered) {
                entered = false
                gate.leave()
            }
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
        CloudflareCookies.import(jar, root, CloudflareCookies.clean(pairs), wallClock() + COPIED_TTL_MS)
    }

    companion object {
        /** The one gate of all WebView checks in the process (hidden and visible). */
        val WEB_CHECKS: CheckGate = ExclusiveGate()

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

/** One WebView check at a time (the hidden check here, the visible check of Task 8). */
interface CheckGate {
    /** true: the caller holds the gate and must [leave] it. */
    fun tryEnter(): Boolean
    fun leave()
}

class ExclusiveGate : CheckGate {
    private val busy = AtomicBoolean(false)
    override fun tryEnter(): Boolean = busy.compareAndSet(false, true)
    override fun leave() {
        busy.set(false)
    }
}

/**
 * Cookie headers that expire a WebView cookie (pure, JVM-tested): every path prefix of the URLs the check visited,
 * host-only and domain variants, Secure on https (Chromium does not overwrite __Secure-/__Host- cookies otherwise);
 * __Host- cookies only host-only on "/".
 */
object WebCookieCleanup {
    fun pathPrefixes(path: String?): List<String> {
        val out = mutableListOf("/")
        val parts = (path ?: "/").split('/').filter { it.isNotEmpty() }
        var p = ""
        // the last segment is a page, not a cookie path ("/forum/index.php" → "/", "/forum")
        for (seg in if ((path ?: "/").endsWith("/")) parts else parts.dropLast(1)) {
            p += "/" + seg
            out.add(p)
        }
        return out
    }

    fun expiring(name: String, paths: List<String>, host: String, site: String, https: Boolean): List<String> {
        val out = ArrayList<String>()
        val secure = if (https) "; Secure" else ""
        if (name.startsWith("__Host-")) return listOf("$name=; Max-Age=0; Path=/$secure")
        for (p in paths) {
            val base = "$name=; Max-Age=0; Path=$p$secure"
            out.add(base)
            out.add("$base; Domain=$host")
            if (site != host) out.add("$base; Domain=$site")
        }
        return out
    }
}

/**
 * Where the visible check's page may go (pure, JVM-tested): its own host (and its www. twin, a usual redirect) and
 * Cloudflare's challenge pages — nothing else, so the sheet never becomes a browser for another site.
 */
object VisibleNavigation {
    private val CHALLENGE_HOSTS = setOf("challenges.cloudflare.com")

    fun allowed(rootHost: String?, host: String?): Boolean {
        val r = rootHost?.lowercase()?.trimEnd('.') ?: return false
        val h = host?.lowercase()?.trimEnd('.') ?: return false
        if (h.isEmpty() || r.isEmpty()) return false
        return h in CHALLENGE_HOSTS || h == r || h == "www.$r" || r == "www.$h"
    }
}

/** What [SiteHttp] needs from the built-in check (tests pass a fake). */
interface CloudflareSolving {
    fun solve(url: HttpUrl): CloudflareSolver.Result
}
