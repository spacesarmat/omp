package com.spacesarmat.omp.install

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** The per-hop allowlist of [OkReleaseHttp] against a local server (the allowlist is swapped for «this server»). */
class OkReleaseHttpTest {
    private lateinit var server: MockWebServer
    private lateinit var http: OkReleaseHttp

    @Before
    fun start() {
        server = MockWebServer()
        server.start()
        val origin = server.url("/").toString()
        http = OkReleaseHttp(allowed = { it.startsWith(origin) })
    }

    @After
    fun stop() {
        server.shutdown()
    }

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: InstallFailure) {
            return e.code
        }
        fail("no failure")
        return ""
    }

    @Test
    fun followsAllowedRedirects() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/next"))
        server.enqueue(MockResponse().setBody("{\"ok\":true}"))
        assertEquals("{\"ok\":true}", http.text(server.url("/feed").toString(), 1000, CancelToken()))
        assertEquals(2, server.requestCount)
    }

    @Test
    fun aRedirectToAForeignHostIsRefused() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://evil.example/omp.apk"))
        assertEquals(InstallCodes.RELEASE, code { http.text(server.url("/feed").toString(), 1000, CancelToken()) })
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aRedirectToPlainHttpOfAnAllowedHostIsRefusedByTheRealRule() {
        // the production rule: https only
        assertEquals(false, ReleaseHosts.allowed("http://github.com/spacesarmat/omp/releases/download/v1/OMP.apk"))
        val real = OkReleaseHttp()
        assertEquals(InstallCodes.RELEASE, code { real.text(server.url("/feed").toString(), 1000, CancelToken()) })
        assertEquals(0, server.requestCount)
    }

    @Test
    fun tooManyRedirectsFail() {
        repeat(10) { server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/loop")) }
        assertEquals(InstallCodes.NETWORK, code { http.text(server.url("/loop").toString(), 1000, CancelToken()) })
        assertEquals(6, server.requestCount)
    }

    @Test
    fun httpErrorsAreNetworkFailures() {
        server.enqueue(MockResponse().setResponseCode(404))
        assertEquals(InstallCodes.NETWORK, code { http.text(server.url("/x").toString(), 1000, CancelToken()) })
    }

    @Test
    fun oversizedTextIsRefused() {
        server.enqueue(MockResponse().setBody("x".repeat(2000)))
        assertEquals(InstallCodes.RELEASE, code { http.text(server.url("/x").toString(), 1000, CancelToken()) })
    }

    @Test
    fun cancelDuringTheBody() {
        server.enqueue(MockResponse().setBody(okio.Buffer().write(ByteArray(512 * 1024))).throttleBody(16 * 1024, 50, java.util.concurrent.TimeUnit.MILLISECONDS))
        val cancel = CancelToken()
        assertEquals(
            InstallCodes.CANCELLED,
            code {
                http.stream(server.url("/big").toString(), cancel) { input, _ ->
                    val buf = ByteArray(8192)
                    input.read(buf)
                    cancel.cancel()
                    while (input.read(buf) >= 0) Unit
                }
            },
        )
    }
}
