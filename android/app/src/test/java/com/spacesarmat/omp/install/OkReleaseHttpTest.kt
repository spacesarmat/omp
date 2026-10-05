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

    private val file = ByteArray(200_000) { (it % 241).toByte() }

    @Test
    fun rangeRequestsResumeAfterTheRedirect() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/asset"))
        server.enqueue(
            MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 150000-199999/200000")
                .setBody(okio.Buffer().write(file.copyOfRange(150_000, 200_000))),
        )
        var got: Triple<Int, Long, Long>? = null
        http.streamFrom(server.url("/dl").toString(), 150_000L, CancelToken()) { input, length, start ->
            got = Triple(input.readBytes().size, length, start)
        }
        assertEquals(Triple(50_000, 50_000L, 150_000L), got)
        assertEquals("bytes=150000-", server.takeRequest().getHeader("Range"))
        assertEquals("bytes=150000-", server.takeRequest().getHeader("Range"))
    }

    @Test
    fun aServerIgnoringTheRangeSendsTheWholeFileFromZero() {
        server.enqueue(MockResponse().setBody(okio.Buffer().write(file)))
        var start = -1L
        http.streamFrom(server.url("/dl").toString(), 1000L, CancelToken()) { input, _, s ->
            input.readBytes()
            start = s
        }
        assertEquals(0L, start)
    }

    @Test
    fun aWrongContentRangeIsRefusedAnd416StartsOver() {
        server.enqueue(MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 0-9/200000").setBody("0123456789"))
        assertEquals(InstallCodes.NETWORK, code { http.streamFrom(server.url("/dl").toString(), 500L, CancelToken()) { _, _, _ -> } })
        server.enqueue(MockResponse().setResponseCode(416))
        server.enqueue(MockResponse().setBody(okio.Buffer().write(file)))
        var start = -1L
        http.streamFrom(server.url("/dl").toString(), 999_999L, CancelToken()) { input, _, s ->
            input.readBytes()
            start = s
        }
        assertEquals(0L, start)
        server.takeRequest()
        assertEquals("bytes=999999-", server.takeRequest().getHeader("Range"))
        assertEquals(null, server.takeRequest().getHeader("Range"))
        assertEquals(-1L, OkReleaseHttp.rangeStart("bytes */200"))
        assertEquals(7L, OkReleaseHttp.rangeStart("bytes 7-9/*"))
    }

    @Test
    fun theDownloaderResumesABrokenTransferOverHttpAndChecksTheWholeFile() {
        val dir = tempDir()
        val pkg = ReleasePackage(Item.TORRSERVER, "ts", "1", server.url("/dl").toString(), sha256(file), file.size.toLong())
        // the first response dies midway through the body
        server.enqueue(
            MockResponse().setBody(okio.Buffer().write(file))
                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY),
        )
        val dl = ReleaseDownloader(http, dir, resume = true)
        assertEquals(InstallCodes.NETWORK, code { dl.fetch(pkg, file.size.toLong(), CancelToken(), {}) })
        val kept = java.io.File(dir, "ts.part").length()
        assertEquals(true, kept in 1 until file.size)
        server.enqueue(
            MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes $kept-${file.size - 1}/${file.size}")
                .setBody(okio.Buffer().write(file.copyOfRange(kept.toInt(), file.size))),
        )
        val out = dl.fetch(pkg, file.size.toLong(), CancelToken(), {})
        assertEquals(sha256(file), sha256(out.readBytes()))
        server.takeRequest()
        assertEquals("bytes=$kept-", server.takeRequest().getHeader("Range"))
        // without resume a failure leaves nothing behind
        server.enqueue(
            MockResponse().setBody(okio.Buffer().write(file))
                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY),
        )
        val plain = ReleaseDownloader(http, tempDir())
        assertEquals(InstallCodes.NETWORK, code { plain.fetch(pkg.copy(fileName = "p"), file.size.toLong(), CancelToken(), {}) })
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
