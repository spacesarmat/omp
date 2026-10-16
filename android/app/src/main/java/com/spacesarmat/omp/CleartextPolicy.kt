package com.spacesarmat.omp

import com.spacesarmat.omp.rpc.LanAddress
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor

/**
 * Where plain HTTP is allowed. Android's network security config cannot name private ranges or a host the user
 * typed at runtime, and the UI itself is served as `http://localhost`, so the platform flag stays on and this
 * policy is what actually refuses cleartext to the public internet.
 *
 * Allowed: loopback, `*.localhost`, `*.local`, private and link-local addresses ([LanAddress], plus loopback),
 * and the exact hosts the page registered ([setExtra]: a TorrServer, FlareSolverr or indexer outside those ranges).
 * Hostnames are never resolved here.
 */
object CleartextPolicy {
    private val extra = LinkedHashSet<String>()
    private val IPV4 = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")
    private val IPV6 = Regex("""^[0-9a-f:.]+$""")
    private val MAPPED = Regex("""^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$""")

    /** Replaces the user-configured hosts (exact, case-insensitive). */
    fun setExtra(hosts: Collection<String>) {
        val next = hosts.mapNotNull { normalize(it) }
        synchronized(extra) {
            extra.clear()
            extra.addAll(next)
        }
    }

    fun extraHosts(): Set<String> = synchronized(extra) { extra.toSet() }

    /** True when a cleartext connection to [host] is acceptable. */
    fun permitted(host: String?): Boolean {
        val h = normalize(host) ?: return false
        if (h == "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h == "::1") return true
        synchronized(extra) { if (h in extra) return true }
        val ip = literal(h) ?: return false
        if (ip.isLoopbackAddress) return true
        return LanAddress.allowed(ip)
    }

    /**
     * Blank and non-HTTP URLs are left alone (https, file, blob, the player's own schemes). An `http` URL is
     * allowed only when [permitted] says so.
     */
    fun allowsUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return true
        val parsed = url.toHttpUrlOrNull() ?: return true
        if (!parsed.scheme.equals("http", ignoreCase = true)) return true
        return permitted(parsed.host)
    }

    fun interceptor(): Interceptor = Interceptor { chain ->
        val url = chain.request().url
        if (url.scheme.equals("http", ignoreCase = true) && !permitted(url.host)) {
            throw IOException("cleartext-blocked")
        }
        chain.proceed(chain.request())
    }

    fun isBlocked(t: Throwable?): Boolean {
        var c = t
        while (c != null) {
            if (c.message?.startsWith("cleartext-blocked") == true) return true
            c = c.cause
        }
        return false
    }

    private fun normalize(raw: String?): String? {
        var h = raw?.trim()?.lowercase() ?: return null
        if (h.startsWith("[") && h.endsWith("]") && h.length >= 2) h = h.substring(1, h.length - 1)
        val zone = h.indexOf('%')
        if (zone >= 0) h = h.substring(0, zone)
        val mapped = MAPPED.matchEntire(h)
        if (mapped != null) h = mapped.groupValues[1]
        return h.ifEmpty { null }
    }

    /** An IP literal, or null for a hostname (no DNS). */
    private fun literal(host: String): InetAddress? {
        val v4 = IPV4.matchEntire(host)
        if (v4 != null) {
            val parts = v4.groupValues.drop(1).map { it.toInt() }
            if (parts.any { it > 255 }) return null
            return InetAddress.getByAddress(parts.map { it.toByte() }.toByteArray())
        }
        if (!host.contains(':') || !IPV6.matches(host)) return null
        return try {
            val a = InetAddress.getByName(host)
            if (a is Inet4Address || a is Inet6Address) a else null
        } catch (_: Exception) {
            null
        }
    }
}
