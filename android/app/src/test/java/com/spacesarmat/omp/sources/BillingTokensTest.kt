package com.spacesarmat.omp.sources

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class BillingTokensTest {
    private val device = "a".repeat(32)
    private val now = 1_000_000_000_000L

    private class Store(var refuseWrites: Boolean = false, var failReads: Boolean = false) : SecretValues {
        val values = HashMap<String, String>()
        override fun get(name: String): String? {
            if (failReads) throw IllegalStateException("keystore")
            return values[name]
        }
        override fun set(name: String, value: String) {
            if (refuseWrites) throw IllegalStateException("keystore")
            values[name] = value
        }
        override fun replace(values: Map<String, String>, remove: Collection<String>) = throw UnsupportedOperationException()
        override fun delete(name: String) {
            values.remove(name)
        }
    }

    private fun pair(n: Int, accessLeft: Long = 24 * 3600_000L) = JSONObject()
        .put("refreshToken", "r1.n$n").put("accessToken", "a1.n$n")
        .put("accessExpiresAt", now + accessLeft).put("refreshExpiresAt", now + 180 * 86_400_000L).put("paidUntil", 2_000_000_000_000L)
        .toString()

    private class Server(val answer: (Map<String, String>, Int) -> BillingTokens.Answer) {
        val forms = ArrayList<Map<String, String>>()
        val headers = ArrayList<Map<String, String>>()
        fun post(form: Map<String, String>, h: Map<String, String>): BillingTokens.Answer {
            synchronized(forms) {
                forms.add(form)
                headers.add(h)
            }
            return answer(form, forms.size)
        }
    }

    private fun tokens(store: Store, server: Server, warns: MutableList<String> = ArrayList(), pauses: MutableList<Long> = ArrayList()) =
        BillingTokens(store, server::post, { pauses.add(it) }, { warns.add(it) }, { now })

    @Test
    fun rotatesAndKeepsTheNewRefreshTokenInTheKeystoreOnly() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val out = tokens(store, server).refresh(device, "a1.old")
        assertTrue(out.getBoolean("ok"))
        assertEquals("a1.n1", out.getString("accessToken"))
        assertFalse(out.getBoolean("volatile"))
        assertFalse(out.has("refreshToken"))
        assertEquals("r1.old", server.forms[0]["refreshToken"])
        assertEquals(device, server.forms[0]["deviceId"])
        assertEquals(device, server.headers[0]["X-Device-Id"])
        assertEquals("r1.n1", store.values[BillingTokens.KEY])
    }

    @Test
    fun oneRefreshForTheWholeProcess() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val calls = AtomicInteger()
        val inside = CountDownLatch(1)
        val server = Server { _, n ->
            calls.incrementAndGet()
            inside.countDown()
            Thread.sleep(150)
            BillingTokens.Answer(200, pair(n))
        }
        val t = tokens(store, server)
        val barrier = CyclicBarrier(3)
        val results = arrayOfNulls<JSONObject>(3)
        val threads = (0 until 3).map { i ->
            Thread {
                barrier.await()
                results[i] = t.refresh(device, "a1.old")
            }.apply { start() }
        }
        threads.forEach { it.join(5_000) }
        assertEquals(1, calls.get())
        results.forEach { assertEquals("a1.n1", it!!.getString("accessToken")) }
        assertEquals("r1.n1", store.values[BillingTokens.KEY])
        assertTrue(inside.await(0, TimeUnit.MILLISECONDS))
    }

    @Test
    fun aPageWithTheFreshTokenAlreadyRenewsAgain() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val t = tokens(store, server)
        t.refresh(device, "a1.old")
        // the same page with the token it just got: a real new refresh with the rotated token
        val again = t.refresh(device, "a1.n1")
        assertEquals("a1.n2", again.getString("accessToken"))
        assertEquals("r1.n1", server.forms[1]["refreshToken"])
    }

    @Test
    fun aLostAnswerIsAskedOnceMoreWithTheSameToken() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val pauses = ArrayList<Long>()
        val server = Server { _, n -> if (n == 1) throw IOException("timeout") else BillingTokens.Answer(200, pair(n)) }
        val out = tokens(store, server, pauses = pauses).refresh(device, "a1.old")
        assertTrue(out.getBoolean("ok"))
        assertEquals(listOf("r1.old", "r1.old"), server.forms.map { it["refreshToken"] })
        assertEquals(listOf(BillingTokens.LOST_RETRY_MS), pauses)
    }

    @Test
    fun aNetworkErrorNeverForgetsTheToken() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val server = Server { _, _ -> throw IOException("offline") }
        val out = tokens(store, server).refresh(device, "a1.old")
        assertFalse(out.getBoolean("ok"))
        assertEquals("network", out.getString("error"))
        assertEquals(2, server.forms.size)
        assertEquals("r1.old", store.values[BillingTokens.KEY])
    }

    @Test
    fun busyOrBrokenServerKeepsTheToken() {
        for ((status, error) in listOf(429 to "rate", 503 to "down", 401 to "down")) {
            val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
            val server = Server { _, _ -> BillingTokens.Answer(status, "{\"error\":\"token_expired\"}") }
            assertEquals(error, tokens(store, server).refresh(device, "a1.old").getString("error"))
            assertEquals("r1.old", store.values[BillingTokens.KEY])
        }
    }

    @Test
    fun theServerDroppingTheBindingForgetsIt() {
        for (code in listOf("revoked", "refresh_expired", "bad_token")) {
            val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
            val server = Server { _, _ -> BillingTokens.Answer(401, "{\"error\":\"$code\"}") }
            val out = tokens(store, server).refresh(device, "a1.old")
            assertEquals("gone", out.getString("error"))
            assertEquals(code, out.getString("code"))
            assertNull(store.values[BillingTokens.KEY])
        }
    }

    @Test
    fun aRefusedKeystoreWriteKeepsTheTokenInMemoryOnlyAndLogsWithoutTheValue() {
        val store = Store(refuseWrites = true).apply { values[BillingTokens.KEY] = "r1.old" }
        val warns = ArrayList<String>()
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val t = tokens(store, server, warns)
        val out = t.refresh(device, "a1.old")
        assertTrue(out.getBoolean("volatile"))
        // the rotated token must not come back from the Keystore
        assertNull(store.values[BillingTokens.KEY])
        assertEquals(1, warns.size)
        assertFalse(warns[0].contains("r1."))
        assertEquals(JSONObject().put("present", true).put("volatile", true).toString(), t.status().toString())
        // the next refresh of this process uses the token from memory
        t.refresh(device, "a1.n1")
        assertEquals("r1.n1", server.forms[1]["refreshToken"])
        // once the Keystore takes it again, memory is cleared
        store.refuseWrites = false
        val third = t.refresh(device, "a1.n2")
        assertFalse(third.getBoolean("volatile"))
        assertEquals("r1.n3", store.values[BillingTokens.KEY])
        assertEquals(JSONObject().put("present", true).put("volatile", false).toString(), t.status().toString())
    }

    @Test
    fun afterARestartWithoutTheKeystoreCopyNothingIsLeft() {
        val store = Store(refuseWrites = true)
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        assertTrue(tokens(store, server).adopt("r1.new"))
        val restarted = tokens(Store(), server)
        assertEquals(JSONObject().put("present", false).put("volatile", false).toString(), restarted.status().toString())
        assertEquals("missing", restarted.refresh(device, "a1.x").getString("error"))
        assertEquals(0, server.forms.size)
    }

    @Test
    fun adoptStoresAPairFromThePageAndDropsTheCachedAccess() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val t = tokens(store, server)
        t.refresh(device, "a1.old")
        assertFalse(t.adopt("r1.code"))
        assertEquals("r1.code", store.values[BillingTokens.KEY])
        // a new binding: the access token cached for the old one is not handed out
        t.refresh(device, "a1.other")
        assertEquals("r1.code", server.forms[1]["refreshToken"])
    }

    @Test
    fun aTransientKeystoreReadIsNotALostToken() {
        val store = Store(failReads = true)
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val t = tokens(store, server)
        assertEquals("down", t.refresh(device, "a1.x").getString("error"))
        assertTrue(t.status().getBoolean("present"))
        assertEquals(0, server.forms.size)
    }

    @Test
    fun badInputAndForget() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val t = tokens(store, server)
        assertEquals("bad_request", t.refresh("nope", "").getString("error"))
        assertEquals("down", tokens(store, Server { _, _ -> BillingTokens.Answer(200, "{}") }).refresh(device, "").getString("error"))
        t.forget()
        assertNull(store.values[BillingTokens.KEY])
        assertEquals("missing", t.refresh(device, "").getString("error"))
    }

    @Test
    fun sendsThePhoneModelWithEveryRefreshCleanedAndShort() {
        val store = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        val server = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val named = BillingTokens(store, server::post, {}, {}, { now }, { "Xiaomi 2201117TY*" })
        assertTrue(named.refresh(device, "a1.old").getBoolean("ok"))
        assertEquals("Xiaomi 2201117TY", server.forms[0]["name"])
        // an empty or failing model sends no name at all; the refresh itself works
        val quiet = Server { _, n -> BillingTokens.Answer(200, pair(n)) }
        val store2 = Store().apply { values[BillingTokens.KEY] = "r1.old" }
        assertTrue(BillingTokens(store2, quiet::post, {}, {}, { now }, { throw IllegalStateException("no build") }).refresh(device, "a1.x").getBoolean("ok"))
        assertFalse(quiet.forms[0].containsKey("name"))
    }

    @Test
    fun modelNameAndItsBillingForm() {
        assertEquals("Xiaomi 2201117TY", BillingTokens.modelName("Xiaomi", "2201117TY"))
        assertEquals("Samsung SM-S918B", BillingTokens.modelName("samsung", "SM-S918B"))
        assertEquals("Google Pixel 8", BillingTokens.modelName("Google", "Pixel 8"))
        assertEquals("OnePlus CPH2449", BillingTokens.modelName("OnePlus", "OnePlus CPH2449"))
        assertEquals("Model", BillingTokens.modelName("", " Model "))
        assertEquals("Samsung SM-S918B", BillingTokens.billingName("  Samsung\tSM-S918B\n"))
        assertEquals("bold x (y)", BillingTokens.billingName("*bold*_[x](y)`"))
        assertEquals(BillingTokens.NAME_MAX, BillingTokens.billingName("x".repeat(60)).length)
        assertEquals("", BillingTokens.billingName(null))
    }
}
