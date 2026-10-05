package com.spacesarmat.omp.sources

import com.spacesarmat.omp.control.CloudflareRelay
import java.util.PriorityQueue
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VisibleCheckTest {
    /** Virtual time: blocks run in time order when [runUntil] advances the clock. */
    private class FakeScheduler : CloudflareSolver.Scheduler {
        private class Job(val at: Long, val seq: Long, val block: () -> Unit)

        private val queue = PriorityQueue<Job>(compareBy<Job>({ it.at }, { it.seq }))
        private var seq = 0L
        var time = 0L

        override fun post(delayMs: Long, block: () -> Unit) {
            queue.add(Job(time + delayMs, seq++, block))
        }

        override fun now(): Long = time

        fun runUntil(t: Long) {
            while (true) {
                val job = queue.peek()?.takeIf { it.at <= t }?.also { queue.poll() } ?: break
                time = job.at
                job.block()
            }
            time = t
        }
    }

    private class FakeBrowser : CloudflareBrowser {
        var opened: String? = null
        var agent: String? = null
        var cookieHeader: String? = null
        var closed = false
        val forgotten = ArrayList<String>()
        override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {
            opened = url
            agent = userAgent
        }
        override fun probe(result: (String?) -> Unit) = result(null)
        override fun cookies(url: String): String? = cookieHeader
        override fun forget(url: String) {
            forgotten.add(url)
        }
        override fun close() {
            closed = true
        }
    }

    private class FakeUi(private val log: MutableList<String>) : CheckUi {
        var shown: String? = null
        override fun showWaiting() {
            log.add("waiting")
        }
        override fun showPage(browser: CloudflareBrowser) {
            log.add("page")
        }
        override fun setHint(text: String?) {
            shown = text
        }
        override fun dismiss() {
            log.add("dismiss")
        }
    }

    private class CountingGate : CheckGate {
        val inner = ExclusiveGate()
        var held = false
        override fun tryEnter(): Boolean = inner.tryEnter().also { if (it) held = true }
        override fun leave() {
            held = false
            inner.leave()
        }
    }

    private val texts = CheckTexts(
        "t", "x", null, "Отмена", "Пройти на телефоне", "Отметить пультом", "Телефон «%s» получит запрос",
        "Подключите телефон к телевизору", "Откройте OMP на телефоне", "Ждём «%s»", "Ждём другую проверку",
        mapOf("NOT_TAKEN" to "Телефон не ответил"),
    )
    private val root = "https://rustorka.example/".toHttpUrl()
    private val sched = FakeScheduler()
    private val log = ArrayList<String>()
    private val ui = FakeUi(log)
    private val gate = CountingGate()
    private val browser = FakeBrowser()
    private val results = ArrayList<CheckResult>()
    private val stored = ArrayList<Pair<List<Pair<String, String>>, Long>>()
    private var storeFails = false

    private fun check(
        target: CheckTarget = CheckTarget.Local { pairs, until ->
            if (storeFails) throw IllegalStateException("keystore")
            stored.add(pairs to until)
        },
        relay: CloudflareRelay? = null,
        browsers: () -> CloudflareBrowser = { browser },
    ) = VisibleCheck(
        root, "rustorka", texts, browsers, sched, { "Device-UA" }, { 1_000_000L }, { it() }, target, relay,
        { results.add(it); log.add("done:" + it.result) }, gate, gateWaitMs = 2_000, pollMs = 500, maxOpenMs = 10_000,
    )

    /** Closing order: the dialog first, then the page, then the gate; done exactly once. */
    private fun assertClosed() {
        assertEquals(1, results.size)
        assertFalse(gate.held)
        assertTrue(browser.closed || browser.opened == null)
        val dismiss = log.indexOf("dismiss")
        assertTrue(dismiss >= 0)
        assertTrue(dismiss < log.indexOf("done:" + results[0].result))
    }

    @Test
    fun passedHereStoresTheCookiesAndCleansThePage() {
        val c = check()
        c.start(ui)
        assertEquals(listOf("page"), log)
        assertEquals("https://rustorka.example/", browser.opened)
        assertEquals("Device-UA", browser.agent)
        assertTrue(gate.held)
        sched.runUntil(1_000)
        browser.cookieHeader = "cf_clearance=abc; site=1"
        sched.runUntil(2_000)
        assertEquals("solved", results.single().result)
        assertEquals(listOf("cf_clearance" to "abc", "site" to "1"), stored.single().first)
        assertEquals(1_000_000L + CloudflareSolver.COPIED_TTL_MS, stored.single().second)
        assertEquals(listOf("https://rustorka.example/"), browser.forgotten)
        assertClosed()
        // late taps do nothing
        c.cancel()
        assertEquals(1, results.size)
    }

    @Test
    fun cancelTimeoutAndStorageFailureAllReleaseTheGate() {
        check().apply { start(ui) }.cancel()
        assertEquals("cancelled", results.single().result)
        assertClosed()

        results.clear(); log.clear()
        check().start(ui)
        sched.runUntil(20_000)
        assertEquals("cancelled", results.single().result)
        assertFalse(gate.held)

        results.clear(); log.clear()
        storeFails = true
        check().start(ui)
        browser.cookieHeader = "cf_clearance=abc"
        sched.runUntil(sched.time + 600)
        assertEquals("failed", results.single().result)
        assertFalse(gate.held)
    }

    @Test
    fun waitsForAnotherCheckThenGivesUp() {
        assertTrue(gate.tryEnter())
        check().start(ui)
        assertEquals(listOf("waiting"), log)
        sched.runUntil(2_500)
        assertEquals("busy", results.single().result)
        assertNull(browser.opened)
        // the other check still holds it: not released by this one
        assertTrue(gate.held)
        gate.leave()
        // the gate frees in time: the page opens
        results.clear(); log.clear()
        assertTrue(gate.tryEnter())
        check().start(ui)
        sched.runUntil(sched.time + 1_000)
        gate.leave()
        sched.runUntil(sched.time + 600)
        assertEquals(listOf("waiting", "page"), log)
        assertTrue(gate.held)
    }

    @Test
    fun aBrokenBrowserFailsAndReleases() {
        check(browsers = { throw IllegalStateException("no webview") }).start(ui)
        assertEquals("failed", results.single().result)
        assertFalse(gate.held)
    }

    @Test
    fun forTheTvTheCookiesGoOnlyToTheTv() {
        val sent = ArrayList<List<Pair<String, String>>?>()
        var status = 200
        val tv = CheckTarget.Tv { pairs, ua, _ ->
            sent.add(pairs)
            assertEquals("Device-UA", if (pairs == null) "Device-UA" else ua)
            status
        }
        check(target = tv).start(ui)
        browser.cookieHeader = "cf_clearance=abc"
        sched.runUntil(600)
        assertEquals(true, results.single().sent)
        assertTrue(stored.isEmpty())
        assertEquals(listOf("cf_clearance" to "abc"), sent.single())
        // the TV passed it itself meanwhile: nothing to say
        results.clear(); log.clear()
        status = 410
        check(target = tv).start(ui)
        sched.runUntil(sched.time + 600)
        assertEquals("done", results.single().result)
        // not taken
        results.clear(); log.clear()
        status = -1
        check(target = tv).start(ui)
        sched.runUntil(sched.time + 600)
        assertEquals(false, results.single().sent)
        // «Отмена» tells the TV
        results.clear(); log.clear(); sent.clear()
        check(target = tv).apply { start(ui) }.cancel()
        assertNull(sent.single())
        assertFalse(gate.held)
    }

    @Test
    fun tvHintsAndThePhoneAsk() {
        var paired = false
        val relay = CloudflareRelay({ _, _, _, _ -> }, pickupMs = 50, answerMs = 50, paired = { paired })
        val c = check(relay = relay)
        c.start(ui)
        assertEquals("Подключите телефон к телевизору", ui.shown)
        paired = true
        c.askPhone()
        assertEquals("Откройте OMP на телефоне", ui.shown)
        relay.poll("t1", "Pixel 8")
        c.askPhone()
        // background runs inline here: the relay waited for a pick-up that never came
        sched.runUntil(sched.time + 1)
        assertEquals("Телефон не ответил", ui.shown)
        c.cancel()
        assertFalse(gate.held)
    }

    @Test
    fun theVisiblePageStaysOnItsSite() {
        assertTrue(VisibleNavigation.allowed("rustorka.example", "rustorka.example"))
        assertTrue(VisibleNavigation.allowed("rustorka.example", "www.rustorka.example"))
        assertTrue(VisibleNavigation.allowed("www.rustorka.example", "rustorka.example"))
        assertTrue(VisibleNavigation.allowed("rustorka.example", "challenges.cloudflare.com"))
        assertFalse(VisibleNavigation.allowed("rustorka.example", "forum.rustorka.example"))
        assertFalse(VisibleNavigation.allowed("rustorka.example", "evil.example"))
        assertFalse(VisibleNavigation.allowed("rustorka.example", "cloudflare.com"))
        assertFalse(VisibleNavigation.allowed("rustorka.example", null))
        assertFalse(VisibleNavigation.allowed(null, "rustorka.example"))
    }
}
