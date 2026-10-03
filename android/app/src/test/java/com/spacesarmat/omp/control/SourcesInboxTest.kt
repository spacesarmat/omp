package com.spacesarmat.omp.control

import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SourcesInboxTest {
    private val password = "pa55-secret-word"
    private val saved = ArrayList<Pair<String, String>>()
    private var storeFails = false
    private val events = java.util.concurrent.LinkedBlockingQueue<JSONObject>()
    private val store = object : LoginStore {
        override fun save(username: String, password: String) {
            if (storeFails) throw IllegalStateException("keystore")
            saved.add(username to password)
        }
    }
    private val pool = Executors.newCachedThreadPool()

    @After
    fun tearDown() {
        pool.shutdownNow()
    }

    private fun inbox(timeout: Long = 5_000) = SourcesInbox(store, { events.add(it) }, timeout)

    private fun transfer(login: Boolean = true) = SourcesTransfer(
        linkedMapOf("rutor" to true, "rutracker" to false),
        if (login) SourcesTransfer.Login("andy", password) else null,
        "Pixel",
    )

    private fun start(box: SourcesInbox, t: SourcesTransfer): Future<SourcesOutcome> = pool.submit<SourcesOutcome> { box.receive(t) }

    @Test
    fun savesTheLoginThenWaitsForThePage() {
        val box = inbox()
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        // the page hears only that a login came: never the password or the user name
        assertFalse(e.toString().contains(password))
        assertFalse(e.toString().contains("andy"))
        assertEquals(true, e.getBoolean("rutracker"))
        assertEquals("Pixel", e.getString("phone"))
        assertEquals(true, e.getJSONObject("sources").getBoolean("rutor"))
        assertEquals(listOf("andy" to password), saved)
        assertFalse(box.done("other", "ok", false))
        assertTrue(box.done(e.getString("id"), "bad_login", false))
        assertEquals(SourcesOutcome.Applied("bad_login"), f.get(2, TimeUnit.SECONDS))
        // a late answer finds nothing
        assertFalse(box.done(e.getString("id"), "ok", false))
    }

    @Test
    fun unknownResultsBecomeErrorAndFailuresAreReported() {
        val box = inbox()
        var f = start(box, transfer())
        var e = events.poll(2, TimeUnit.SECONDS)!!
        box.done(e.getString("id"), "<script>", false)
        assertEquals(SourcesOutcome.Applied("error"), f.get(2, TimeUnit.SECONDS))

        f = start(box, transfer(login = false))
        e = events.poll(2, TimeUnit.SECONDS)!!
        assertEquals(false, e.getBoolean("rutracker"))
        box.done(e.getString("id"), null, true)
        assertEquals(SourcesOutcome.Failed, f.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun oneTransferAtATime() {
        val box = inbox()
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        assertEquals(SourcesOutcome.Busy, box.receive(transfer()))
        box.done(e.getString("id"), "ok", false)
        assertEquals(SourcesOutcome.Applied("ok"), f.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun noAnswerTimesOutAndFreesTheInbox() {
        val box = inbox(timeout = 100)
        assertEquals(SourcesOutcome.NoAnswer, box.receive(transfer(login = false)))
        val f = start(box, transfer(login = false))
        val first = events.poll(2, TimeUnit.SECONDS)!!
        val second = events.poll(2, TimeUnit.SECONDS)!!
        assertFalse(first.getString("id") == second.getString("id"))
        assertEquals(SourcesOutcome.NoAnswer, f.get(2, TimeUnit.SECONDS))
    }

    @Test
    fun storageFailureStopsBeforeThePage() {
        storeFails = true
        val box = inbox()
        assertEquals(SourcesOutcome.StoreFailed, box.receive(transfer()))
        assertTrue(events.isEmpty())
        // and the inbox is free again
        storeFails = false
        val f = start(box, transfer())
        val e = events.poll(2, TimeUnit.SECONDS)!!
        box.done(e.getString("id"), "ok", false)
        assertEquals(SourcesOutcome.Applied("ok"), f.get(2, TimeUnit.SECONDS))
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
    }
}
