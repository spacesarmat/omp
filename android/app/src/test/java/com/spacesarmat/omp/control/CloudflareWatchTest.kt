package com.spacesarmat.omp.control

import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareWatchTest {
    private var now = 1_000_000L
    private var fg = true
    private val sent = ArrayList<Pair<String, String>>()
    private val answers = ArrayDeque<Any>()
    private val transport = object : WatchTransport {
        override fun post(url: String, token: String, body: String): Pair<Int, String> {
            assertEquals("0123456789abcdef0123456789abcdef", token)
            sent.add(url to body)
            val a = answers.removeFirstOrNull() ?: (200 to """{"request":null}""")
            if (a is IOException) throw a
            @Suppress("UNCHECKED_CAST")
            return a as Pair<Int, String>
        }
    }
    private val got = ArrayList<Pair<String, Boolean>>()
    private val watch = CloudflareWatch(transport, { fg }, { r, f -> got.add(r.id to f) }, { now })
    private val token = "0123456789abcdef0123456789abcdef"
    private val request = """{"request":{"id":"c7","site":"rustorka","url":"https://rustorka.example/"}}"""

    private fun run(ms: Long) {
        val end = now + ms
        while (now < end) {
            val d = watch.step()
            now += maxOf(d, 1)
        }
    }

    @Test
    fun idleUntilConfigured() {
        run(10_000)
        assertTrue(sent.isEmpty())
    }

    @Test
    fun pollsFasterWithTheAppOpenAndHandsOutANewRequestOnce() {
        watch.configure("http://192.168.1.50:8095", token)
        run(9_500)
        assertEquals(4, sent.size)
        assertTrue(sent.all { it.first == "http://192.168.1.50:8095/omp/cloudflare/poll" && it.second == "{}" })
        answers.add(200 to request)
        answers.add(200 to request)
        run(6_000)
        assertEquals(listOf("c7" to true), got)
        assertEquals("c7", watch.pending()!!.id)
        fg = false
        sent.clear()
        run(30_000)
        assertEquals(3, sent.size)
    }

    @Test
    fun stopsInTheBackgroundAfterTheLimit() {
        watch.configure("http://192.168.1.50:8095", token)
        fg = false
        run(CloudflareWatch.BG_LIMIT_MS + 1_000)
        val n = sent.size
        run(120_000)
        assertEquals(n, sent.size)
        fg = true
        run(4_000)
        assertTrue(sent.size > n)
    }

    @Test
    fun backsOffForgetsOnUnauthorizedAndAnswers() {
        watch.configure("http://192.168.1.50:8095", token)
        repeat(4) { answers.add(IOException("down")) }
        run(20_000)
        assertTrue(sent.size in 2..4)
        answers.clear()
        answers.add(200 to request)
        run(40_000)
        assertEquals("c7", got.last().first)
        assertEquals(200, watch.answer("c7", CloudflareProtocol.endedJson("c7", cancelled = true)))
        assertEquals("http://192.168.1.50:8095/omp/cloudflare/answer", sent.last().first)
        assertNull(watch.pending())
        answers.add(401 to """{"error":"unauthorized"}""")
        run(5_000)
        val n = sent.size
        run(30_000)
        assertEquals(n, sent.size)
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
    }
}
