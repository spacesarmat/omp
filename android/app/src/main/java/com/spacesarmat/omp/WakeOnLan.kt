package com.spacesarmat.omp

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

/** Wake-on-LAN magic packet: 6 x 0xFF followed by the MAC 16 times. */
object WakeOnLan {
    private val MAC = Regex("^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$")

    fun magicPacket(mac: String): ByteArray? {
        if (!MAC.matches(mac)) return null
        val bytes = mac.split(':', '-').map { it.toInt(16).toByte() }
        val out = ByteArray(6 + 16 * 6)
        for (i in 0 until 6) out[i] = 0xFF.toByte()
        for (r in 0 until 16) for (i in 0 until 6) out[6 + r * 6 + i] = bytes[i]
        return out
    }

    private val IPV4 = Regex("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$")

    /**
     * UDP 9 and 7 on the global broadcast and on the subnet broadcast.
     * [broadcast] is the address the device reported; otherwise the /24 of [ip].
     */
    fun targets(ip: String, broadcast: String? = null): List<Pair<String, Int>> {
        val global = "255.255.255.255"
        val parts = ip.split('.')
        val slash24 = if (parts.size == 4 && parts.all { (it.toIntOrNull() ?: -1) in 0..255 }) parts.take(3).joinToString(".") + ".255" else null
        val sub = broadcast?.trim()?.takeIf { IPV4.matches(it) } ?: slash24
        val hosts = mutableListOf(global)
        if (sub != null && sub != global) hosts += sub
        val list = mutableListOf<Pair<String, Int>>()
        for (host in hosts) {
            list += host to 9
            list += host to 7
        }
        return list
    }

    /** Sends the packet to every target, 3 times 100 ms apart (blocking). */
    fun send(packet: ByteArray, ip: String, broadcast: String? = null) {
        DatagramSocket().use { socket ->
            socket.broadcast = true
            repeat(3) { n ->
                for ((host, port) in targets(ip, broadcast)) {
                    try {
                        socket.send(DatagramPacket(packet, packet.size, InetAddress.getByName(host), port))
                    } catch (_: Exception) {
                        // one unreachable target must not stop the others
                    }
                }
                if (n < 2) Thread.sleep(100)
            }
        }
    }
}
