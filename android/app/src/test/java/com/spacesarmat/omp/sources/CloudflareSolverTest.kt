package com.spacesarmat.omp.sources

import java.util.PriorityQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareSolverTest {
    /** Virtual time: blocks run in time order when [runUntil] advances the clock. */
    private class FakeScheduler : CloudflareSolver.Scheduler {
        private class Job(val at: Long, val seq: Long, val block: () -> Unit)

        private val queue = PriorityQueue<Job>(compareBy<Job>({ it.at }, { it.seq }))
        private var seq = 0L

        @Volatile
        var time = 0L

        @Synchronized
        override fun post(delayMs: Long, block: () -> Unit) {
            queue.add(Job(time + delayMs, seq++, block))
        }

        override fun now(): Long = time

        fun runUntil(t: Long) {
            while (true) {
                val job = synchronized(this) { queue.peek()?.takeIf { it.at <= t }?.also { queue.poll() } } ?: break
                time = job.at
                job.block()
            }
            time = t
        }
    }

    /** The page the solver drives: tests set what the probe and the cookie store answer. */
    private class FakeBrowser : CloudflareBrowser {
        var opened: String? = null
        var agent: String? = null
        var events: CloudflareBrowser.Events? = null
        var probeAnswer: String? = PROBE_CHALLENGE
        var cookieHeader: String? = null
        var closed = false
        val forgotten = ArrayList<String>()

        override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {
            opened = url
            agent = userAgent
            this.events = events
        }

        override fun probe(result: (String?) -> Unit) {
            result(probeAnswer)
        }

        override fun cookies(url: String): String? = cookieHeader

        override fun forget(url: String) {
            forgotten.add(url)
        }

        override fun close() {
            closed = true
        }
    }

    private val saved = HashMap<String, String>()
    private val store = object : CookieStore {
        override fun load(site: String): String? = saved[site]
        override fun save(site: String, data: String?) {
            if (data == null) saved.remove(site) else saved[site] = data
        }
    }
    private val jar = SiteCookieJar(store)
    private val scheduler = FakeScheduler()
    private val browsers = ArrayList<FakeBrowser>()
    private val solver = CloudflareSolver({ FakeBrowser().also { browsers.add(it) } }, scheduler, jar)
    private val site = "https://kinozal.example.com/browse.php?s=test&apikey=x".toHttpUrl()

    private fun start(url: HttpUrl = site): MutableList<CloudflareSolver.Result> {
        val out = mutableListOf<CloudflareSolver.Result>()
        solver.solveAsync(url) { out.add(it) }
        return out
    }

    @Test
    fun solvedWhenClearanceAppears() {
        val r = start()
        scheduler.runUntil(0)
        val b = browsers.single()
        // only the site root, never the query (search text, keys)
        assertEquals("https://kinozal.example.com/", b.opened)
        assertEquals(SiteHttp.USER_AGENT, b.agent)
        scheduler.runUntil(3000)
        assertTrue(r.isEmpty())
        b.cookieHeader = "cf_clearance=abc; uid=7"
        scheduler.runUntil(3500)
        assertEquals(listOf(CloudflareSolver.Result.SOLVED), r)
        assertTrue(b.closed)
        // the browser's own copy is dropped: the cookies live in the encrypted jar only
        assertEquals(listOf("https://kinozal.example.com/"), b.forgotten)
        val sent = jar.loadForRequest("https://kinozal.example.com/browse.php".toHttpUrl()).associate { it.name to it.value }
        assertEquals("abc", sent["cf_clearance"])
        assertEquals("7", sent["uid"])
        // for the whole site, and persisted (until expiry)
        assertEquals("abc", jar.loadForRequest("https://dl.kinozal.example.com/x".toHttpUrl()).first { it.name == "cf_clearance" }.value)
        assertTrue(saved.isNotEmpty())
        assertTrue(solver.running().isEmpty())
    }

    @Test
    fun copiedCookiesDoNotReplaceTheTrackerLogin() {
        val url = "https://kinozal.example.com/".toHttpUrl()
        jar.saveFromResponse(url, listOf(Cookie.parse(url, "uid=login; Max-Age=3600; Path=/")!!))
        val r = start()
        scheduler.runUntil(0)
        browsers.single().cookieHeader = "uid=browser; cf_clearance=new"
        scheduler.runUntil(600)
        assertEquals(listOf(CloudflareSolver.Result.SOLVED), r)
        val sent = jar.loadForRequest(url).associate { it.name to it.value }
        assertEquals("login", sent["uid"])
        assertEquals("new", sent["cf_clearance"])
    }

    @Test
    fun clearPageAfterLoadIsSolved() {
        val r = start()
        scheduler.runUntil(0)
        val b = browsers.single()
        b.probeAnswer = PROBE_CLEAR
        scheduler.runUntil(1000)
        // still loading: not decided by the probe alone
        assertTrue(r.isEmpty())
        b.events!!.onFinished()
        scheduler.runUntil(1500)
        assertEquals(listOf(CloudflareSolver.Result.SOLVED), r)
    }

    @Test
    fun timeoutWithTheChallengeStillShownIsInteractive() {
        val r = start()
        scheduler.runUntil(CloudflareSolver.TIMEOUT_MS - 1)
        assertTrue(r.isEmpty())
        scheduler.runUntil(CloudflareSolver.TIMEOUT_MS + 1000)
        assertEquals(listOf(CloudflareSolver.Result.INTERACTIVE), r)
        assertTrue(browsers.single().closed)
        assertEquals(1, browsers.single().forgotten.size)
    }

    @Test
    fun timeoutOnAPageThatNeverLoadedFails() {
        val r = start()
        scheduler.runUntil(0)
        browsers.single().probeAnswer = PROBE_CLEAR
        scheduler.runUntil(CloudflareSolver.TIMEOUT_MS + 1000)
        assertEquals(listOf(CloudflareSolver.Result.FAILED), r)
    }

    @Test
    fun turnstileThatStaysIsInteractiveEarly() {
        val r = start()
        scheduler.runUntil(0)
        browsers.single().probeAnswer = PROBE_TURNSTILE
        scheduler.runUntil(CloudflareSolver.TURNSTILE_GRACE_MS)
        assertTrue(r.isEmpty())
        scheduler.runUntil(CloudflareSolver.TURNSTILE_GRACE_MS + 1000)
        assertEquals(listOf(CloudflareSolver.Result.INTERACTIVE), r)
        assertTrue(scheduler.time < CloudflareSolver.TIMEOUT_MS)
    }

    @Test
    fun turnstileThatPassesByItselfIsSolved() {
        val r = start()
        scheduler.runUntil(0)
        val b = browsers.single()
        b.probeAnswer = PROBE_TURNSTILE
        scheduler.runUntil(3000)
        b.cookieHeader = "cf_clearance=ok"
        scheduler.runUntil(3500)
        assertEquals(listOf(CloudflareSolver.Result.SOLVED), r)
    }

    @Test
    fun loadErrorAndBrokenBrowserFail() {
        val r = start()
        scheduler.runUntil(0)
        browsers.single().events!!.onError()
        assertEquals(listOf(CloudflareSolver.Result.FAILED), r)
        assertTrue(browsers.single().closed)

        val broken = CloudflareSolver({ throw IllegalStateException("no WebView") }, scheduler, jar)
        val out = mutableListOf<CloudflareSolver.Result>()
        broken.solveAsync(site) { out.add(it) }
        scheduler.runUntil(scheduler.time)
        assertEquals(listOf(CloudflareSolver.Result.FAILED), out)
        assertTrue(broken.running().isEmpty())
    }

    @Test
    fun stuckProbeStillEnds() {
        val stuck = object : CloudflareBrowser {
            override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {}
            override fun probe(result: (String?) -> Unit) {} // never answers
            override fun cookies(url: String): String? = null
            override fun forget(url: String) {}
            override fun close() {}
        }
        val s = CloudflareSolver({ stuck }, scheduler, jar)
        val out = mutableListOf<CloudflareSolver.Result>()
        s.solveAsync(site) { out.add(it) }
        scheduler.runUntil(CloudflareSolver.TIMEOUT_MS + CloudflareSolver.POLL_MS)
        assertEquals(listOf(CloudflareSolver.Result.INTERACTIVE), out)
        assertTrue(s.running().isEmpty())
    }

    @Test
    fun concurrentRequestsForOneHostShareOneCheck() {
        val a = start()
        val b = start("https://kinozal.example.com/details.php?id=1".toHttpUrl())
        val other = start("https://rustorka.example.org/".toHttpUrl())
        scheduler.runUntil(0)
        assertEquals(2, browsers.size)
        assertEquals(setOf("kinozal.example.com", "rustorka.example.org"), solver.running())
        browsers[0].cookieHeader = "cf_clearance=1"
        scheduler.runUntil(500)
        assertEquals(listOf(CloudflareSolver.Result.SOLVED), a)
        assertEquals(listOf(CloudflareSolver.Result.SOLVED), b)
        assertTrue(other.isEmpty())
        // a later request starts a fresh check
        start()
        scheduler.runUntil(500)
        assertEquals(3, browsers.size)
    }

    @Test
    fun blockingSolveWaitsForTheResult() {
        // a worker blocks in solve() while this thread drives the scheduler
        val pool = Executors.newSingleThreadExecutor()
        try {
            val started = CountDownLatch(1)
            val f = pool.submit<CloudflareSolver.Result> {
                started.countDown()
                solver.solve(site)
            }
            started.await(5, TimeUnit.SECONDS)
            val deadline = System.currentTimeMillis() + 5000
            while (solver.running().isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(5)
            scheduler.runUntil(0)
            browsers.single().cookieHeader = "cf_clearance=z"
            scheduler.runUntil(500)
            assertEquals(CloudflareSolver.Result.SOLVED, f.get(5, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun cookieHeaderAndSiteRoot() {
        assertEquals(listOf("a" to "1", "b" to "x=y"), CloudflareSolver.parseCookieHeader(" a=1; ;b=x=y; =bad; novalue"))
        assertTrue(CloudflareSolver.parseCookieHeader(null).isEmpty())
        val root = CloudflareSolver.siteRoot("http://u:p@h.example:8080/a?b#c".toHttpUrl()).toString()
        assertFalse(root.contains("u:p"))
        assertEquals("http://h.example:8080/", root)
    }

    companion object {
        const val PROBE_CHALLENGE = "{\"t\":\"Just a moment...\",\"ch\":true,\"ts\":false}"
        const val PROBE_TURNSTILE = "{\"t\":\"Just a moment...\",\"ch\":true,\"ts\":true}"
        const val PROBE_CLEAR = "{\"t\":\"Kinozal\",\"ch\":false,\"ts\":false}"
    }
}
