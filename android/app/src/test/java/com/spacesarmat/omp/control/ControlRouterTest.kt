package com.spacesarmat.omp.control

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        override fun sources(t: SourcesTransfer): SourcesOutcome {
            calls.add("sources:${t.sources.toSortedMap()}:${t.login?.username}:${t.phone}")
            lastTransfer = t
            return outcome
        }
    }
    private var outcome: SourcesOutcome = SourcesOutcome.Applied("ok")
    private var lastTransfer: SourcesTransfer? = null
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
        for (path in listOf("/omp/launch", "/omp/attach", "/omp/key", "/omp/text", "/omp/volume", "/omp/sources")) {
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

    private val password = "pa55-secret-word"

    private fun sourcesBody(extra: String = "") = """{"v":1,"sources":{"rutor":true,"ts-torznab":false}$extra}"""

    private fun loginPart(user: String = "andy", pass: String = password) =
        ""","rutracker":{"username":"$user","password":"$pass"}"""

    @Test
    fun sourcesNeedTheTokenAndJson() {
        val body = sourcesBody(loginPart())
        assertEquals(401, req("POST", "/omp/sources", body).status)
        assertEquals(401, req("POST", "/omp/sources", body, "0".repeat(32)).status)
        val t = token()
        assertEquals(405, req("GET", "/omp/sources", "", t).status)
        assertEquals(415, req("POST", "/omp/sources", body, t, contentType = "text/plain").status)
        assertEquals(listOf("paired:Pixel"), calls)
    }

    @Test
    fun sourcesAreAppliedAndTheAnswerHasNoSecrets() {
        val t = token()
        val r = req("POST", "/omp/sources", sourcesBody(loginPart(" andy ")), t)
        assertEquals(200, r.status)
        val o = JSONObject(r.json)
        assertEquals(true, o.getBoolean("ok"))
        assertEquals("ok", o.getString("rutracker"))
        assertFalse(r.json.contains(password))
        assertFalse(r.json.contains("andy"))
        assertEquals("sources:{rutor=true, ts-torznab=false}:andy:Pixel", calls.last())
        val got = lastTransfer!!
        assertEquals(password, got.login!!.password)
        assertFalse(got.toString().contains(password))
        assertFalse(got.login.toString().contains(password))

        // no login: no rutracker key in the answer
        val plain = req("POST", "/omp/sources", sourcesBody(""","rutracker":null"""), t)
        assertEquals(200, plain.status)
        assertFalse(JSONObject(plain.json).has("rutracker"))
        assertNull(lastTransfer!!.login)

        outcome = SourcesOutcome.Applied("bad_login")
        val bad = req("POST", "/omp/sources", sourcesBody(loginPart()), t)
        assertEquals("bad_login", JSONObject(bad.json).getString("rutracker"))
    }

    @Test
    fun sourcesOutcomesMapToStatuses() {
        val t = token()
        val body = sourcesBody(loginPart())
        outcome = SourcesOutcome.Busy
        assertEquals(409, req("POST", "/omp/sources", body, t).status)
        outcome = SourcesOutcome.NoAnswer
        val r = req("POST", "/omp/sources", body, t)
        assertEquals(503, r.status)
        assertEquals("no_answer", JSONObject(r.json).getString("error"))
        outcome = SourcesOutcome.StoreFailed
        val s = req("POST", "/omp/sources", body, t)
        assertEquals(500, s.status)
        assertFalse(s.json.contains(password))
        outcome = SourcesOutcome.Failed
        assertEquals(500, req("POST", "/omp/sources", body, t).status)
    }

    @Test
    fun sourcesSchemaAndSizeAreChecked() {
        val t = token()
        val many = (1..41).joinToString(",") { "\"s$it\":true" }
        val bad = listOf(
            "not json",
            "{}",
            """{"v":2,"sources":{"rutor":true}}""",
            """{"v":1,"sources":{}}""",
            """{"v":1,"sources":[true]}""",
            """{"v":1,"sources":{"rutor":"yes"}}""",
            """{"v":1,"sources":{"Rutor":true}}""",
            """{"v":1,"sources":{"../x":true}}""",
            """{"v":1,"sources":{$many}}""",
            sourcesBody(""","extra":1"""),
            sourcesBody(""","rutracker":"andy""""),
            sourcesBody(loginPart(user = "")),
            sourcesBody(loginPart(user = "   ")),
            sourcesBody(loginPart(pass = "")),
            sourcesBody(loginPart(user = "a".repeat(101))),
            sourcesBody(loginPart(pass = "p".repeat(201))),
            sourcesBody(loginPart(user = "a\\u0007b")),
        )
        for (b in bad) {
            val r = req("POST", "/omp/sources", b, t)
            assertEquals(b, 400, r.status)
            assertFalse(r.json.contains(password))
        }
        val big = sourcesBody(""","pad":"${"x".repeat(SourcesProtocol.MAX_BODY)}"""")
        assertEquals(413, req("POST", "/omp/sources", big, t).status)
        assertEquals(listOf("paired:Pixel"), calls)
    }

    // test-only key
    private val apiKey = "test0only0key0000000000000000abc"

    private fun indexersPart(vararg items: String) = ""","indexers":[${items.joinToString(",")}]"""

    @Test
    fun indexerConnectionsTravelWithKeysAndTheAnswerHasOnlyTheCount() {
        val t = token()
        outcome = SourcesOutcome.Applied(null, 2)
        val body = sourcesBody(
            indexersPart(
                """{"kind":"jackett","url":"http://192.168.1.5:9117","key":"$apiKey"}""",
                """{"kind":"prowlarr","url":"https://nas.local/prowlarr","name":"Дом"}""",
            ),
        )
        val r = req("POST", "/omp/sources", body, t)
        assertEquals(200, r.status)
        val o = JSONObject(r.json)
        assertEquals(2, o.getInt("indexers"))
        assertFalse(o.has("rutracker"))
        assertFalse(r.json.contains(apiKey))
        assertFalse(r.json.contains("192.168.1.5"))
        val got = lastTransfer!!
        assertEquals(2, got.indexers.size)
        assertEquals(apiKey, got.indexers[0].key)
        assertNull(got.indexers[1].key)
        assertEquals("Дом", got.indexers[1].name)
        assertFalse(got.toString().contains(apiKey))
        assertFalse(got.indexers[0].toString().contains(apiKey))
        // no connections: no count in the answer
        outcome = SourcesOutcome.Applied(null)
        assertFalse(JSONObject(req("POST", "/omp/sources", sourcesBody(), t).json).has("indexers"))
    }

    @Test
    fun indexerSchemaIsChecked() {
        val t = token()
        val ok = """{"kind":"jackett","url":"http://192.168.1.5:9117"}"""
        val many = (1..21).joinToString(",") { """{"kind":"jackett","url":"http://192.168.1.$it:9117"}""" }
        val bad = listOf(
            ""","indexers":[]""",
            ""","indexers":{}""",
            ""","indexers":[$many]""",
            indexersPart(ok, ok),
            indexersPart("""{"kind":"sonarr","url":"http://h:1"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h:9117/"}"""),
            indexersPart("""{"kind":"jackett","url":"http://Host:9117"}"""),
            indexersPart("""{"kind":"jackett","url":"ftp://h"}"""),
            indexersPart("""{"kind":"jackett","url":"http://u@h"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h/${"x".repeat(200)}"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","key":"has space"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","key":""}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","key":"${"k".repeat(201)}"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","key":1}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","apiKey":"$apiKey"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","name":"${"n".repeat(41)}"}"""),
            indexersPart("""{"kind":"jackett","url":"http://h","name":"a\u0007b"}"""),
        )
        for (b in bad) {
            val r = req("POST", "/omp/sources", sourcesBody(b), t)
            assertEquals(b, 400, r.status)
            assertFalse(r.json.contains(apiKey))
        }
        assertEquals(listOf("paired:Pixel"), calls)
        assertEquals(200, req("POST", "/omp/sources", sourcesBody(indexersPart(ok)), t).status)
    }

    @Test
    fun theLargestValidBodyFitsTheLimit() {
        val t = token()
        val items = (1..20).map { """{"kind":"jackett","url":"http://192.168.1.$it:9117/${"p".repeat(170)}","key":"${"k".repeat(200)}","name":"${"н".repeat(40)}"}""" }
        val sources = (1..40).joinToString(",") { """"indexer-prowlarr-${it.toString().padStart(23, '0')}":true""" }
        val body = """{"v":1,"sources":{$sources},"rutracker":{"username":"${"u".repeat(100)}","password":"${"п".repeat(200)}"}${indexersPart(*items.toTypedArray())}}"""
        assertTrue(body.toByteArray(Charsets.UTF_8).size <= SourcesProtocol.MAX_BODY)
        assertEquals(200, req("POST", "/omp/sources", body, t).status)
    }
}
