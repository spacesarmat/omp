package com.spacesarmat.omp

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/** LAN / loopback helpers for cleartext and ControlServer client checks. */
object LanAddresses {
    /** Loopback, RFC1918 IPv4, or IPv6 ULA (fc00::/7). */
    fun isLocalClient(addr: InetAddress?): Boolean {
        if (addr == null) return false
        if (addr.isLoopbackAddress || addr.isAnyLocalAddress) return true
        when (addr) {
            is Inet4Address -> return addr.isSiteLocalAddress
            is Inet6Address -> {
                val b = addr.address
                if (b.size < 1) return false
                // Unique local addresses fc00::/7
                return (b[0].toInt() and 0xfe) == 0xfc
            }
            else -> return false
        }
    }

    /** Bare IP literal that is not loopback/LAN (DNS hostnames return false). */
    fun isPublicIpHost(host: String?): Boolean {
        if (host.isNullOrBlank() || !looksLikeIpLiteral(host)) return false
        val addr = try {
            InetAddress.getByName(host.trim().removePrefix("[").removeSuffix("]"))
        } catch (_: Exception) {
            return false
        }
        return !isLocalClient(addr)
    }

    private fun looksLikeIpLiteral(host: String): Boolean {
        val h = host.trim().removePrefix("[").removeSuffix("]")
        if (h.contains(':')) return h.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' || it == ':' }
        val parts = h.split('.')
        if (parts.size != 4) return false
        return parts.all { p -> p.toIntOrNull()?.let { it in 0..255 } == true }
    }
}
