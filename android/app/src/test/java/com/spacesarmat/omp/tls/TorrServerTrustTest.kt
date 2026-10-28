package com.spacesarmat.omp.tls

import com.spacesarmat.omp.CertPins
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/** TOFU for a self-signed TorrServer: nothing is trusted without the user's pin, a pin is exactly one host:port. */
class TorrServerTrustTest {
    private val servers = ArrayList<MockWebServer>()
    private lateinit var leaf: X509Certificate
    private lateinit var ctx: SSLContext

    @Before
    fun setUp() {
        TorrServerTrust.reset()
        val ks = KeyStore.getInstance("PKCS12")
        javaClass.classLoader!!.getResourceAsStream("untrusted-site.p12")!!.use { ks.load(it, PASS) }
        leaf = ks.getCertificate(ks.aliases().nextElement()) as X509Certificate
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PASS) }
        ctx = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
    }

    @After
    fun tearDown() {
        servers.forEach { it.shutdown() }
        TorrServerTrust.reset()
    }

    private fun server(): MockWebServer {
        val s = MockWebServer().also { servers.add(it) }
        s.useHttps(ctx.socketFactory, false)
        s.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest) = MockResponse().setBody("MatriX.145 " + request.path)
        }
        s.start()
        return s
    }

    private fun fp() = CertPins.fingerprint(leaf)

    @Test
    fun anUnpinnedSelfSignedServerIsRefusedWithItsFingerprint() {
        val s = server()
        val url = "https://${s.hostName}:${s.port}/ts"
        val r = TorrServerHttp().inspect(url)
        assertEquals("untrusted", r.state)
        assertEquals(TorrServerTrust.key(s.hostName, s.port), r.hostPort)
        assertEquals(fp(), r.seen!!.fingerprint)
        try {
            TorrServerHttp().request("$url/echo", "GET", emptyMap(), null, null, 5000)
            fail("a self-signed certificate must not pass without a pin")
        } catch (f: TorrServerHttp.Failure) {
            assertEquals("tls-untrusted", f.code)
            assertEquals(fp(), f.fingerprint)
        }
    }

    @Test
    fun theAcceptedFingerprintPassesForThatHostPortOnly() {
        val s = server()
        val other = server()
        TorrServerTrust.trust(s.hostName + ":" + s.port, fp())
        val ok = TorrServerHttp().request("https://${s.hostName}:${s.port}/ts/echo", "GET", emptyMap(), null, null, 5000)
        assertEquals(200, ok.status)
        assertEquals("MatriX.145 /ts/echo", String(ok.body))
        assertEquals("trusted", TorrServerHttp().inspect("https://${s.hostName}:${s.port}").state)
        // the same certificate on another port is a different server: asked again
        assertEquals("untrusted", TorrServerHttp().inspect("https://${other.hostName}:${other.port}").state)
        assertTrue(TorrServerTrust.isPinnedUrl("https://u:p@${s.hostName}:${s.port}/ts/stream/a.mkv?link=h"))
        assertFalse(TorrServerTrust.isPinnedUrl("http://${s.hostName}:${s.port}/"))
        assertFalse(TorrServerTrust.isPinnedUrl("https://${other.hostName}:${other.port}/"))
        assertEquals(listOf(TorrServerTrust.key(s.hostName, s.port)), TorrServerTrust.pinned())
    }

    @Test
    fun aChangedCertificateIsRefusedAndThePinStays() {
        val s = server()
        val hp = s.hostName + ":" + s.port
        val old = "ab".repeat(32)
        TorrServerTrust.trust(hp, old)
        val r = TorrServerHttp().inspect("https://$hp")
        assertEquals("changed", r.state)
        assertEquals(fp(), r.seen!!.fingerprint)
        assertEquals(old, TorrServerTrust.backend.get(TorrServerTrust.key(s.hostName, s.port)))
        TorrServerTrust.trust(hp, fp())
        assertEquals("trusted", TorrServerHttp().inspect("https://$hp").state)
    }

    @Test
    fun aPostBodyAndHeadersReachTheServer() {
        val s = server()
        TorrServerTrust.trust(s.hostName + ":" + s.port, fp())
        val r = TorrServerHttp().request("https://${s.hostName}:${s.port}/torrents", "POST", mapOf("Authorization" to "Basic eDp5"), "{\"action\":\"list\"}".toByteArray(), "application/json", 5000)
        assertEquals(200, r.status)
        val rec = s.takeRequest()
        assertEquals("POST", rec.method)
        assertEquals("Basic eDp5", rec.getHeader("Authorization"))
        assertEquals("{\"action\":\"list\"}", rec.body.readUtf8())
    }

    @Test
    fun keysAndBadInput() {
        assertEquals("ts.example.com:8443", TorrServerTrust.normalizeKey(" TS.Example.com:8443 "))
        assertEquals("::1:8443", TorrServerTrust.normalizeKey("[::1]:8443"))
        assertNull(TorrServerTrust.normalizeKey("host"))
        assertNull(TorrServerTrust.normalizeKey("host:0"))
        try {
            TorrServerTrust.trust("h:1", "nothex")
            fail()
        } catch (_: IllegalArgumentException) {
        }
        assertNull(TorrServerHttp.httpsUrl("http://h:1"))
        assertNotNull(TorrServerHttp.httpsUrl("https://h:1"))
    }

    @Test
    fun failureOfReadsTheKindAndFingerprintFromTheCauseChain() {
        val f = "cd".repeat(32)
        val e = javax.net.ssl.SSLHandshakeException("x").apply { initCause(CertificateException(TorrServerTrust.CHANGED + f)) }
        assertEquals("changed" to f, TorrServerTrust.failureOf(e))
        assertEquals("tls-changed", TorrServerHttp.failureOf(e).code)
        assertEquals("tls", TorrServerHttp.failureOf(javax.net.ssl.SSLHandshakeException("other")).code)
        assertEquals("network", TorrServerHttp.failureOf(java.io.IOException("reset")).code)
    }

    @Test
    fun aPageRequestIsReadWithItsBody() {
        val o = org.json.JSONObject().put("url", "https://ts:8091/torrent/upload").put("method", "POST")
            .put("headers", org.json.JSONObject().put("Authorization", "Basic x").put("n", 5))
            .put("bodyBase64", TorrServerHttp.base64("hi".toByteArray())).put("contentType", "multipart/form-data; boundary=b").put("timeoutMs", 30000)
        val c = TorrServerHttp.parse(o)
        assertEquals("POST", c.method)
        assertEquals(mapOf("Authorization" to "Basic x"), c.headers)
        assertEquals("hi", String(c.body!!))
        assertEquals(30000L, c.timeoutMs)
        val g = TorrServerHttp.parse(org.json.JSONObject().put("url", "https://ts:8091/echo").put("method", "DELETE"))
        assertEquals("GET", g.method)
        assertNull(g.body)
        try {
            TorrServerHttp.parse(org.json.JSONObject().put("bodyBase64", "***"))
            fail()
        } catch (f: TorrServerHttp.Failure) {
            assertEquals("bad-body", f.code)
        }
    }

    companion object {
        val PASS = "testpass".toCharArray()
    }
}
