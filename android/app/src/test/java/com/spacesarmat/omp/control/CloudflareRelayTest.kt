package com.spacesarmat.omp.control

import java.util.concurrent.Executors
import java.util.concurrent.Future
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareRelayTest {
    private var now = 1_000_000_000_000L
    private class Stored(val root: HttpUrl, val cookies: List<Pair<String, String>>, val ua: String, val until: Long)
    private val stored = ArrayList<Stored>()
    private var storeFails = false
    private val relay = CloudflareRelay(
        { root, cookies, ua, until ->
            if (storeFails) throw IllegalStateException("keystore")
            stored.add(Stored(root, cookies, ua, until))
        },
        clock = { now },
        pickupMs = 1_500,
        answerMs = 1_500,
    )
    private val pool = Executors.newCachedThreadPool()
    private val root = "https://rustorka.example/".toHttpUrl()
    private val ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36"

    private fun ask(): Future<CloudflareRelay.Outcome> = pool.submit<CloudflareRelay.Outcome> { relay.ask("rustorka", root) }

    private fun pollUntilRequest(token: String): JSONObject {
        repeat(200) {
            val r = relay.poll(token, "Pixel 8")
            if (!r.isNull("request")) return r.getJSONObject("request")
            Thread.sleep(5)
        }
        throw AssertionError("no request")
    }

    private fun solved(id: String, host: String = "rustorka.example", cookies: String = """[{"name":"cf_clearance","value":"abc"},{"name":"__cf_bm","value":"x"}]""", until: Long = now + 600_000) =
        JSONObject("""{"id":"$id","result":"solved","host":"$host","cookies":$cookies,"ua":"$ua","until":$until}""")

    @Test
    fun noPhoneUntilOnePolled() {
        assertNull(relay.phone())
        assertEquals(CloudflareRelay.Outcome.NO_PHONE, relay.ask("rustorka", root))
        relay.poll("t1", "Pixel 8")
        assertEquals("Pixel 8", relay.phone())
        now += CloudflareRelay.LIVE_MS + 1
        assertNull(relay.phone())
    }

    @Test
    fun thePhoneThatTookItAnswersAndTheTvStoresCookiesAndUserAgent() {
        relay.poll("t1", "Pixel 8")
        relay.poll("t2", "Galaxy")
        val f = ask()
        val req = pollUntilRequest("t1")
        assertEquals("rustorka", req.getString("site"))
        assertEquals("https://rustorka.example/", req.getString("url"))
        assertEquals(setOf("id", "site", "url"), req.keys().asSequence().toSet())
        // another phone does not get it, and cannot answer it
        assertTrue(relay.poll("t2", "Galaxy").isNull("request"))
        assertEquals(CloudflareRelay.Reply.UNKNOWN, relay.answer("t2", solved(req.getString("id"))))
        assertEquals(CloudflareRelay.Reply.OK, relay.answer("t1", solved(req.getString("id"))))
        assertEquals(CloudflareRelay.Outcome.SOLVED, f.get())
        val s = stored.single()
        assertEquals(root, s.root)
        assertEquals(listOf("cf_clearance" to "abc", "__cf_bm" to "x"), s.cookies)
        assertEquals(ua, s.ua)
        assertEquals(now + 600_000, s.until)
        // done: not handed out again, a second answer is unknown
        assertTrue(relay.poll("t1", "Pixel 8").isNull("request"))
        assertEquals(CloudflareRelay.Reply.UNKNOWN, relay.answer("t1", solved(req.getString("id"))))
    }

    @Test
    fun rejectsAnswersOutsideTheSchema() {
        relay.poll("t1", "Pixel 8")
        val f = ask()
        val id = pollUntilRequest("t1").getString("id")
        val bad = listOf(
            solved(id, host = "other.example"),
            solved(id, host = "Rustorka.example"),
            solved(id, cookies = "[]"),
            solved(id, cookies = """[{"name":"__cf_bm","value":"x"}]"""),
            solved(id, cookies = """[{"name":"cf_clearance","value":"a"},{"name":"cf_clearance","value":"b"}]"""),
            solved(id, cookies = """[{"name":"cf_clearance","value":"a;b"}]"""),
            solved(id, cookies = """[{"name":"cf_clearance","value":"a","domain":"evil.example"}]"""),
            solved(id, cookies = JSONArray((0..40).map { JSONObject().put("name", if (it == 0) "cf_clearance" else "c$it").put("value", "v") }).toString()),
            solved(id).put("extra", 1),
            solved(id).put("ua", ""),
            solved(id).put("ua", "x".repeat(513)),
            solved(id).put("ua", "bad\nua"),
            JSONObject().put("id", id).put("result", "maybe"),
            JSONObject().put("id", id).put("result", "cancelled").put("host", "rustorka.example"),
        )
        for (b in bad) assertEquals(b.toString(), CloudflareRelay.Reply.BAD_REQUEST, relay.answer("t1", b))
        assertTrue(stored.isEmpty())
        assertEquals(CloudflareRelay.Reply.OK, relay.answer("t1", JSONObject().put("id", id).put("result", "cancelled")))
        assertEquals(CloudflareRelay.Outcome.CANCELLED, f.get())
    }

    @Test
    fun anotherClockGetsTheDefaultLifetime() {
        relay.poll("t1", "Pixel 8")
        val f = ask()
        val id = pollUntilRequest("t1").getString("id")
        assertEquals(CloudflareRelay.Reply.OK, relay.answer("t1", solved(id, until = now - 3_600_000)))
        assertEquals(CloudflareRelay.Outcome.SOLVED, f.get())
        assertEquals(now + CloudflareRelay.DEFAULT_TTL_MS, stored.single().until)
    }

    @Test
    fun timeoutsCancelFailureAndStorage() {
        relay.poll("t1", "Pixel 8")
        // nobody picks it up
        assertEquals(CloudflareRelay.Outcome.NOT_TAKEN, relay.ask("rustorka", root))
        // picked up, never answered
        val slow = ask()
        pollUntilRequest("t1")
        assertEquals(CloudflareRelay.Outcome.TIMEOUT, slow.get())
        // the TV closed its dialog
        val c = ask()
        val id = pollUntilRequest("t1").getString("id")
        relay.cancel()
        assertEquals(CloudflareRelay.Outcome.CANCELLED, c.get())
        assertEquals(CloudflareRelay.Reply.UNKNOWN, relay.answer("t1", solved(id)))
        // the phone could not pass it
        val failed = ask()
        val id2 = pollUntilRequest("t1").getString("id")
        assertEquals(CloudflareRelay.Reply.OK, relay.answer("t1", JSONObject().put("id", id2).put("result", "failed")))
        assertEquals(CloudflareRelay.Outcome.FAILED, failed.get())
        // the encrypted storage refused the cookies
        storeFails = true
        val s = ask()
        val id3 = pollUntilRequest("t1").getString("id")
        assertEquals(CloudflareRelay.Reply.STORE_FAILED, relay.answer("t1", solved(id3)))
        assertEquals(CloudflareRelay.Outcome.STORE_FAILED, s.get())
    }

    @Test
    fun oneRequestAtATime() {
        relay.poll("t1", "Pixel 8")
        val f = ask()
        pollUntilRequest("t1")
        assertEquals(CloudflareRelay.Outcome.BUSY, relay.ask("other", "https://other.example/".toHttpUrl()))
        relay.cancel()
        assertEquals(CloudflareRelay.Outcome.CANCELLED, f.get())
    }

    @Test
    fun theSolvedBodyFitsAndKeepsCloudflareCookies() {
        val big = listOf("cf_clearance" to "c".repeat(4000), "__cf_bm" to "b".repeat(4000)) + (1..10).map { "site$it" to "s".repeat(4000) }
        val body = CloudflareProtocol.solvedJson("c1", "rustorka.example", big, ua, now)!!
        assertTrue(body.toByteArray().size <= CloudflareProtocol.MAX_BODY)
        val parsed = CloudflareProtocol.parseAnswer(JSONObject(body)) as CloudflareProtocol.Answer.Solved
        assertEquals(listOf("cf_clearance", "__cf_bm"), parsed.cookies.map { it.first }.take(2))
        assertFalse(parsed.toString().contains("ccc"))
        assertNull(CloudflareProtocol.solvedJson("c1", "rustorka.example", listOf("__cf_bm" to "b"), ua, now))
        assertNotNull(CloudflareProtocol.parseAnswer(JSONObject(CloudflareProtocol.endedJson("c1", cancelled = true))))
    }

    @Test
    fun parsesOnlyWellFormedRequests() {
        val ok = CloudflareProtocol.parseRequest(JSONObject("""{"request":{"id":"c12","site":"rustorka","url":"https://rustorka.example/"}}"""))
        assertEquals("c12", ok!!.id)
        for (bad in listOf(
            """{"request":{"id":"c 12","site":"x","url":"https://h/"}}""",
            """{"request":{"id":"c1","site":"","url":"https://h/"}}""",
            """{"request":{"id":"c1","site":"x","url":"https://h/search?q=1"}}""",
            """{"request":{"id":"c1","site":"x","url":"ftp://h/"}}""",
            """{"request":null}""",
        )) assertNull(bad, CloudflareProtocol.parseRequest(JSONObject(bad)))
    }
}
