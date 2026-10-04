package com.spacesarmat.omp.control

import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareWatchTest {
    private var now = 1_000_000L
    private var fg = true
    private var lan = true
    private var shows = true
    /** How long the TV holds each poll (a long poll), ms of virtual time. */
    private var held = CloudflareProtocol.MAX_WAIT_MS
    private val sent = ArrayList<Triple<String, String, Int>>()
    private val answers = ArrayDeque<Any>()
    private val token = "0123456789abcdef0123456789abcdef"
    private val transport = object : WatchTransport {
        override fun post(url: String, token: String, body: String, readTimeoutMs: Int): Pair<Int, String> {
            assertEquals(this@CloudflareWatchTest.token, token)
            sent.add(Triple(url, body, readTimeoutMs))
            val a = answers.removeFirstOrNull()
            if (a is IOException) throw a
            if (a != null) {
                @Suppress("UNCHECKED_CAST")
                return a as Pair<Int, String>
            }
            if (url.endsWith("/poll")) now += held
            return 200 to """{"request":null}"""
        }
    }
    private val got = ArrayList<Pair<String, Boolean>>()
    private val watch = CloudflareWatch(transport, { fg }, { lan }, { r, f ->
        got.add(r.id to f)
        shows
    }, { now })
    private val request = """{"request":{"id":"c7","site":"rustorka","url":"https://rustorka.example/"}}"""
    private val polls get() = sent.count { it.first.endsWith("/omp/cloudflare/poll") }

    /** Runs the loop for [ms] of virtual time; a SLEEP ends the run (the thread would wait for wake()). */
    private fun run(ms: Long): Boolean {
        val end = now + ms
        while (now < end) {
            val d = watch.step()
            if (d == CloudflareWatch.SLEEP) return false
            now += maxOf(d, 1)
        }
        return true
    }

    @Test
    fun sleepsUntilConfigured() {
        assertEquals(CloudflareWatch.SLEEP, watch.step())
        assertTrue(sent.isEmpty())
    }

    @Test
    fun longPollsWithTheAppOpenAndHandsOutANewRequestOnce() {
        watch.configure("http://192.168.1.50:8095", token)
        run(100_000)
        // one held poll every 25 s, never a 3 s cadence
        assertEquals(4, polls)
        val first = sent.first()
        assertEquals(CloudflareProtocol.MAX_WAIT_MS, JSONObject(first.second).getLong("wait"))
        assertTrue(first.third > CloudflareProtocol.MAX_WAIT_MS)
        assertTrue(first.second.toByteArray().size <= CloudflareProtocol.MAX_POLL_BODY)
        answers.add(200 to request)
        answers.add(200 to request)
        run(10_000)
        assertEquals(listOf("c7" to true), got)
        assertEquals("c7", watch.pending()!!.id)
    }

    @Test
    fun aTvThatAnswersAtOnceIsNotPolledInATightLoop() {
        held = 0
        watch.configure("http://192.168.1.50:8095", token)
        run(30_000)
        assertTrue(polls <= 11)
    }

    @Test
    fun aShortGraceInTheBackgroundThenSleepUntilWoken() {
        watch.configure("http://192.168.1.50:8095", token)
        run(1_000)
        fg = false
        assertEquals(false, run(CloudflareWatch.GRACE_MS + 60_000))
        val n = polls
        assertTrue(n in 12..14)
        // asleep: nothing more until the app comes back
        assertEquals(CloudflareWatch.SLEEP, watch.step())
        assertEquals(n, polls)
        fg = true
        watch.wake()
        run(1_000)
        assertTrue(polls > n)
    }

    @Test
    fun onlyOnWifiOrEthernet() {
        lan = false
        watch.configure("http://192.168.1.50:8095", token)
        assertEquals(CloudflareWatch.SLEEP, watch.step())
        assertTrue(sent.isEmpty())
        lan = true
        run(1_000)
        assertEquals(1, polls)
    }

    @Test
    fun aRequestThePhoneCannotShowIsDeclinedAtOnce() {
        shows = false
        watch.configure("http://192.168.1.50:8095", token)
        answers.add(200 to request)
        run(1_000)
        val a = sent.last()
        assertEquals("http://192.168.1.50:8095/omp/cloudflare/answer", a.first)
        assertEquals("unavailable", JSONObject(a.second).getString("result"))
        assertEquals("c7", JSONObject(a.second).getString("id"))
        assertNull(watch.pending())
    }

    @Test
    fun backsOffForgetsOnUnauthorizedAndAnswers() {
        watch.configure("http://192.168.1.50:8095", token)
        repeat(4) { answers.add(IOException("down")) }
        run(20_000)
        assertTrue(polls in 3..4)
        answers.clear()
        answers.add(200 to request)
        run(120_000)
        assertEquals("c7", got.last().first)
        assertEquals(200, watch.answer("c7", CloudflareProtocol.endedJson("c7", cancelled = true)))
        assertEquals("http://192.168.1.50:8095/omp/cloudflare/answer", sent.last().first)
        assertNull(watch.pending())
        answers.add(401 to """{"error":"unauthorized"}""")
        assertEquals(false, run(60_000))
        assertEquals(CloudflareWatch.SLEEP, watch.step())
        assertEquals(-1, watch.answer("c7", "{}"))
    }

    @Test
    fun aRequestExpires() {
        watch.configure("http://192.168.1.50:8095", token)
        answers.add(200 to request)
        run(1_000)
        assertEquals("c7", watch.pending()!!.id)
        now += CloudflareWatch.REQUEST_TTL_MS + 1
        assertNull(watch.pending())
        watch.configure(null, null)
        assertNull(watch.pending())
        assertEquals(CloudflareWatch.SLEEP, watch.step())
    }
}
