package com.spacesarmat.omp.sources

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** The real storage path of a browser session: SecretCookieStore / SecretAgentStore over a Keystore that can fail. */
class SessionStorageTest {
    private val now = 1_000_000_000_000L

    /** The encrypted entries; [fails] = the Keystore (or the commit) refuses every write. */
    private class FakeKeystore : SecretValues {
        val map = HashMap<String, String>()
        var fails = false
        override fun get(name: String): String? = map[name]
        override fun set(name: String, value: String) {
            if (fails) throw IllegalStateException("keystore")
            map[name] = value
        }
        override fun replace(values: Map<String, String>, remove: Collection<String>) {
            if (fails) throw IllegalStateException("keystore")
            for (k in remove) map.remove(k)
            map.putAll(values)
        }
        override fun delete(name: String) {
            map.remove(name)
        }
    }

    private val keystore = FakeKeystore()
    private val jar = SiteCookieJar(SecretCookieStore(keystore)) { now }
    private val agents = SessionAgents(SecretAgentStore(keystore, SecretAgentStore.SESSION_KEY)) { now }
    private val root = "https://kinozal.tv/".toHttpUrl()

    private fun fails(block: () -> Unit) {
        try {
            block()
            fail("expected a storage failure")
        } catch (e: IllegalStateException) {
            // expected
        }
    }

    @Test
    fun aRefusedWriteFailsTheImportAndKeepsNothing() {
        // an earlier form login, written while the Keystore worked
        CloudflareCookies.import(jar, root, listOf("uid" to "old", "cf_clearance" to "c"), now + 60_000)
        keystore.fails = true
        fails { SiteSession.importWithAgent(jar, agents, root, listOf("uid" to "new", "pass" to "p"), "Phone-UA", now) }
        // neither in memory nor in storage, and no agent left behind
        assertEquals("old", jar.loadForRequest(root).first { it.name == "uid" }.value)
        assertTrue(jar.loadForRequest(root).none { it.name == "pass" })
        assertNull(agents.agentFor("kinozal.tv"))
        assertTrue(keystore.map["cookies:kinozal.tv"]!!.contains("old"))
        // the Keystore is back: the import goes through and is stored
        keystore.fails = false
        SiteSession.importWithAgent(jar, agents, root, listOf("uid" to "new"), "Phone-UA", now)
        assertTrue(keystore.map["cookies:kinozal.tv"]!!.contains("new"))
        assertEquals("Phone-UA", agents.agentFor("kinozal.tv"))
        val fresh = SiteCookieJar(SecretCookieStore(keystore)) { now }
        assertEquals("new", fresh.loadForRequest(root).first { it.name == "uid" }.value)
    }

    @Test
    fun aBrowserLoginWhoseStorageFailsReportsIt() {
        keystore.fails = true
        val stored = ArrayList<HttpUrl>()
        val target = LoginTarget.Local { r, pairs, ua ->
            SiteSession.importWithAgent(jar, agents, r, pairs, ua, now)
            stored.add(r)
        }
        var result: CheckResult? = null
        val browser = object : CloudflareBrowser {
            override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {}
            override fun probe(result: (String?) -> Unit) = result(null)
            override fun cookies(url: String): String? = if (url == "https://kinozal.tv/") "uid=7" else null
            override fun forget(url: String) {}
            override fun close() {}
        }
        val sched = object : CloudflareSolver.Scheduler {
            val jobs = ArrayList<Pair<Long, () -> Unit>>()
            var t = 0L
            override fun post(delayMs: Long, block: () -> Unit) {
                jobs.add(t + delayMs to block)
            }
            override fun now(): Long = t
            fun run(until: Long) {
                while (true) {
                    val j = jobs.filter { it.first <= until }.minByOrNull { it.first } ?: break
                    jobs.remove(j)
                    t = j.first
                    j.second()
                }
            }
        }
        val texts = CheckTexts("t", "x", null, "Отмена", null, null, null, null, null, null, null, emptyMap())
        val ui = object : CheckUi {
            override fun showWaiting() {}
            override fun showPage(browser: CloudflareBrowser) {}
            override fun setHint(text: String?) {}
            override fun dismiss() {}
        }
        BrowserLogin(
            "https://kinozal.tv/login.php".toHttpUrl(), listOf("kinozal.tv"), SiteSession.check("my.php", "m", "login.php", listOf("uid"))!!,
            "Kinozal", "kinozal", texts, { browser }, sched, { "UA" }, { it() }, { _, _, _ -> true }, target, null,
            { result = it }, ExclusiveGate(),
        ).start(ui)
        sched.run(5_000)
        assertEquals(BrowserLogin.STORE_FAILED, result!!.result)
        assertTrue(stored.isEmpty())
        assertTrue(jar.loadForRequest(root).isEmpty())
    }

    @Test
    fun sessionAgentsAreApartFromCloudflareOverrides() {
        val cfStore = SecretAgentStore(keystore)
        val pass = CloudflarePass(null, FlareSolverrClient(), jar, { "TV-UA" }, cfStore, agents) { now }
        agents.set("kinozal.tv", "Phone-UA", now + 60_000)
        // precedence: no clearance override → the session's, then this device's
        assertEquals("Phone-UA", pass.userAgentFor("kinozal.tv"))
        assertEquals("TV-UA", pass.userAgentFor("rutracker.org"))
        assertEquals("Phone-UA", pass.baseAgentFor("kinozal.tv"))
        // a clearance with another UA wins while it lasts, and passing it here again never touches the session's
        pass.importClearance(root, listOf("cf_clearance" to "c"), "Other-UA", now + 1_000)
        assertEquals("Other-UA", pass.userAgentFor("kinozal.tv"))
        pass.importClearance(root, listOf("cf_clearance" to "c2"), null, now + 1_000)
        assertEquals("Phone-UA", pass.userAgentFor("kinozal.tv"))
        pass.clearAgent("kinozal.tv")
        assertEquals("Phone-UA", pass.userAgentFor("kinozal.tv"))
        // stored apart
        assertTrue(keystore.map.containsKey(SecretAgentStore.SESSION_KEY))
        // «Выйти»: every host of the site, both kinds
        agents.set("www.kinozal.tv", "Phone-UA", now + 60_000)
        pass.importClearance(root, listOf("cf_clearance" to "c3"), "Other-UA", now + 1_000)
        val http = SiteHttp(jar, pass)
        http.clearCookies("https://kinozal.tv/forum/")
        assertEquals("TV-UA", pass.userAgentFor("kinozal.tv"))
        assertEquals("TV-UA", pass.userAgentFor("www.kinozal.tv"))
        assertTrue(jar.loadForRequest(root).isEmpty())
    }

    @Test
    fun theHiddenCheckStartsWithTheSessionAgent() {
        agents.set("kinozal.tv", "Phone-UA", now + 60_000)
        val opened = ArrayList<String>()
        val browser = object : CloudflareBrowser {
            override fun open(url: String, userAgent: String, events: CloudflareBrowser.Events) {
                opened.add(userAgent)
            }
            override fun probe(result: (String?) -> Unit) = result(null)
            override fun cookies(url: String): String? = "cf_clearance=x"
            override fun forget(url: String) {}
            override fun close() {}
        }
        val sched = object : CloudflareSolver.Scheduler {
            override fun post(delayMs: Long, block: () -> Unit) {
                if (delayMs <= CloudflareSolver.POLL_MS) block()
            }
            override fun now(): Long = 0
        }
        val solver = CloudflareSolver({ browser }, sched, jar, { "TV-UA" }, gate = ExclusiveGate(), agentFor = { agents.agentFor(it) })
        solver.solveAsync("https://kinozal.tv/x".toHttpUrl()) {}
        solver.solveAsync("https://rutracker.org/".toHttpUrl()) {}
        assertEquals(listOf("Phone-UA", "TV-UA"), opened)
    }
}
