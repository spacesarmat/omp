package com.spacesarmat.omp.control

import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SourcesInboxTest {
    private val password = "pa55-secret-word"
    private val oldPassword = "old-working-pass"

    /** In-memory encrypted storage: one map, replace() is all-or-nothing like the SharedPreferences commit. */
    private val entries = object : SecretEntries {
        val map = LinkedHashMap<String, String>()
        var fails = false
        var writes = 0
        override fun get(name: String): String? = map[name]
        override fun replace(values: Map<String, String>, remove: Collection<String>) {
            if (fails) throw IllegalStateException("keystore")
            writes++
            for (k in remove) map.remove(k)
            map.putAll(values)
        }
    }
    private val store = SecretLoginStore(entries) { "js:$it" }
    private val events = LinkedBlockingQueue<JSONObject>()
    private val pool = Executors.newCachedThreadPool()
    private var now = 1_000L

    @After
    fun tearDown() {
        pool.shutdownNow()
    }

    private fun inbox(timeout: Long = 5_000) = SourcesInbox(store, { events.add(it) }, timeout) { now }

    private fun transfer(login: Boolean = true) = SourcesTransfer(
        linkedMapOf("rutor" to true, "rutracker" to false),
        if (login) SourcesTransfer.Login("andy", password) else null,
        "Pixel",
    )

    private fun start(box: SourcesInbox, t: SourcesTransfer): Future<SourcesOutcome> = pool.submit<SourcesOutcome> { box.receive(t) }

    private fun live() = entries.map["js:rutracker.username"] to entries.map["js:rutracker.password"]

    private fun withOldLogin() {
        entries.map["js:rutracker.username"] = "old-user"
        entries.map["js:rutracker.password"] = oldPassword
    }

    @Test
    fun stagesTheLoginAndPromotesItOnlyAfterThePageSignedIn() {
        withOldLogin()
        val box = inbox()
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        // the page hears only that a login came: never the password or the user name
        assertFalse(e.toString().contains(password))
        assertFalse(e.toString().contains("andy"))
        assertEquals(true, e.getBoolean("rutracker"))
        assertEquals("Pixel", e.getString("phone"))
        assertEquals(1_000L, e.getLong("at"))
        assertEquals(true, e.getJSONObject("sources").getBoolean("rutor"))
        // staged; the live login is untouched until the page answers
        assertEquals("andy", entries.map["js:rutracker.pending.username"])
        assertEquals(password, entries.map["js:rutracker.pending.password"])
        assertEquals("old-user" to oldPassword, live())
        assertEquals(SourcesDone.UNKNOWN, box.done("other", "ok", false))
        assertEquals(SourcesDone.STORED, box.done(e.getString("id"), "ok", false))
        assertEquals(SourcesOutcome.Applied("ok"), f.get(2, TimeUnit.SECONDS))
        assertEquals("andy" to password, live())
        assertFalse(entries.map.containsKey("js:rutracker.pending.username"))
        assertFalse(entries.map.containsKey("js:rutracker.pending.password"))
        // a late answer finds nothing
        assertEquals(SourcesDone.UNKNOWN, box.done(e.getString("id"), "ok", false))
    }

    @Test
    fun aRefusedLoginDropsOnlyTheStagedPair() {
        for (result in listOf("bad_login", "captcha", "error")) {
            withOldLogin()
            val box = inbox()
            val f = start(box, transfer())
            val e = events.poll(2, TimeUnit.SECONDS)!!
            box.done(e.getString("id"), result, false)
            assertEquals(result, SourcesOutcome.Applied(result), f.get(2, TimeUnit.SECONDS))
            assertEquals(result, "old-user" to oldPassword, live())
            assertEquals(result, setOf("js:rutracker.username", "js:rutracker.password"), entries.map.keys)
        }
    }

    @Test
    fun unknownResultsBecomeErrorAndFailuresAreReported() {
        val box = inbox()
        var f = start(box, transfer())
        var e = events.poll(2, TimeUnit.SECONDS)!!
        box.done(e.getString("id"), "<script>", false)
        assertEquals(SourcesOutcome.Applied("error"), f.get(2, TimeUnit.SECONDS))
        assertEquals(null to null, live())

        f = start(box, transfer(login = false))
        e = events.poll(2, TimeUnit.SECONDS)!!
        assertEquals(false, e.getBoolean("rutracker"))
        box.done(e.getString("id"), null, true)
        assertEquals(SourcesOutcome.Failed, f.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun oneTransferAtATimeAndOnlyItsEventIsPending() {
        val box = inbox()
        assertNull(box.pendingEvent())
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        assertEquals(e.getString("id"), box.pendingEvent()!!.getString("id"))
        assertEquals(SourcesOutcome.Busy, box.receive(transfer()))
        // the busy one never replaced the waiting event
        assertEquals(e.getString("id"), box.pendingEvent()!!.getString("id"))
        box.done(e.getString("id"), "ok", false)
        assertEquals(SourcesOutcome.Applied("ok"), f.get(2, TimeUnit.SECONDS))
        assertNull(box.pendingEvent())
    }

    @Test
    fun noAnswerTimesOutDropsTheStagedLoginAndThePendingEvent() {
        withOldLogin()
        val box = inbox(timeout = 100)
        assertEquals(SourcesOutcome.NoAnswer, box.receive(transfer()))
        assertNull(box.pendingEvent())
        assertEquals("old-user" to oldPassword, live())
        assertFalse(entries.map.containsKey("js:rutracker.pending.password"))
        val f = start(box, transfer(login = false))
        val first = events.poll(2, TimeUnit.SECONDS)!!
        val second = events.poll(2, TimeUnit.SECONDS)!!
        assertFalse(first.getString("id") == second.getString("id"))
        assertEquals(SourcesOutcome.NoAnswer, f.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun storageFailureStopsBeforeThePage() {
        withOldLogin()
        entries.fails = true
        val box = inbox()
        assertEquals(SourcesOutcome.StoreFailed, box.receive(transfer()))
        assertTrue(events.isEmpty())
        assertEquals("old-user" to oldPassword, live())
        // and the inbox is free again
        entries.fails = false
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        box.done(e.getString("id"), "ok", false)
        assertEquals(SourcesOutcome.Applied("ok"), f.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun aFailedPromotionTellsThePage() {
        withOldLogin()
        val box = inbox()
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        entries.fails = true
        assertEquals(SourcesDone.NOT_STORED, box.done(e.getString("id"), "ok", false))
        assertEquals(SourcesOutcome.StoreFailed, f.get(2, TimeUnit.SECONDS))
        assertEquals("old-user" to oldPassword, live())
    }

    @Test
    fun aStagedLoginLeftByADeadProcessIsDroppedOnStart() {
        withOldLogin()
        store.stage("andy", password)
        val box = inbox()
        assertTrue(box.dropStaged())
        assertEquals(setOf("js:rutracker.username", "js:rutracker.password"), entries.map.keys)
        assertEquals("old-user" to oldPassword, live())
    }

    @Test
    fun promotionIsOneWrite() {
        store.stage("andy", password)
        val before = entries.writes
        store.promote()
        assertEquals(before + 1, entries.writes)
        assertEquals("andy" to password, live())
        // nothing staged: promote refuses rather than write half a login
        try {
            store.promote()
            throw AssertionError("expected a failure")
        } catch (_: IllegalStateException) {
        }
        assertEquals("andy" to password, live())
    }

    @Test
    fun parseKeepsThePhoneAndTrimsTheUser() {
        val t = SourcesProtocol.parse(
            JSONObject("""{"v":1,"sources":{"rutor":false},"rutracker":{"username":" andy ","password":" $password "}}"""),
            "Pixel",
        )!!
        assertEquals(mapOf("rutor" to false), t.sources)
        assertEquals("andy", t.login!!.username)
        // the password is taken as typed
        assertEquals(" $password ", t.login!!.password)
        assertEquals("Pixel", t.phone)
        // C1 control characters are refused like C0 ones (same as src/sources/transfer.ts)
        assertNull(SourcesProtocol.parse(JSONObject("""{"v":1,"sources":{"rutor":true},"rutracker":{"username":"a\u0085b","password":"p"}}"""), "P"))
    }

    // test-only key
    private val apiKey = "test0only0key0000000000000000abc"

    private fun withIndexers() = SourcesTransfer(
        linkedMapOf("rutor" to true),
        null,
        "Pixel",
        listOf(
            SourcesTransfer.Indexer("jackett", "http://192.168.1.5:9117", null, apiKey),
            SourcesTransfer.Indexer("prowlarr", "http://192.168.1.7:9696", "Дом", null),
        ),
    )

    @Test
    fun stagesIndexerKeysTheEventSaysOnlyThatAndTheyAreDroppedAfterTheAnswer() {
        val box = inbox()
        val f = start(box, withIndexers())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        assertFalse(e.toString().contains(apiKey))
        val list = e.getJSONArray("indexers")
        assertEquals(2, list.length())
        assertEquals("jackett", list.getJSONObject(0).getString("kind"))
        assertEquals("http://192.168.1.5:9117", list.getJSONObject(0).getString("url"))
        assertEquals(true, list.getJSONObject(0).getBoolean("key"))
        assertEquals(false, list.getJSONObject(1).getBoolean("key"))
        assertEquals("Дом", list.getJSONObject(1).getString("name"))
        // staged under the entry the page reads, by position
        assertEquals(apiKey, entries.map["js:indexer.pending.0.apikey"])
        assertNull(entries.map["js:indexer.pending.1.apikey"])
        // the page moves the key to the connection's entry, then answers
        entries.map["js:indexer.jackett-1.apikey"] = entries.map["js:indexer.pending.0.apikey"]!!
        assertEquals(SourcesDone.STORED, box.done(e.getString("id"), null, false, 2))
        assertEquals(SourcesOutcome.Applied(null, 2), f.get(2, TimeUnit.SECONDS))
        assertFalse(entries.map.keys.any { it.startsWith("js:indexer.pending.") })
        assertEquals(apiKey, entries.map["js:indexer.jackett-1.apikey"])
    }

    @Test
    fun noAnswerOrAFailingStorageLeavesNoStagedKey() {
        val box = inbox(timeout = 200)
        assertEquals(SourcesOutcome.NoAnswer, box.receive(withIndexers()))
        assertFalse(entries.map.keys.any { it.startsWith("js:indexer.pending.") })
        entries.fails = true
        assertEquals(SourcesOutcome.StoreFailed, inbox().receive(withIndexers()))
        entries.fails = false
        // a key left by a process that died is dropped at start
        entries.map["js:indexer.pending.3.apikey"] = apiKey
        assertTrue(inbox().dropStaged())
        assertFalse(entries.map.containsKey("js:indexer.pending.3.apikey"))
    }

    @Test
    fun withoutKeysNothingIsStaged() {
        val box = inbox()
        val t = SourcesTransfer(linkedMapOf("rutor" to true), null, "Pixel", listOf(SourcesTransfer.Indexer("jackett", "http://h:9117", null, null)))
        val f = start(box, t)
        val e = events.poll(2, TimeUnit.SECONDS)!!
        val before = entries.writes
        assertEquals(SourcesDone.STORED, box.done(e.getString("id"), null, false, 1))
        assertEquals(SourcesOutcome.Applied(null, 1), f.get(2, TimeUnit.SECONDS))
        assertEquals(before, entries.writes)
        // a count from the page is kept within bounds
        val f2 = start(box, t)
        val e2 = events.poll(2, TimeUnit.SECONDS)!!
        box.done(e2.getString("id"), null, false, 999)
        assertEquals(SourcesOutcome.Applied(null, SourcesProtocol.MAX_INDEXERS), f2.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun theEventCarriesTheFlareSolverrAddressAndTheCloudflareSwitches() {
        val box = inbox()
        val t = SourcesTransfer(linkedMapOf("rutor" to true), null, "Pixel", emptyList(), "http://192.168.1.191:8191", linkedMapOf("kinozal" to true, "rustorka" to false))
        val f = start(box, t)
        val e = events.poll(2, TimeUnit.SECONDS)!!
        assertEquals("http://192.168.1.191:8191", e.getString("flaresolverr"))
        assertEquals(true, e.getJSONObject("cloudflare").getBoolean("kinozal"))
        assertEquals(false, e.getJSONObject("cloudflare").getBoolean("rustorka"))
        assertEquals(SourcesDone.STORED, box.done(e.getString("id"), null, false))
        assertEquals(SourcesOutcome.Applied(null), f.get())
        // without them the event has neither
        val g = start(box, transfer(login = false))
        val e2 = events.poll(2, TimeUnit.SECONDS)!!
        assertFalse(e2.has("flaresolverr"))
        assertFalse(e2.has("cloudflare"))
        box.done(e2.getString("id"), null, false)
        g.get()
        assertTrue(t.toString().indexOf("192.168") < 0)
    }
}
