package com.spacesarmat.omp

import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Install assistant: which install-related ports answer on a TV in the home network (TCP connect only, nothing is
 * sent). Only a fixed set of ports and private IPv4 addresses, so this is never a general scanner.
 */
object PortProbe {
    /** LG Developer Mode SSH and Key Server, adb over the network, OMP control server on Android TV. */
    val ALLOWED = setOf(9922, 9991, 5555, 8095)

    private val IPV4 = Regex("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")

    /** 10/8, 172.16/12, 192.168/16 (home networks). */
    fun isPrivateIpv4(ip: String): Boolean {
        if (!IPV4.matches(ip)) return false
        val p = ip.split('.').map { it.toInt() }
        return p[0] == 10 || (p[0] == 172 && p[1] in 16..31) || (p[0] == 192 && p[1] == 168)
    }

    /** Allowed ports only, each once, in the given order. */
    fun allowedPorts(ports: List<Int>): List<Int> = ports.filter { it in ALLOWED }.distinct()

    /** Ports of [ports] that accept a TCP connection within [timeoutMs]. Blocking. */
    fun open(ip: String, ports: List<Int>, timeoutMs: Int): List<Int> {
        if (!isPrivateIpv4(ip)) return emptyList()
        val list = allowedPorts(ports)
        if (list.isEmpty()) return emptyList()
        val pool = Executors.newFixedThreadPool(list.size)
        try {
            val jobs = list.map { port -> port to pool.submit(Callable { answers(ip, port, timeoutMs) }) }
            return jobs.filter { (_, job) ->
                try {
                    job.get(timeoutMs + 1000L, TimeUnit.MILLISECONDS)
                } catch (_: Exception) {
                    false
                }
            }.map { it.first }
        } finally {
            pool.shutdownNow()
        }
    }

    private fun answers(ip: String, port: Int, timeoutMs: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(ip, port), timeoutMs) }
        true
    } catch (_: Exception) {
        false
    }
}
