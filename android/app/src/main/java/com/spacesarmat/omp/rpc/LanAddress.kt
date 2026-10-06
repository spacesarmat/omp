package com.spacesarmat.omp.rpc

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress

/**
 * Client addresses the phone RPC server answers: private IPv4 (10/8, 172.16/12, 192.168/16), link-local
 * (169.254/16, fe80::/10) and IPv6 ULA (fc00::/7). Loopback, CGNAT (100.64/10) and public addresses are refused,
 * so the server never answers on mobile data. IPv4-mapped IPv6 is checked as IPv4.
 */
object LanAddress {
    fun allowed(a: InetAddress?): Boolean {
        if (a == null) return false
        val b = a.address
        return when {
            a is Inet4Address && b.size == 4 -> v4(b)
            a is Inet6Address && b.size == 16 -> if (mapped(b)) v4(b.copyOfRange(12, 16)) else v6(b)
            else -> false
        }
    }

    /**
     * True when [local], the phone's address a connection arrived on, is one of [lan] (the addresses of its Wi-Fi,
     * Ethernet or hotspot interfaces). A carrier's CGNAT can hand out 10/8 on mobile data, where the client address
     * alone passes [allowed]; such a connection arrives on the mobile interface and is refused here.
     */
    fun arrivedOn(local: InetAddress?, lan: Collection<InetAddress>): Boolean {
        val l = plain(local ?: return false) ?: return false
        return lan.any { a -> plain(a)?.let { it.contentEquals(l) } == true }
    }

    /** The address bytes, with IPv4-mapped IPv6 as 4 bytes; null for an odd length. */
    private fun plain(a: InetAddress): ByteArray? {
        val b = a.address
        return when (b.size) {
            4 -> b
            16 -> if (mapped(b)) b.copyOfRange(12, 16) else b
            else -> null
        }
    }

    private fun v4(b: ByteArray): Boolean {
        val o0 = b[0].toInt() and 0xff
        val o1 = b[1].toInt() and 0xff
        return when {
            o0 == 10 -> true
            o0 == 172 && o1 in 16..31 -> true
            o0 == 192 && o1 == 168 -> true
            o0 == 169 && o1 == 254 -> true
            else -> false
        }
    }

    private fun v6(b: ByteArray): Boolean {
        val o0 = b[0].toInt() and 0xff
        val o1 = b[1].toInt() and 0xff
        return when {
            o0 == 0xfe && (o1 and 0xc0) == 0x80 -> true // fe80::/10 link-local
            (o0 and 0xfe) == 0xfc -> true // fc00::/7 ULA
            else -> false
        }
    }

    /** ::ffff:a.b.c.d */
    private fun mapped(b: ByteArray): Boolean {
        for (i in 0 until 10) if (b[i].toInt() != 0) return false
        return (b[10].toInt() and 0xff) == 0xff && (b[11].toInt() and 0xff) == 0xff
    }
}
