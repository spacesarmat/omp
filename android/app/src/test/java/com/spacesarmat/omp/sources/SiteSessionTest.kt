package com.spacesarmat.omp.sources

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SiteSessionTest {
    private val now = 1_000_000_000_000L
    private val check = SiteSession.check("my.php", "logout.php?hash4u=", "login.php", listOf("uid"))!!

    private fun jar() = SiteCookieJar(MemoryCookieStore()) { now }

    @Test
    fun cleanCapsCountAndSizeAndDropsInvalid() {
        val many = (1..50).map { "c$it" to "v" }
        assertEquals(SiteSession.MAX_COOKIES, SiteSession.clean(many).size)
        val big = listOf("a" to "x".repeat(4000), "b" to "y".repeat(3000), "c" to "z")
        // b would pass the total: skipped, the small one after it still fits
        assertEquals(listOf("a", "c"), SiteSession.clean(big).map { it.first })
        assertEquals(listOf("ok"), SiteSession.clean(listOf("bad name" to "1", "ok" to "1", "ok" to "2", "q" to "a;b")).map { it.first })
    }

    @Test
    fun readyNeedsTheNamedCookieOrAnySiteCookie() {
        assertFalse(SiteSession.ready(listOf("cf_clearance" to "x", "guest" to "1"), check))
        assertTrue(SiteSession.ready(listOf("uid" to "7"), check))
        val any = SiteSession.check("index.php", "logout", "login.php", emptyList())!!
        assertFalse(SiteSession.ready(listOf("cf_clearance" to "x", "__cf_bm" to "y"), any))
        assertTrue(SiteSession.ready(listOf("sid" to "1"), any))
    }

    @Test
    fun verifiedNeedsTheMarkerOffTheLoginPage() {
        assertTrue(SiteSession.verified(200, "https://kinozal.example/my.php", "<a href=\"logout.php?hash4u=1\">", check))
        assertFalse(SiteSession.verified(200, "https://kinozal.example/login.php", "logout.php?hash4u=1", check))
        assertFalse(SiteSession.verified(200, "https://kinozal.example/my.php", "<form>login</form>", check))
        assertFalse(SiteSession.verified(403, "https://kinozal.example/my.php", "logout.php?hash4u=1", check))
    }

    @Test
    fun checkAndHostsAreValidated() {
        assertNull(SiteSession.check("https://evil.example/", "x", "login.php", emptyList()))
        assertNull(SiteSession.check("/abs", "x", "login.php", emptyList()))
        assertNull(SiteSession.check("my.php", "", "login.php", emptyList()))
        assertNull(SiteSession.check("my.php", "x", "//evil.example/", emptyList()))
        assertEquals(listOf("kinozal.me", "kinozal.tv"), SiteSession.hosts(listOf("Kinozal.ME", "kinozal.tv", "kinozal.tv", "bad host", "")))
        assertTrue(SiteSession.onSite("www.kinozal.tv", listOf("kinozal.tv")))
        assertFalse(SiteSession.onSite("evilkinozal.tv", listOf("kinozal.tv")))
    }

    @Test
    fun importReplacesTheOldSessionKeepsClearanceAndOnlyThatSite() {
        val j = jar()
        val root = "https://kinozal.example/".toHttpUrl()
        // an old form login and a clearance in the jar
        CloudflareCookies.import(j, root, listOf("cf_clearance" to "old", "uid" to "1", "pass" to "old"), now + 60_000)
        SiteSession.import(j, root, listOf("uid" to "2", "sid" to "s"), now)
        val got = j.loadForRequest(root).associate { it.name to it.value }
        assertEquals(mapOf("cf_clearance" to "old", "uid" to "2", "sid" to "s"), got)
        assertEquals(now + SiteSession.SESSION_TTL_MS, j.loadForRequest(root).first { it.name == "uid" }.expiresAt)
        assertTrue(j.loadForRequest("https://other.example/".toHttpUrl()).isEmpty())
        // only Cloudflare cookies: no session, nothing changes
        var thrown = false
        try {
            SiteSession.import(j, root, listOf("cf_clearance" to "x"), now)
        } catch (e: IllegalArgumentException) {
            thrown = true
        }
        assertTrue(thrown)
        assertEquals("2", j.loadForRequest(root).first { it.name == "uid" }.value)
    }

    @Test
    fun stagedSessionRoundTrip() {
        val s = SiteSession.decode(SiteSession.encode(SiteSession.Staged("kinozal.example", listOf("uid" to "1"), "UA/1")))!!
        assertEquals("kinozal.example", s.host)
        assertEquals(listOf("uid" to "1"), s.cookies)
        assertEquals("UA/1", s.ua)
        assertNull(SiteSession.decode("{\"host\":\"Bad Host\",\"cookies\":[{\"n\":\"a\",\"v\":\"b\"}]}"))
        assertNull(SiteSession.decode("garbage"))
        assertEquals("Staged(1 cookies)", s.toString())
    }

    @Test
    fun loginNavigationStaysOnTheSiteAndCaptchaPages() {
        val hosts = listOf("kinozal.me", "kinozal.tv")
        assertTrue(LoginNavigation.allowed(hosts, "kinozal.tv", "/login.php"))
        assertTrue(LoginNavigation.allowed(hosts, "www.kinozal.me", "/"))
        assertTrue(LoginNavigation.allowed(hosts, "challenges.cloudflare.com", "/cdn-cgi/x"))
        assertTrue(LoginNavigation.allowed(hosts, "newassets.hcaptcha.com", "/captcha"))
        assertTrue(LoginNavigation.allowed(hosts, "www.google.com", "/recaptcha/api2/fallback"))
        assertFalse(LoginNavigation.allowed(hosts, "www.google.com", "/search"))
        assertFalse(LoginNavigation.allowed(hosts, "evil.example", "/"))
        assertFalse(LoginNavigation.allowed(hosts, "kinozal.tv.evil.example", "/"))
        assertFalse(LoginNavigation.allowed(hosts, null, "/"))
    }

    @Test
    fun verifierSendsOnlyTheSessionWithItsUserAgent() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("<a href=\"logout.php?hash4u=9\">Выход</a>"))
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/login.php"))
        server.enqueue(MockResponse().setBody("<form>login</form>"))
        server.start()
        try {
            val root = server.url("/")
            val v = SessionVerifier(5_000) { now }
            val c = SiteSession.check("my.php", "logout.php?hash4u=", "login.php", emptyList())!!
            assertTrue(v.verify(root, listOf("uid" to "1", "pass" to "p"), "Phone-UA", c))
            val r = server.takeRequest()
            assertEquals("/my.php", r.path)
            assertEquals("Phone-UA", r.getHeader("User-Agent"))
            val cookie = r.getHeader("Cookie")
            assertNotNull(cookie)
            assertTrue(cookie!!.contains("uid=1") && cookie.contains("pass=p"))
            // redirected to the login page: not signed in
            assertFalse(v.verify(root, listOf("uid" to "1"), "Phone-UA", c))
            // no session cookie at all: no request
            assertFalse(v.verify(root, listOf("cf_clearance" to "x"), "Phone-UA", c))
            assertEquals(3, server.requestCount)
        } finally {
            server.shutdown()
        }
    }
}
