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

    /** Broadcast targets: global broadcast on 9, and the /24 broadcast of [ip] on 9 and 7. */
    fun targets(ip: String): List<Pair<String, Int>> {
        val parts = ip.split('.')
        val list = mutableListOf("255.255.255.255" to 9)
        if (parts.size == 4) {
            val sub = parts.take(3).joinToString(".") + ".255"
            list += sub to 9
            list += sub to 7
        }
        return list
    }

    /** Sends the packet to every target, 3 times 100 ms apart (blocking). */
    fun send(packet: ByteArray, ip: String) {
        DatagramSocket().use { socket ->
            socket.broadcast = true
            repeat(3) { n ->
                for ((host, port) in targets(ip)) {
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
