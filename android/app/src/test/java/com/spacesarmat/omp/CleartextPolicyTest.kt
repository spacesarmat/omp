package com.spacesarmat.omp

import com.spacesarmat.omp.box.BoxIdentity
import java.io.IOException
import java.security.cert.CertificateException
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class CleartextPolicyTest {
    @After
    fun resetExtra() {
        CleartextPolicy.setExtra(emptyList())
    }

    @Test
    fun lanAndLoopbackArePermittedAndThePublicInternetIsNot() {
        for (host in listOf(
            "localhost",
            "app.localhost",
            "LG.local",
            "127.0.0.1",
            "127.1.2.3",
            "::1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.20",
            "169.254.1.1",
            "fe80::1",
            "fd00::1",
            "[fe80::1%eth0]",
        )) {
            assertTrue(host, CleartextPolicy.permitted(host))
        }
        for (host in listOf("8.8.8.8", "1.1.1.1", "100.64.0.1", "172.15.0.1", "example.com", "11.0.0.1")) {
            assertFalse(host, CleartextPolicy.permitted(host))
        }
    }

    @Test
    fun userHostsAreExactAndReplaceThePreviousSet() {
        CleartextPolicy.setExtra(listOf("Example.COM", "http://ignored", "  "))
        assertTrue(CleartextPolicy.permitted("example.com"))
        assertFalse(CleartextPolicy.permitted("other.example"))
        CleartextPolicy.setExtra(listOf("other.example"))
        assertFalse(CleartextPolicy.permitted("example.com"))
        assertTrue(CleartextPolicy.permitted("OTHER.example"))
    }

    @Test
    fun httpIsGatedAndOtherSchemesAreNot() {
        assertTrue(CleartextPolicy.allowsUrl(null))
        assertTrue(CleartextPolicy.allowsUrl(""))
        assertTrue(CleartextPolicy.allowsUrl("https://example.com/a"))
        assertTrue(CleartextPolicy.allowsUrl("file:///tmp/a"))
        assertTrue(CleartextPolicy.allowsUrl("http://192.168.0.2:8090/stream"))
        assertTrue(CleartextPolicy.allowsUrl("http://127.0.0.1:8090/echo"))
        assertFalse(CleartextPolicy.allowsUrl("http://example.com/poster"))
        assertFalse(CleartextPolicy.allowsUrl("http://8.8.8.8/x"))
    }

    @Test
    fun interceptorRefusesPublicHttp() {
        val client = OkHttpClient.Builder().addInterceptor(CleartextPolicy.interceptor()).build()
        try {
            client.newCall(Request.Builder().url("http://example.com/").build()).execute()
            fail("public http must be refused")
        } catch (e: IOException) {
            assertTrue(CleartextPolicy.isBlocked(e))
        }
    }

    @Test
    fun redirectToPublicHttpIsRefused() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(302).addHeader("Location", "http://example.com/apk"))
        server.start()
        val client = OkHttpClient.Builder().addNetworkInterceptor(CleartextPolicy.interceptor()).build()
        try {
            client.newCall(Request.Builder().url(server.url("/")).build()).execute()
            fail("a redirect to public http must be refused")
        } catch (e: IOException) {
            assertTrue(CleartextPolicy.isBlocked(e))
        } finally {
            server.shutdown()
        }
    }
}

class CertPinsTest {
    @After
    fun reset() {
        CertPins.reset()
    }

    @Test
    fun firstCertificateIsPinnedAndAChangeDoesNotOverwriteIt() {
        val a = BoxIdentity.generate().certificate
        val b = BoxIdentity.generate().certificate
        val host = "192.168.1.20"
        CertPins.checkHost(host, a)
        CertPins.commit(host)
        CertPins.checkHost("192.168.1.20", a)
        try {
            CertPins.checkHost(host, b)
            fail("a different certificate must be refused")
        } catch (e: CertificateException) {
            assertEquals(CertPins.fingerprint(b), CertPins.changedFingerprint(e))
        }
        assertEquals(CertPins.fingerprint(a), CertPins.backend.get(host))
        assertEquals(CertPins.fingerprint(b), CertPins.lastRejected(host))
        CertPins.trust(host, CertPins.fingerprint(b))
        CertPins.checkHost(host, b)
        assertEquals(CertPins.fingerprint(b), CertPins.backend.get(host))
    }

    @Test
    fun commitDoesNotInventAPinAndTrustRejectsAShortFingerprint() {
        CertPins.commit("10.0.0.1")
        assertNull(CertPins.backend.get("10.0.0.1"))
        try {
            CertPins.trust("10.0.0.1", "abcd")
            fail("short fingerprint")
        } catch (e: IllegalArgumentException) {
            assertNull(CertPins.backend.get("10.0.0.1"))
        }
    }

    @Test
    fun failureTextKeepsACertificateChange() {
        val fp = "ab".repeat(32)
        val text = tvFailText(CertificateException("cert-changed:$fp"))
        assertEquals("cert-changed:$fp", text)
        assertEquals(fp, CertPins.changedFingerprint(text))
        assertEquals("cert-changed:$fp", tvPreferReason("cert-changed:$fp", "timeout"))
        assertEquals("timeout", tvPreferReason("refused", "timeout"))
        assertFalse(tvMayTryOtherPorts("cert-changed:$fp"))
        assertTrue(tvMayTryOtherPorts("timeout"))
        assertTrue(tvMayTryOtherPorts(null))
    }
}
