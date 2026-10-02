package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SiteCookieJarTest {
    private var now = System.currentTimeMillis()
    private val saved = HashMap<String, String>()
    private val store = object : CookieStore {
        override fun load(site: String): String? = saved[site]
        override fun save(site: String, data: String?) {
            if (data == null) saved.remove(site) else saved[site] = data
        }
    }

    private fun jar() = SiteCookieJar(store) { now }

    private fun cookie(url: String, header: String): Cookie = Cookie.parse(url.toHttpUrl(), header)!!

    @Test
    fun keysBySite() {
        assertEquals("rutracker.org", SiteCookieJar.siteOf("https://rutracker.org/forum/index.php".toHttpUrl()))
        assertEquals("rutracker.org", SiteCookieJar.siteOf("https://bt2.rutracker.org/x".toHttpUrl()))
        assertEquals("192.168.1.5", SiteCookieJar.siteOf("http://192.168.1.5:8090/".toHttpUrl()))
    }

    @Test
    fun sendsCookiesOnlyToTheirSite() {
        val j = jar()
        val login = "https://rutracker.org/forum/login.php".toHttpUrl()
        j.saveFromResponse(login, listOf(cookie(login.toString(), "bb_session=secret; Domain=.rutracker.org; Path=/; Max-Age=3600")))
        assertEquals(listOf("bb_session"), j.loadForRequest("https://rutracker.org/forum/tracker.php".toHttpUrl()).map { it.name })
        assertTrue(j.loadForRequest("https://rutor.info/".toHttpUrl()).isEmpty())
        assertTrue(j.loadForRequest("https://evil-rutracker.org/".toHttpUrl()).isEmpty())
    }

    @Test
    fun persistsAndRestores() {
        val url = "https://nnmclub.to/forum/".toHttpUrl()
        val sidCookie = cookie(url.toString(), "phpbb2mysql_4_sid=abc; Path=/; Max-Age=600; HttpOnly")
        jar().saveFromResponse(url, listOf(sidCookie, cookie(url.toString(), "session=xyz; Path=/forum")))
        assertTrue(saved.containsKey("nnmclub.to"))
        val restored = jar().loadForRequest("https://nnmclub.to/forum/tracker.php".toHttpUrl())
        assertEquals(setOf("phpbb2mysql_4_sid", "session"), restored.map { it.name }.toSet())
        val sid = restored.first { it.name == "phpbb2mysql_4_sid" }
        assertEquals("abc", sid.value)
        assertTrue(sid.httpOnly)
        assertTrue(sid.persistent)
        assertEquals(sidCookie.expiresAt, sid.expiresAt)
        assertFalse(restored.first { it.name == "session" }.persistent)
        // path is respected after restore
        assertEquals(listOf("phpbb2mysql_4_sid"), jar().loadForRequest("https://nnmclub.to/".toHttpUrl()).map { it.name })
    }

    @Test
    fun replacesAndExpires() {
        val j = jar()
        val url = "https://site.org/".toHttpUrl()
        j.saveFromResponse(url, listOf(cookie(url.toString(), "a=1; Max-Age=60")))
        j.saveFromResponse(url, listOf(cookie(url.toString(), "a=2; Max-Age=60")))
        assertEquals(listOf("2"), j.loadForRequest(url).map { it.value })
        now += 61_000
        assertTrue(j.loadForRequest(url).isEmpty())
        // a deleting cookie (Max-Age=0) removes it
        j.saveFromResponse(url, listOf(cookie(url.toString(), "b=1; Max-Age=60")))
        j.saveFromResponse(url, listOf(cookie(url.toString(), "b=; Max-Age=0")))
        assertTrue(j.loadForRequest(url).isEmpty())
        assertNull(saved["site.org"])
    }

    @Test
    fun clearForgetsTheSite() {
        val j = jar()
        val url = "https://rutracker.org/forum/".toHttpUrl()
        j.saveFromResponse(url, listOf(cookie(url.toString(), "bb_session=1; Max-Age=600")))
        j.clear(url)
        assertTrue(j.loadForRequest(url).isEmpty())
        assertNull(saved["rutracker.org"])
        assertTrue(jar().loadForRequest(url).isEmpty())
    }

    @Test
    fun corruptStoreIsIgnored() {
        saved["site.org"] = "{not json"
        assertTrue(jar().loadForRequest("https://site.org/".toHttpUrl()).isEmpty())
    }

    @Test
    fun codecRoundTrip() {
        val url = "https://site.org/".toHttpUrl()
        val list = listOf(
            cookie(url.toString(), "a=1; Domain=site.org; Path=/x; Max-Age=60; Secure; HttpOnly"),
            cookie(url.toString(), "b=2"),
        )
        val back = CookieCodec.decode(CookieCodec.encode(list))
        assertEquals(list, back)
        assertTrue(CookieCodec.decode("[{\"n\":1}]").isEmpty())
    }
}
