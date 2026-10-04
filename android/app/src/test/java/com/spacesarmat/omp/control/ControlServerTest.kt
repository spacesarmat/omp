package com.spacesarmat.omp.control

import java.net.Socket
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The header stage of /omp/sources over a real socket: no body is read before auth and size are checked. */
class ControlServerTest {
    private val pairing = Pairing(object : PhoneStore {
        var saved: List<PairedPhone> = emptyList()
        override fun load() = saved
        override fun save(phones: List<PairedPhone>) {
            saved = phones
        }
    })
    @Volatile
    private var handled = 0
    private val actions = object : RemoteActions {
        override fun info(): JSONObject = JSONObject().put("name", "ТВ").put("version", "0").put("foreground", true)
        override fun paired(phone: String) {}
        override fun launch(params: JSONObject) {}
        override fun attach(report: String) {}
        override fun key(name: String) {}
        override fun text(data: JSONObject) {}
        override fun volume(up: Boolean) {}
        override fun sources(t: SourcesTransfer): SourcesOutcome = SourcesOutcome.Applied(null)
        override fun cloudflarePoll(token: String, phone: String, waitMs: Long): JSONObject = CloudflareProtocol.requestJson(null)
        override fun cloudflareAnswer(token: String, body: JSONObject): CloudflareRelay.Reply = CloudflareRelay.Reply.UNKNOWN
    }
    private val router = ControlRouter(pairing, actions)
    private val server = ControlServer(0, router::precheck) {
        handled++
        router.route(it)
    }

    @Before
    fun setUp() {
        server.start()
    }

    @After
    fun tearDown() {
        server.stop()
    }

    private fun token(): String {
        val code = pairing.newCode().code
        return (pairing.pair(code, "Pixel") as Pairing.Result.Paired).token
    }

    /** Sends only the headers (the announced body never comes) and reads the status line; fails after 3 s. */
    private fun headersOnly(lines: List<String>): String {
        Socket("127.0.0.1", server.localPort).use { s ->
            s.soTimeout = 3_000
            s.getOutputStream().write((lines.joinToString("\r\n") + "\r\n\r\n").toByteArray(Charsets.ISO_8859_1))
            s.getOutputStream().flush()
            return s.getInputStream().bufferedReader(Charsets.ISO_8859_1).readLine()
        }
    }

    @Test
    fun unauthenticatedBodyIsNeverRead() {
        val started = System.nanoTime()
        val status = headersOnly(listOf("POST /omp/sources HTTP/1.1", "Content-Type: application/json", "Content-Length: 60000"))
        assertEquals("HTTP/1.1 401 Unauthorized", status)
        // answered at once, not after the 5 s read timeout of a body that never comes
        assertTrue((System.nanoTime() - started) / 1_000_000 < 2_500)
        assertEquals(0, handled)
    }

    @Test
    fun oversizedBodyOfAPairedPhoneIsRefusedFromItsLength() {
        val t = token()
        val head = listOf("POST /omp/sources HTTP/1.1", "Authorization: Bearer $t", "Content-Type: application/json")
        assertEquals("HTTP/1.1 413 Payload Too Large", headersOnly(head + "Content-Length: ${SourcesProtocol.MAX_BODY + 1}"))
        assertEquals("HTTP/1.1 415 Unsupported Media Type", headersOnly(listOf("POST /omp/sources HTTP/1.1", "Authorization: Bearer $t", "Content-Length: 10")))
        assertEquals("HTTP/1.1 405 Method Not Allowed", headersOnly(listOf("GET /omp/sources HTTP/1.1", "Authorization: Bearer $t", "Content-Length: 0")))
        assertEquals(0, handled)
    }

    @Test
    fun aValidRequestStillReachesTheRouter() {
        val t = token()
        val body = """{"v":1,"sources":{"rutor":true}}""".toByteArray(Charsets.UTF_8)
        Socket("127.0.0.1", server.localPort).use { s ->
            s.soTimeout = 3_000
            val head = "POST /omp/sources HTTP/1.1\r\nAuthorization: Bearer $t\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\n\r\n"
            s.getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1) + body)
            s.getOutputStream().flush()
            assertEquals("HTTP/1.1 200 OK", s.getInputStream().bufferedReader(Charsets.ISO_8859_1).readLine())
        }
        assertEquals(1, handled)
    }
}
