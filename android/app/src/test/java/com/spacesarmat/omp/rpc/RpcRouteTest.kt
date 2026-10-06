package com.spacesarmat.omp.rpc

import com.spacesarmat.omp.control.ControlHead
import com.spacesarmat.omp.control.ControlResponse
import com.spacesarmat.omp.control.ControlServer
import java.net.InetAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The RPC route over a real socket (the test client is 127.0.0.1, so the LAN check is injected). */
class RpcRouteTest {
    private val token = "0123456789abcdef0123456789abcdef"
    private val goodPath = "/omp/$token/rpc"
    private val body = """{"method":"sources","params":{}}"""
    @Volatile
    private var handled = 0
    @Volatile
    private var reply: (JSONObject) -> Unit = {}
    private lateinit var dispatcher: RpcDispatcher
    private var server: ControlServer? = null

    private fun start(
        allowed: (InetAddress?) -> Boolean = { true },
        page: Boolean = true,
        arrivedOnLan: (InetAddress?) -> Boolean = { true },
    ): ControlServer {
        dispatcher = RpcDispatcher({ msg ->
            if (page) {
                val o = JSONObject(msg)
                reply(o)
                if (o.getString("method") == "sources") dispatcher.onReply(o.getInt("rpc"), true, JSONObject().put("n", 2), null, null)
            }
            page
        }, waitMs = 300)
        val route = RpcRoute({ token }, { dispatcher }, arrivedOnLan, allowed)
        val s = ControlServer(0, route::precheck, cors = route::cors, workers = RpcDispatcher.MAX_WAITING) { handled++; route.route(it) }
        s.start()
        server = s
        return s
    }

    @After
    fun tearDown() {
        server?.stop()
    }

    private fun post(path: String, json: String, extra: List<String> = emptyList()): String {
        val s = server ?: start()
        val bytes = json.toByteArray(Charsets.UTF_8)
        Socket("127.0.0.1", s.localPort).use { sock ->
            sock.soTimeout = 3_000
            val head = (listOf("POST $path HTTP/1.1", "Content-Type: text/plain", "Content-Length: ${bytes.size}") + extra)
                .joinToString("\r\n") + "\r\n\r\n"
            sock.getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1) + bytes)
            sock.getOutputStream().flush()
            return sock.getInputStream().readBytes().toString(Charsets.UTF_8)
        }
    }

    /** Sends only the headers (the announced body never comes) and reads the status line. */
    private fun headersOnly(path: String, length: Int, method: String = "POST"): String {
        val s = server ?: start()
        Socket("127.0.0.1", s.localPort).use { sock ->
            sock.soTimeout = 3_000
            sock.getOutputStream().write("$method $path HTTP/1.1\r\nContent-Length: $length\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            sock.getOutputStream().flush()
            return sock.getInputStream().bufferedReader(Charsets.ISO_8859_1).readLine()
        }
    }

    private fun json(response: String) = JSONObject(response.substringAfter("\r\n\r\n"))
    private fun errorCode(response: String) = json(response).getJSONObject("error").getString("code")

    @Test
    fun wrongTokenIs404() {
        val r = post("/omp/" + "0".repeat(32) + "/rpc", body)
        assertTrue(r, r.startsWith("HTTP/1.1 404"))
        assertEquals("{}", r.substringAfter("\r\n\r\n"))
        assertTrue(post("/omp/$token", body).startsWith("HTTP/1.1 404"))
        assertTrue(post("/omp/$token/rpc/", body).startsWith("HTTP/1.1 404"))
        assertEquals(0, handled)
    }

    @Test
    fun loopbackIsRefused() {
        start(allowed = LanAddress::allowed)
        assertTrue(post(goodPath, body).startsWith("HTTP/1.1 404"))
        assertEquals(0, handled)
    }

    @Test
    fun connectionNotOnTheLanInterfaceIsRefused() {
        var seen: InetAddress? = null
        start(arrivedOnLan = { seen = it; false })
        val r = post(goodPath, body)
        assertTrue(r, r.startsWith("HTTP/1.1 404"))
        assertEquals("{}", r.substringAfter("\r\n\r\n"))
        assertEquals(0, handled)
        // the server hands the route the phone's own address the connection arrived on
        assertEquals(InetAddress.getByName("127.0.0.1"), seen)
    }

    @Test
    fun cgnatPeerOnMobileDataIsRefused() {
        // 10/8 passes the client check, but the connection arrived on the mobile interface (rmnet), not on Wi-Fi
        val wifi = listOf(InetAddress.getByName("192.168.1.20"))
        val route = RpcRoute({ token }, { null }, { LanAddress.arrivedOn(it, wifi) })
        val path = goodPath
        val mobile = ControlHead("POST", path, null, "text/plain", 10, InetAddress.getByName("10.64.3.9"), InetAddress.getByName("10.200.0.5"))
        assertEquals(404, route.precheck(mobile)!!.status)
        val lan = ControlHead("POST", path, null, "text/plain", 10, InetAddress.getByName("10.64.3.9"), InetAddress.getByName("192.168.1.20"))
        assertNull(route.precheck(lan))
        val noLocal = ControlHead("POST", path, null, "text/plain", 10, InetAddress.getByName("192.168.1.7"), null)
        assertEquals(404, route.precheck(noLocal)!!.status)
    }

    @Test
    fun eightCallsWaitAtOnce() {
        val inside = CountDownLatch(RpcDispatcher.MAX_WAITING)
        val release = CountDownLatch(1)
        val s = ControlServer(0, workers = RpcDispatcher.MAX_WAITING) {
            inside.countDown()
            release.await(5, TimeUnit.SECONDS)
            ControlResponse(200, "{}")
        }
        s.start()
        val clients = (1..RpcDispatcher.MAX_WAITING).map {
            Thread {
                try {
                    Socket("127.0.0.1", s.localPort).use { sock ->
                        sock.soTimeout = 6_000
                        sock.getOutputStream().write("POST /x HTTP/1.1\r\nContent-Length: 0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                        sock.getInputStream().readBytes()
                    }
                } catch (_: Exception) {
                }
            }.apply { start() }
        }
        try {
            assertTrue("all calls run at once", inside.await(3, TimeUnit.SECONDS))
        } finally {
            release.countDown()
            clients.forEach { it.join(6_000) }
            s.stop()
        }
    }

    @Test
    fun unknownMethod() {
        assertEquals("unknown_method", errorCode(post(goodPath, """{"method":"rm","params":{}}""")))
    }

    @Test
    fun monitorMethodsAreAllowed() {
        listOf("feed", "subs", "subCheck", "subSet", "subRemove", "wantAdd", "findingLink", "findingsSeen").forEach {
            assertTrue(it, it in RpcRoute.METHODS)
        }
        assertFalse("subsDelete" in RpcRoute.METHODS)
        assertEquals("unknown_method", errorCode(post(goodPath, """{"method":"subsDelete","params":{}}""")))
    }

    @Test
    fun malformedBodyIsBadRequest() {
        val r = post(goodPath, "not json")
        assertTrue(r.startsWith("HTTP/1.1 200"))
        assertEquals("bad_request", errorCode(r))
        assertEquals("bad_request", errorCode(post(goodPath, """{"method":"sources","params":[]}""")))
        assertEquals("bad_request", errorCode(post(goodPath, """{"method":5}""")))
    }

    @Test
    fun okIsWrappedWithCors() {
        val r = post(goodPath, body)
        assertTrue(r, r.startsWith("HTTP/1.1 200"))
        assertTrue(r.contains("Access-Control-Allow-Origin: *"))
        assertTrue(r.contains("\"ok\":true"))
        assertEquals(2, json(r).getJSONObject("result").getInt("n"))
    }

    @Test
    fun nullOriginGetsCorsToo() {
        assertTrue(post(goodPath, body, listOf("Origin: null")).contains("Access-Control-Allow-Origin: *"))
    }

    @Test
    fun silentPageIsTimeoutAndNoPageIsNotReady() {
        val r = post(goodPath, """{"method":"search","params":{"query":"x"}}""")
        assertTrue(r.startsWith("HTTP/1.1 200"))
        assertFalse(json(r).getBoolean("ok"))
        assertEquals("timeout", errorCode(r))
        server?.stop()
        server = null
        start(page = false)
        assertEquals("not_ready", errorCode(post(goodPath, body)))
    }

    @Test
    fun paramsReachThePage() {
        var seen: JSONObject? = null
        reply = { seen = it }
        post(goodPath, """{"method":"search","params":{"query":"дюна"}}""")
        assertEquals("дюна", seen!!.getJSONObject("params").getString("query"))
    }

    @Test
    fun getIs405() {
        assertTrue(headersOnly(goodPath, 0, method = "GET").startsWith("HTTP/1.1 405"))
    }

    @Test
    fun bigBodyIs413() {
        assertTrue(headersOnly(goodPath, length = 70_000).startsWith("HTTP/1.1 413"))
        assertEquals(0, handled)
    }

    @Test
    fun hugeAnswerBecomesFailed() {
        val big = "x".repeat(RpcRoute.MAX_RESPONSE + 10)
        reply = { o -> dispatcher.onReply(o.getInt("rpc"), true, big, null, null) }
        assertEquals("failed", errorCode(post(goodPath, """{"method":"resolve","params":{}}""")))
    }

    @Test
    fun defaultControlServerCorsIsUnchanged() {
        val s = ControlServer(0, { null }) { ControlResponse(200, "{}") }
        s.start()
        try {
            fun ask(origin: String): String = Socket("127.0.0.1", s.localPort).use { sock ->
                sock.soTimeout = 3_000
                sock.getOutputStream().write("POST /x HTTP/1.1\r\nOrigin: $origin\r\nContent-Length: 0\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                sock.getInputStream().readBytes().toString(Charsets.ISO_8859_1)
            }
            assertTrue(ask("http://localhost").contains("Access-Control-Allow-Origin: http://localhost"))
            assertFalse(ask("http://evil.example").contains("Access-Control-Allow-Origin"))
        } finally {
            s.stop()
        }
    }
}
