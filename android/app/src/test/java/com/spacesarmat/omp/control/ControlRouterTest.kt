package com.spacesarmat.omp.control

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ControlRouterTest {
    private val store = object : PhoneStore {
        var saved: List<PairedPhone> = emptyList()
        override fun load() = saved
        override fun save(phones: List<PairedPhone>) {
            saved = phones
        }
    }
    private val pairing = Pairing(store)
    private val calls = ArrayList<String>()
    private val actions = object : RemoteActions {
        override fun info(): JSONObject = JSONObject().put("name", "Гостиная").put("version", "0.10.0").put("foreground", true)
        override fun paired(phone: String) {
            calls.add("paired:$phone")
        }
        override fun launch(params: JSONObject) {
            calls.add("launch:$params")
        }
        override fun attach(report: String) {
            calls.add("attach:$report")
        }
        override fun key(name: String) {
            calls.add("key:$name")
        }
        override fun text(data: JSONObject) {
            calls.add("text:$data")
        }
        override fun volume(up: Boolean) {
            calls.add("volume:$up")
        }
    }
    private val router = ControlRouter(pairing, actions)

    private fun req(
        method: String,
        path: String,
        body: String = "",
        token: String? = null,
        contentType: String? = "application/json",
    ) = router.route(ControlRequest(method, path, token, body, contentType))

    private fun token(): String {
        val code = pairing.newCode().code
        val r = req("POST", "/omp/pair", "{\"code\":\"$code\",\"phone\":\"Pixel\"}")
        assertEquals(200, r.status)
        return JSONObject(r.json).getString("token")
    }

    @Test
    fun protectedRoutesNeedTheTokenBeforeMethodAndBody() {
        for (path in listOf("/omp/launch", "/omp/attach", "/omp/key", "/omp/text", "/omp/volume")) {
            assertEquals(path, 401, req("POST", path, "{\"name\":\"UP\"}").status)
            // no method/body detail leaks before auth
            assertEquals(path, 401, req("GET", path).status)
            assertEquals(path, 401, req("POST", path, "not json").status)
            assertEquals(path, 401, req("POST", path, "{}", "f".repeat(32)).status)
        }
        assertTrue(calls.isEmpty())
    }

    @Test
    fun pairedPhoneDrivesTheTv() {
        val t = token()
        assertEquals(listOf("paired:Pixel"), calls)
        assertEquals(200, req("POST", "/omp/key", "{\"name\":\"ENTER\"}", t).status)
        assertEquals(400, req("POST", "/omp/key", "{\"name\":\"POWER\"}", t).status)
        assertEquals(405, req("GET", "/omp/key", "", t).status)
        assertEquals(400, req("POST", "/omp/key", "nope", t).status)
        assertEquals(200, req("POST", "/omp/volume", "{\"dir\":\"down\"}", t).status)
        assertEquals(200, req("POST", "/omp/text", "{\"delete\":2}", t).status)
        assertEquals(400, req("POST", "/omp/text", "{\"delete\":1.5}", t).status)
        assertEquals(200, req("POST", "/omp/attach", "{\"report\":\" http://10.0.0.5:4000/omp/a \"}", t).status)
        assertEquals(400, req("POST", "/omp/attach", "{\"report\":\"https://x/\"}", t).status)
        assertEquals(200, req("POST", "/omp/launch", "{\"params\":{\"torrent\":\"abc\"}}", t).status)
        assertEquals(400, req("POST", "/omp/launch", "{\"params\":\"x\"}", t).status)
        assertEquals(
            listOf("paired:Pixel", "key:ENTER", "volume:false", "text:{\"delete\":2}", "attach:http://10.0.0.5:4000/omp/a", "launch:{\"torrent\":\"abc\"}"),
            calls,
        )
    }

    @Test
    fun infoTellsWhetherTheTokenIsPaired() {
        val t = token()
        val info = JSONObject(req("GET", "/omp/info", "", t).json)
        assertEquals("Гостиная", info.getString("name"))
        assertEquals(true, info.getBoolean("paired"))
        assertEquals(false, JSONObject(req("GET", "/omp/info").json).getBoolean("paired"))
        assertEquals(405, req("POST", "/omp/info").status)
        assertEquals(404, req("GET", "/omp/other").status)
    }

    @Test
    fun numericCodeIsLeftPadded() {
        assertEquals("0123", ControlRouter.codeOf(123))
        assertEquals("0007", ControlRouter.codeOf(7.0))
        assertEquals("4821", ControlRouter.codeOf("4821"))
        assertEquals(null, ControlRouter.codeOf(12.5))
        assertEquals(null, ControlRouter.codeOf(10000))
        assertEquals(null, ControlRouter.codeOf(-1))
        var c = pairing.newCode()
        while (c.code[0] != '0') c = pairing.newCode()
        val r = req("POST", "/omp/pair", "{\"code\":${c.code.toInt()}}")
        assertEquals(200, r.status)
    }

    @Test
    fun pairNeedsJsonContentType() {
        val c = pairing.newCode()
        val body = "{\"code\":\"${c.code}\",\"phone\":\"Pixel\"}"
        for (type in listOf(null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x")) {
            val r = req("POST", "/omp/pair", body, contentType = type)
            assertEquals(415, r.status)
            assertEquals("unsupported_media_type", JSONObject(r.json).getString("error"))
        }
        assertTrue(calls.isEmpty())
        assertEquals(200, req("POST", "/omp/pair", body, contentType = "Application/JSON; charset=utf-8").status)
        assertEquals(listOf("paired:Pixel"), calls)
    }

    @Test
    fun wrongAndClearedCodesAreRefused() {
        val c = pairing.newCode()
        val wrong = if (c.code == "0000") "0001" else "0000"
        val r = req("POST", "/omp/pair", "{\"code\":\"$wrong\"}")
        assertEquals(403, r.status)
        assertEquals("bad_code", JSONObject(r.json).getString("error"))
        pairing.clearCode()
        val e = req("POST", "/omp/pair", "{\"code\":\"${c.code}\"}")
        assertEquals(403, e.status)
        assertEquals("expired", JSONObject(e.json).getString("error"))
        assertEquals(400, req("POST", "/omp/pair", "{bad").status)
    }
}
