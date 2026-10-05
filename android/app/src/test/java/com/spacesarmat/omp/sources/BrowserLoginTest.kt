package com.spacesarmat.omp.sources

import com.spacesarmat.omp.control.CloudflareRelay
import java.util.PriorityQueue
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserLoginTest {
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

    /** Cookies per root URL. */
    private class FakeBrowser : CloudflareBrowser {
        var opened: String? = null
        var agent: String? = null
        val jar = HashMap<String, String>()
        var closed = false
        val forgotten = ArrayList<String>()
        override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {
            opened = url
            agent = userAgent
        }
        override fun probe(result: (String?) -> Unit) = result(null)
        override fun cookies(url: String): String? = jar[url]
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
        "Вход на Kinozal", "Войдите как обычно", null, "Отмена", "Войти на телефоне", "Ввести пультом", "Телефон «%s» получит запрос",
        "Подключите телефон", "Откройте OMP на телефоне", "Войдите на телефоне «%s»", "Ждём",
        mapOf("UNVERIFIED" to "Вход с телефона не подтвердился", "NOT_TAKEN" to "Телефон не ответил"),
    )
    private val check = SiteSession.check("my.php", "logout.php?hash4u=", "login.php", listOf("uid"))!!
    private val start = "https://kinozal.me/login.php".toHttpUrl()
    private val sched = FakeScheduler()
    private val log = ArrayList<String>()
    private val ui = FakeUi(log)
    private val gate = CountingGate()
    private val browser = FakeBrowser()
    private val results = ArrayList<CheckResult>()
    private class Stored(val root: HttpUrl, val pairs: List<Pair<String, String>>, val ua: String?)
    private val stored = ArrayList<Stored>()
    private val verified = ArrayList<Pair<HttpUrl, String>>()
    private var verifyOk: (List<Pair<String, String>>) -> Boolean = { true }

    private fun login(
        target: LoginTarget = LoginTarget.Local { root, pairs, ua -> stored.add(Stored(root, pairs, ua)) },
        relay: CloudflareRelay? = null,
        askFirst: Boolean = false,
    ) = BrowserLogin(
        start, listOf("kinozal.me", "kinozal.tv"), check, "Kinozal", "kinozal", texts, { browser }, sched, { "Device-UA" }, { it() },
        { root, pairs, ua ->
            verified.add(root to ua)
            verifyOk(pairs)
        },
        target, relay, { results.add(it); log.add("done:" + it.result) }, gate,
        gateWaitMs = 2_000, pollMs = 500, verifyEveryMs = 1_000, maxOpenMs = 60_000, askPhoneFirst = askFirst,
    )

    private fun assertClosed() {
        assertEquals(1, results.size)
        assertFalse(gate.held)
        assertTrue(browser.closed)
        assertTrue(browser.forgotten.isNotEmpty())
        assertTrue(log.indexOf("dismiss") in 0 until log.indexOf("done:" + results[0].result))
    }

    @Test
    fun opensTheLoginPageWaitsForTheSessionVerifiesAndStoresIt() {
        login().start(ui)
        assertEquals("https://kinozal.me/login.php", browser.opened)
        assertEquals("Device-UA", browser.agent)
        assertTrue(gate.held)
        // a guest cookie only: not checked
        browser.jar["https://kinozal.me/"] = "guest=1; cf_clearance=c"
        sched.runUntil(3_000)
        assertTrue(verified.isEmpty())
        // signed in on the other mirror: checked there, then stored there
        browser.jar["https://kinozal.tv/"] = "uid=7; pass=p; cf_clearance=c"
        sched.runUntil(6_000)
        assertEquals("kinozal.tv", verified.single().first.host)
        val s = stored.single()
        assertEquals("kinozal.tv", s.root.host)
        assertEquals(setOf("uid", "pass", "cf_clearance"), s.pairs.map { it.first }.toSet())
        assertNull(s.ua)
        assertEquals("ok", results.single().result)
        assertEquals("kinozal.tv", results.single().host)
        assertClosed()
    }

    @Test
    fun aSessionThatDoesNotVerifyIsNotKeptAndTriedAgainOnlyWhenItChangesOrLater() {
        verifyOk = { pairs -> pairs.any { it.first == "uid" && it.second == "8" } }
        login().start(ui)
        browser.jar["https://kinozal.me/"] = "uid=7"
        sched.runUntil(5_000)
        assertEquals(1, verified.size)
        assertTrue(stored.isEmpty())
        assertTrue(results.isEmpty())
        // the same cookies are not re-checked right away, a new value is
        browser.jar["https://kinozal.me/"] = "uid=8"
        sched.runUntil(8_000)
        assertEquals(2, verified.size)
        assertEquals("ok", results.single().result)
        assertClosed()
    }

    @Test
    fun cancelAndBusyAndTimeout() {
        val l = login()
        l.start(ui)
        l.cancel()
        assertEquals("cancelled", results.single().result)
        assertClosed()
        assertTrue(stored.isEmpty())

        // another WebView holds the gate: busy after the wait
        results.clear()
        gate.tryEnter()
        val other = FakeBrowser()
        val b = BrowserLogin(
            start, listOf("kinozal.me"), check, "Kinozal", "kinozal", texts, { other }, sched, { "UA" }, { it() }, { _, _, _ -> true },
            LoginTarget.Local { _, _, _ -> }, null, { results.add(it) }, gate, gateWaitMs = 2_000, pollMs = 500,
        )
        b.start(ui)
        sched.runUntil(sched.time + 3_000)
        assertEquals("busy", results.single().result)
        assertNull(other.opened)
        gate.leave()

        // left open too long
        results.clear()
        val t = BrowserLogin(
            start, listOf("kinozal.me"), check, "Kinozal", "kinozal", texts, { FakeBrowser() }, sched, { "UA" }, { it() }, { _, _, _ -> true },
            LoginTarget.Local { _, _, _ -> }, null, { results.add(it) }, gate, pollMs = 500, maxOpenMs = 5_000,
        )
        t.start(ui)
        sched.runUntil(sched.time + 6_000)
        assertEquals("cancelled", results.single().result)
        assertFalse(gate.held)
    }

    @Test
    fun aStorageFailureIsAFailure() {
        login(target = LoginTarget.Local { _, _, _ -> throw IllegalStateException("keystore") }).start(ui)
        browser.jar["https://kinozal.me/"] = "uid=7"
        sched.runUntil(3_000)
        assertEquals("failed", results.single().result)
        assertClosed()
    }

    @Test
    fun phoneForTheTvSendsTheSessionAndTellsWhetherTheTvTookIt() {
        val sent = ArrayList<Triple<String?, List<Pair<String, String>>?, String>>()
        login(target = LoginTarget.Tv { host, pairs, ua -> sent.add(Triple(host, pairs, ua)); 200 }).start(ui)
        browser.jar["https://kinozal.me/"] = "uid=7"
        sched.runUntil(3_000)
        assertEquals("kinozal.me", sent.single().first)
        assertEquals("Device-UA", sent.single().third)
        assertEquals(true, results.single().sent)

        // cancelled: the TV hears it
        results.clear()
        sent.clear()
        val l = login(target = LoginTarget.Tv { host, pairs, ua -> sent.add(Triple(host, pairs, ua)); 200 })
        l.start(ui)
        l.cancel()
        assertNull(sent.single().second)
        assertEquals("cancelled", results.single().result)
    }

    @Test
    fun tvAsksThePhoneAndChecksItsSessionBeforeKeepingIt() {
        val relay = CloudflareRelay({ _, _, _, _ -> }, pickupMs = 2_000, answerMs = 2_000)
        relay.poll("t1", "Pixel 8")
        val ua = "Phone-UA"
        // the phone: picks the request up and answers with a session on the mirror
        val phone = Thread {
            repeat(400) {
                val r = relay.poll("t1", "Pixel 8")
                if (!r.isNull("request")) {
                    val id = r.getJSONObject("request").getString("id")
                    relay.answer("t1", JSONObject("""{"id":"$id","result":"solved","host":"kinozal.tv","cookies":[{"name":"uid","value":"9"}],"ua":"$ua","until":1}"""))
                    return@Thread
                }
                Thread.sleep(5)
            }
        }
        phone.start()
        login(relay = relay, askFirst = true).start(ui)
        phone.join(3_000)
        sched.runUntil(1)
        assertEquals("kinozal.tv" to ua, verified.single().first.host to verified.single().second)
        val s = stored.single()
        assertEquals("kinozal.tv", s.root.host)
        assertEquals(ua, s.ua)
        assertEquals("phone", results.single().via)
        assertClosed()
    }

    @Test
    fun tvKeepsTheDialogWhenThePhoneSessionDoesNotVerify() {
        verifyOk = { false }
        val relay = CloudflareRelay({ _, _, _, _ -> }, pickupMs = 2_000, answerMs = 2_000)
        relay.poll("t1", "Pixel 8")
        val phone = Thread {
            repeat(400) {
                val r = relay.poll("t1", "Pixel 8")
                if (!r.isNull("request")) {
                    val id = r.getJSONObject("request").getString("id")
                    relay.answer("t1", JSONObject("""{"id":"$id","result":"solved","host":"kinozal.me","cookies":[{"name":"uid","value":"9"}],"ua":"P","until":1}"""))
                    return@Thread
                }
                Thread.sleep(5)
            }
        }
        phone.start()
        val l = login(relay = relay)
        l.start(ui)
        l.askPhone()
        phone.join(3_000)
        sched.runUntil(1)
        assertTrue(stored.isEmpty())
        assertTrue(results.isEmpty())
        assertEquals("Вход с телефона не подтвердился", ui.shown)
        l.cancel()
        assertFalse(gate.held)
    }
}
