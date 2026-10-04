package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudflareCookiesTest {
    private var now = 1_000_000_000_000L
    private val saved = HashMap<String, String>()
    private val jar = SiteCookieJar(object : CookieStore {
        override fun load(site: String): String? = saved[site]
        override fun save(site: String, data: String?) {
            if (data == null) saved.remove(site) else saved[site] = data
        }
    }) { now }

    private val root = "https://rustorka.example/".toHttpUrl()

    @Test
    fun importsForTheSiteOnlyAndKeepsALogin() {
        jar.saveFromResponse(root, listOf(Cookie.parse(root, "bb_session=login; Path=/; Max-Age=3600")!!))
        CloudflareCookies.import(jar, root, listOf("cf_clearance" to "c1", "bb_session" to "page", "__cf_bm" to "b"), now + 60_000)
        val got = jar.loadForRequest("https://rustorka.example/forum/".toHttpUrl()).associate { it.name to it.value }
        assertEquals(mapOf("bb_session" to "login", "cf_clearance" to "c1", "__cf_bm" to "b"), got)
        assertTrue(jar.loadForRequest("https://other.example/".toHttpUrl()).isEmpty())
        assertEquals(now + 60_000, CloudflareCookies.clearanceUntil(jar, "https://rustorka.example/tracker.php?q=x".toHttpUrl()))
        // a fresh clearance replaces the old one
        CloudflareCookies.import(jar, root, listOf("cf_clearance" to "c2"), now + 120_000)
        assertEquals("c2", jar.loadForRequest(root).first { it.name == "cf_clearance" }.value)
        now += 200_000
        assertNull(CloudflareCookies.clearanceUntil(jar, root))
    }

    @Test
    fun cleanDropsInvalidDuplicateAndExtraCookies() {
        val pairs = listOf(
            "cf_clearance" to "ok",
            "bad name" to "x",
            "semi" to "a;b",
            "quote" to "a\"b",
            "cf_clearance" to "again",
            "long" to "v".repeat(CloudflareCookies.MAX_VALUE + 1),
        ) + (1..60).map { "c$it" to "v" }
        val clean = CloudflareCookies.clean(pairs)
        assertEquals("cf_clearance" to "ok", clean[0])
        assertEquals(CloudflareCookies.MAX_COOKIES, clean.size)
        assertTrue(clean.none { it.first in setOf("bad name", "semi", "quote", "long") })
        assertEquals(1, clean.count { it.first == "cf_clearance" })
    }

    @Test
    fun aPhoneClearanceBringsThePhoneUserAgentForThatHost() {
        val pass = CloudflarePass(null, FlareSolverrClient(), jar, { "TV-UA" }, null) { now }
        pass.importClearance("https://rustorka.example/tracker.php?nm=x".toHttpUrl(), listOf("cf_clearance" to "c1", "bad;" to "x"), "Phone-UA", now + 60_000)
        assertEquals(listOf("cf_clearance"), jar.loadForRequest(root).map { it.name })
        assertEquals("Phone-UA", pass.userAgentFor("rustorka.example"))
        assertEquals("TV-UA", pass.userAgentFor("other.example"))
        now += 61_000
        assertEquals("TV-UA", pass.userAgentFor("rustorka.example"))
        // passed here: this device's own User-Agent again
        pass.importClearance(root, listOf("cf_clearance" to "c2"), "Phone-UA", now + 60_000)
        pass.importClearance(root, listOf("cf_clearance" to "c3"), null, now + 60_000)
        assertEquals("TV-UA", pass.userAgentFor("rustorka.example"))
    }
}
