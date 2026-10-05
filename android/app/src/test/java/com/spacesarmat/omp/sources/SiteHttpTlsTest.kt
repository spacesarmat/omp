package com.spacesarmat.omp.sources

import com.spacesarmat.omp.I18n
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import javax.xml.parsers.DocumentBuilderFactory
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.w3c.dom.Element

class SiteHttpTlsTest {
    private val servers = ArrayList<MockWebServer>()

    @After
    fun tearDown() {
        servers.forEach { it.shutdown() }
        I18n.lang = "ru"
    }

    private fun jar() = SiteCookieJar(object : CookieStore {
        override fun load(site: String): String? = null
        override fun save(site: String, data: String?) {}
    })

    @Test
    fun certificateFailuresGetTheTlsCode() {
        I18n.lang = "ru"
        val handshake = SiteHttp.failureOf(SSLHandshakeException("unable to find valid certification path"))
        assertEquals(SiteHttp.CODE_TLS, handshake.code)
        assertEquals("Ошибка сертификата сайта", handshake.reason)
        val peer = SiteHttp.failureOf(SSLPeerUnverifiedException("Hostname torrent.by not verified"))
        assertEquals(SiteHttp.CODE_TLS, peer.code)
        assertEquals(SiteHttp.TLS_ERROR, peer.reason)
        I18n.lang = "en"
        assertEquals("Site certificate error", SiteHttp.failureOf(SSLHandshakeException("x")).reason)
    }

    @Test
    fun otherFailuresStayNoAnswer() {
        val timeout = SiteHttp.failureOf(SocketTimeoutException("timeout"))
        assertNull(timeout.code)
        assertEquals(SiteHttp.NO_ANSWER, timeout.reason)
        assertNull(SiteHttp.failureOf(IOException("reset")).code)
        val own = SiteHttpException(SiteHttp.TOO_LARGE)
        assertSame(own, SiteHttp.failureOf(own))
    }

    @Test
    fun anUntrustedCertificateIsReportedAsTlsNotNoAnswer() {
        val ks = KeyStore.getInstance("PKCS12")
        javaClass.classLoader!!.getResourceAsStream("untrusted-site.p12")!!.use { ks.load(it, PASS) }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, PASS) }
        val ctx = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
        val site = MockWebServer().also { servers.add(it) }
        site.useHttps(ctx.socketFactory, false)
        site.enqueue(MockResponse().setBody("ok"))
        site.start()
        try {
            SiteHttp(jar()).request(site.url("/").toString(), "GET", emptyMap(), null, null, null, 10_000)
            fail("a self-signed certificate must not be trusted")
        } catch (e: SiteHttpException) {
            assertEquals(SiteHttp.CODE_TLS, e.code)
            assertEquals(SiteHttp.TLS_ERROR, e.reason)
        }
    }

    @Test
    fun torrentByTrustsTheBundledLetsEncryptIntermediatesBesideTheSystemStore() {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(RES, "xml/network_security_config.xml"))
        val configs = doc.getElementsByTagName("domain-config")
        val torrentBy = (0 until configs.length).map { configs.item(it) as Element }.single { c ->
            val domains = c.getElementsByTagName("domain")
            (0 until domains.length).any { (domains.item(it) as Element).textContent.trim() == "torrent.by" }
        }
        val domain = torrentBy.getElementsByTagName("domain").item(0) as Element
        assertEquals("true", domain.getAttribute("includeSubdomains"))
        val anchors = torrentBy.getElementsByTagName("certificates")
        val sources = (0 until anchors.length).map { (anchors.item(it) as Element).getAttribute("src") }.toSet()
        assertEquals(setOf("system", "@raw/letsencrypt_ye"), sources)
        // nothing else changed: the app-wide config still trusts the system store and allows the local http
        val base = doc.getElementsByTagName("base-config").item(0) as Element
        assertEquals("true", base.getAttribute("cleartextTrafficPermitted"))
        assertEquals("system", (base.getElementsByTagName("certificates").item(0) as Element).getAttribute("src"))
    }

    @Test
    fun theBundledFileHoldsTheLetsEncryptYeIntermediates() {
        val certs = File(RES, "raw/letsencrypt_ye.crt").inputStream().use {
            CertificateFactory.getInstance("X.509").generateCertificates(it).map { c -> c as X509Certificate }
        }
        val byName = certs.associateBy { Regex("CN=([^,]+)").find(it.subjectX500Principal.name)!!.groupValues[1] }
        assertEquals(setOf("YE1", "YE2", "YE3"), byName.keys)
        for (c in certs) {
            assertTrue(c.issuerX500Principal.name.contains("CN=Root YE"))
            assertTrue("a CA certificate", c.basicConstraints >= 0)
        }
        // YE1 is the issuer torrent.by's leaf names (the same certificate its AIA URL http://ye1.i.lencr.org/ serves)
        val sha = MessageDigest.getInstance("SHA-256").digest(byName.getValue("YE1").encoded).joinToString("") { "%02X".format(it) }
        assertEquals("A2372D06431E9716365EEED47EC020351497D182FCC038E457E58168A03CAC07", sha)
    }

    private companion object {
        val PASS = "testpass".toCharArray()
        /** Unit tests run in the module directory (android/app). */
        val RES = File("src/main/res")
    }
}
