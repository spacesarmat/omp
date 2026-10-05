package com.spacesarmat.omp.monitor

import com.spacesarmat.omp.sources.HttpSpec
import com.spacesarmat.omp.sources.SiteHttp
import com.spacesarmat.omp.sources.SiteHttpException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class BridgeProtocolTest {
    private fun msg(op: String, body: JSONObject = JSONObject(), id: Int? = 1): String {
        if (id != null) body.put("id", id)
        return body.put("op", op).toString()
    }

    private fun note() = JSONObject()
        .put("channel", "subs").put("id", "sub:s1").put("subId", "s1").put("key", "h:01")
        .put("title", "Дюна 2160p: 2 новые раздачи").put("text", "Дюна · 41 ГБ").put("action", "add")

    @Test
    fun start() {
        assertEquals(BridgeRequest.Start(7), BridgeProtocol.parse(msg("start", id = 7)))
    }

    @Test
    fun httpRequestsAreValidated() {
        val r = BridgeProtocol.parse(msg("http", JSONObject().put("request", JSONObject()
            .put("url", "https://rutor.info/search/0/0/000/0/x").put("method", "post")
            .put("headers", JSONObject().put("Referer", "https://rutor.info/").put("X-Num", 5))
            .put("form", JSONObject().put("q", "дюна"))
            .put("formCharset", "windows-1251")
            .put("timeoutMs", 999_999))))
        r as BridgeRequest.Http
        assertEquals("POST", r.spec.method)
        assertEquals(mapOf("Referer" to "https://rutor.info/"), r.spec.headers)
        assertEquals(mapOf("q" to "дюна"), r.spec.form)
        assertEquals("windows-1251", r.spec.formCharset)
        assertEquals(60_000L, r.spec.timeoutMs)

        assertEquals(BridgeRequest.Invalid(1, SiteHttp.BAD_URL),
            BridgeProtocol.parse(msg("http", JSONObject().put("request", JSONObject().put("url", "file:///data/x")))))
        assertEquals(BridgeRequest.Invalid(1, SiteHttp.BAD_URL),
            BridgeProtocol.parse(msg("http", JSONObject().put("request", JSONObject().put("url", 5)))))
        assertEquals(BridgeRequest.Invalid(1, SiteHttp.BAD_REQUEST),
            BridgeProtocol.parse(msg("http", JSONObject().put("request", JSONObject().put("url", "https://a.b/").put("method", "PUT")))))
        assertEquals(BridgeRequest.Invalid(1, SiteHttp.BAD_REQUEST), BridgeProtocol.parse(msg("http")))
    }

    @Test
    fun httpDefaults() {
        val spec = HttpSpec.parse(JSONObject().put("url", "http://192.168.1.5:8090/echo"))
        assertEquals("GET", spec.method)
        assertEquals(20_000L, spec.timeoutMs)
        assertNull(spec.form)
        assertNull(spec.body)
        assertNull(spec.responseCharset)
        assertEquals("iso-8859-1", HttpSpec.parse(JSONObject().put("url", "http://a.b/").put("responseCharset", "iso-8859-1")).responseCharset)
        assertEquals(1_000L, HttpSpec.parse(JSONObject().put("url", "http://a.b/").put("timeoutMs", 5)).timeoutMs)
        try {
            HttpSpec.parse(null)
            fail()
        } catch (e: SiteHttpException) {
            assertEquals(SiteHttp.BAD_REQUEST, e.reason)
        }
    }

    @Test
    fun secretKeysAreNamespaced() {
        assertEquals(BridgeRequest.SecretGet(2, "js:rutracker.user"),
            BridgeProtocol.parse(msg("secretGet", JSONObject().put("key", "rutracker.user"), 2)))
        // the cookie entries of the native jar are not reachable
        assertTrue(BridgeProtocol.parse(msg("secretGet", JSONObject().put("key", ""))) is BridgeRequest.Invalid)
        assertTrue(BridgeProtocol.parse(msg("secretGet", JSONObject().put("key", "k".repeat(201)))) is BridgeRequest.Invalid)
        assertTrue(BridgeProtocol.parse(msg("secretGet")) is BridgeRequest.Invalid)
    }

    @Test
    fun notifications() {
        val r = BridgeProtocol.parse(msg("notify", JSONObject().put("notification", note())))
        r as BridgeRequest.Notify
        assertEquals(MonitorIds.CHANNEL_SUBS, r.spec.channel)
        assertEquals(MonitorAction.ADD, r.spec.action)
        assertEquals(MonitorIds.item("sub:s1"), r.spec.notifId)

        val noAction = BridgeProtocol.notify(note().put("action", "delete"))!!
        assertNull(noAction.action)
        assertEquals(200, BridgeProtocol.notify(note().put("title", "x".repeat(400)))!!.title.length)
        assertEquals(500, BridgeProtocol.notify(note().put("text", "x".repeat(900)))!!.text.length)
        assertNull(BridgeProtocol.notify(note().put("channel", "ads")))
        assertNull(BridgeProtocol.notify(note().put("title", "  ")))
        assertNull(BridgeProtocol.notify(note().put("key", "")))
        assertNull(BridgeProtocol.notify(note().put("subId", 3)))
        assertTrue(BridgeProtocol.parse(msg("notify")) is BridgeRequest.Invalid)
    }

    @Test
    fun finish() {
        val r = BridgeProtocol.parse(msg("finish", JSONObject().put("summary", JSONObject().put("at", 1).put("found", 2)), null))
        r as BridgeRequest.Finish
        assertEquals(2, r.summary!!.getInt("found"))
        val big = BridgeProtocol.parse(msg("finish", JSONObject().put("summary", JSONObject().put("error", "x".repeat(5000)))))
        assertNull((big as BridgeRequest.Finish).summary)
        assertNull((BridgeProtocol.parse(msg("finish")) as BridgeRequest.Finish).summary)
    }

    @Test
    fun malformedMessages() {
        assertEquals(BridgeRequest.Invalid(null, BridgeProtocol.BAD_MESSAGE), BridgeProtocol.parse(null))
        assertEquals(BridgeRequest.Invalid(null, BridgeProtocol.BAD_MESSAGE), BridgeProtocol.parse("{"))
        assertEquals(BridgeRequest.Invalid(null, BridgeProtocol.BAD_MESSAGE), BridgeProtocol.parse(msg("start", id = null)))
        assertEquals(BridgeRequest.Invalid(3, BridgeProtocol.BAD_MESSAGE), BridgeProtocol.parse(msg("exec", id = 3)))
        assertEquals(BridgeRequest.Invalid(null, BridgeProtocol.BAD_MESSAGE), BridgeProtocol.parse("x".repeat(1_000_001)))
    }

    @Test
    fun replies() {
        val okReply = JSONObject(BridgeProtocol.ok(4, JSONObject().put("a", 1)))
        assertEquals(4, okReply.getInt("id"))
        assertEquals(true, okReply.getBoolean("ok"))
        assertEquals(1, okReply.getJSONObject("value").getInt("a"))
        val e = JSONObject(BridgeProtocol.error(5, "Сайт не отвечает"))
        assertEquals(false, e.getBoolean("ok"))
        assertEquals("Сайт не отвечает", e.getString("error"))
        assertTrue(JSONObject(BridgeProtocol.ok(6, null)).isNull("value"))
    }
}
