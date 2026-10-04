package com.spacesarmat.omp.sources

import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class FlareSolverrClientTest {
    private lateinit var server: MockWebServer
    private val target = "https://rustorka.example.com/".toHttpUrl()
    private val client = FlareSolverrClient(OkHttpClient.Builder().readTimeout(2, TimeUnit.SECONDS).build(), maxTimeoutMs = 1000)

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private val solution = """{"status":"ok","message":"Challenge solved!","solution":{"url":"https://rustorka.example.com/","status":200,
        "cookies":[{"name":"cf_clearance","value":"cl","domain":".rustorka.example.com","path":"/","expires":4102444800.5,"httpOnly":true,"secure":true},
        {"name":"sess","value":"s1","domain":"rustorka.example.com","path":"/","expires":-1},
        {"name":"evil","value":"x","domain":".other.example.net","path":"/"},
        {"name":"tld","value":"x","domain":".com","path":"/"}],
        "userAgent":"Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36"},"startTimestamp":1,"endTimestamp":2,"version":"3.4.0"}"""

    @Test
    fun postsRequestGetAndParsesTheSolution() {
        server.enqueue(MockResponse().setBody(solution))
        val r = client.solve(server.url("/"), target)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/v1", req.path)
        val body = JSONObject(req.body.readUtf8())
        assertEquals("request.get", body.getString("cmd"))
        assertEquals("https://rustorka.example.com/", body.getString("url"))
        assertEquals(1000, body.getInt("maxTimeout"))
        assertTrue(r is FlareSolverrClient.Result.Solved)
        r as FlareSolverrClient.Result.Solved
        assertEquals("Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36", r.userAgent)
        // cookies of other sites (and of a public suffix) are dropped
        assertEquals(listOf("cf_clearance", "sess"), r.cookies.map { it.name })
        val cl = r.cookies[0]
        assertEquals("rustorka.example.com", cl.domain)
        assertTrue(cl.persistent && cl.secure && cl.httpOnly)
        assertEquals(4102444800500L, cl.expiresAt)
        assertTrue(!r.cookies[1].persistent && r.cookies[1].hostOnly)
    }

    @Test
    fun basePathIsKept() {
        server.enqueue(MockResponse().setBody(solution))
        client.solve(server.url("/flaresolverr/"), target)
        assertEquals("/flaresolverr/v1", server.takeRequest().path)
        assertEquals("http://h:8191/v1", FlareSolverrClient.endpoint("http://h:8191".toHttpUrl()).toString())
    }

    @Test
    fun errorsAreFailures() {
        server.enqueue(MockResponse().setBody("""{"status":"error","message":"Error: Error solving the challenge. Timeout after 60.0 seconds."}"""))
        assertTrue(client.solve(server.url("/"), target) is FlareSolverrClient.Result.Failed)
        server.enqueue(MockResponse().setResponseCode(500).setBody("oops"))
        val bad = client.solve(server.url("/"), target)
        assertTrue(bad is FlareSolverrClient.Result.Failed)
        // never the address in the reason
        assertEquals(FlareSolverrClient.FAILED, (bad as FlareSolverrClient.Result.Failed).reason)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val silent = client.solve(server.url("/"), target)
        assertEquals(FlareSolverrClient.NO_ANSWER, (silent as FlareSolverrClient.Result.Failed).reason)
    }

    @Test
    fun oddUserAgentIsIgnored() {
        val r = FlareSolverrClient.parse("""{"status":"ok","solution":{"cookies":[],"userAgent":"bad\nheader"}}""", target)
        assertNull((r as FlareSolverrClient.Result.Solved).userAgent)
    }
}
