package com.spacesarmat.omp.sources

import okhttp3.Cookie
import okhttp3.HttpUrl

/**
 * Cookies of a passed Cloudflare check into the [SiteCookieJar] (pure, JVM-tested): the hidden check, the visible check
 * on this device, and a check the phone passed for the TV («Пройти на телефоне»). Values are never logged.
 */
object CloudflareCookies {
    const val CLEARANCE = "cf_clearance"
    const val MAX_COOKIES = 40
    const val MAX_NAME = 256
    const val MAX_VALUE = 4096

    /** RFC 6265 token. */
    private val NAME = Regex("^[!#$%&'*+\\-.^_`|~0-9A-Za-z]{1,$MAX_NAME}$")

    /** RFC 6265 cookie-octet: no space, quote, comma, semicolon or backslash. */
    private val VALUE = Regex("^[\\x21\\x23-\\x2B\\x2D-\\x3A\\x3C-\\x5B\\x5D-\\x7E]{0,$MAX_VALUE}$")

    fun isCloudflare(name: String): Boolean = name == CLEARANCE || name.startsWith("__cf") || name.startsWith("cf_")

    fun validName(name: String): Boolean = NAME.matches(name)

    fun validValue(value: String): Boolean = VALUE.matches(value)

    /** The pairs a check may hand over: valid names and values, no duplicates, at most [MAX_COOKIES]. */
    fun clean(pairs: List<Pair<String, String>>): List<Pair<String, String>> {
        val seen = HashSet<String>()
        val out = ArrayList<Pair<String, String>>()
        for ((n, v) in pairs) {
            if (!validName(n) || !validValue(v) || !seen.add(n)) continue
            out.add(n to v)
            if (out.size >= MAX_COOKIES) break
        }
        return out
    }

    /**
     * [pairs] (the browser's cookies for [root]) into the jar for the whole site of [root], ending at [until]: the
     * Cloudflare ones always (a fresh check replaces the old clearance), others only when the jar has none of that name
     * (a tracker login in the jar wins). Cookies OkHttp refuses are skipped.
     */
    fun import(jar: SiteCookieJar, root: HttpUrl, pairs: List<Pair<String, String>>, until: Long) {
        if (pairs.isEmpty()) return
        val have = jar.loadForRequest(root).map { it.name }.toSet()
        val domain = SiteCookieJar.siteOf(root)
        val out = ArrayList<Cookie>()
        for ((name, value) in pairs) {
            if (!isCloudflare(name) && name in have) continue
            try {
                val b = Cookie.Builder().name(name).value(value).path("/").expiresAt(until)
                if (domain == root.host) b.hostOnlyDomain(domain) else b.domain(domain)
                if (root.isHttps) b.secure()
                out.add(b.build())
            } catch (e: IllegalArgumentException) {
                // a cookie OkHttp refuses is skipped
            }
        }
        jar.saveFromResponse(root, out)
    }

    /** When the stored clearance of [url]'s site ends (epoch ms); null without one. */
    fun clearanceUntil(jar: SiteCookieJar, url: HttpUrl): Long? =
        jar.loadForRequest(CloudflareSolver.siteRoot(url)).firstOrNull { it.name == CLEARANCE && it.persistent }?.expiresAt
}
