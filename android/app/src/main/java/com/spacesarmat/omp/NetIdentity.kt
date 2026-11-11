package com.spacesarmat.omp

import java.net.Inet4Address
import java.net.NetworkInterface

/** MAC and subnet broadcast of the first up IPv4 interface that is not loopback. */
object NetIdentity {
    data class Report(val mac: String?, val broadcast: String?)

    /** Lower-case colon MAC. Null for a missing, empty or all-zero address. */
    fun formatMac(bytes: ByteArray?): String? {
        if (bytes == null || bytes.size != 6) return null
        if (bytes.all { it == 0.toByte() }) return null
        return bytes.joinToString(":") { "%02x".format(it.toInt() and 255) }
    }

    /** Directed broadcast of a 4-byte address and a prefix length. Null when the prefix is out of range. */
    fun broadcast(address: ByteArray, prefix: Int): String? {
        if (address.size != 4 || prefix !in 0..32) return null
        var acc = 0
        for (b in address) acc = (acc shl 8) or (b.toInt() and 255)
        val hostBits = when (prefix) {
            0 -> -1
            32 -> 0
            else -> -1 ushr prefix
        }
        val bits = acc or hostBits
        return listOf(24, 16, 8, 0).joinToString(".") { ((bits ushr it) and 255).toString() }
    }

    fun read(): Report {
        return try {
            val ifaces = NetworkInterface.getNetworkInterfaces() ?: return Report(null, null)
            var mac: String? = null
            var broadcast: String? = null
            while (ifaces.hasMoreElements()) {
                val nif = ifaces.nextElement()
                if (nif.isLoopback || !nif.isUp) continue
                val hw = formatMac(nif.hardwareAddress)
                for (ia in nif.interfaceAddresses) {
                    val addr = ia.address
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        if (hw != null && mac == null) mac = hw
                        if (broadcast == null) broadcast = broadcast(addr.address, ia.networkPrefixLength.toInt())
                    }
                }
            }
            Report(mac, broadcast)
        } catch (_: Exception) {
            Report(null, null)
        }
    }
}
