package com.spacesarmat.omp

import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/**
 * LAN open-port scan of the device's own /24: Jackett (9117), Prowlarr (9696), FlareSolverr (8191),
 * TorrServer (8090, 5665). Nothing is sent beyond TCP connect; the page identifies each hit with an HTTP probe.
 * Only those ports and only a private IPv4 subnet, short timeouts, bounded concurrency: never a general scanner.
 * Addresses are not logged.
 */
object LanScan {
    val ALLOWED = setOf(9117, 9696, 8191, 8090, 5665)
    /** Parallel TCP connects — keeps a /24×2-port TorrServer scan under a few seconds on Wi‑Fi. */
    const val CONCURRENCY = 64
    const val DEFAULT_TIMEOUT_MS = 350

    data class Hit(val ip: String, val port: Int)

    /** The 254 host addresses of the /24 of a private [ip], empty for anything else. */
    fun subnetHosts(ip: String): List<String> {
        if (!PortProbe.isPrivateIpv4(ip)) return emptyList()
        val prefix = ip.substringBeforeLast('.')
        return (1..254).map { "$prefix.$it" }
    }

    /** Allowed ports only, each once. */
    fun allowedPorts(ports: List<Int>): List<Int> = ports.filter { it in ALLOWED }.distinct()

    /**
     * Every host of [ip]'s /24 × allowed [ports], at most [CONCURRENCY] connects at once, each within [timeoutMs].
     * Blocking (a worker thread). [connect] is the TCP check (tests pass a fake).
     */
    fun scan(
        ip: String,
        ports: List<Int>,
        timeoutMs: Int,
        connect: (String, Int, Int) -> Boolean = ::answers,
    ): List<Hit> {
        val hosts = subnetHosts(ip)
        val list = allowedPorts(ports)
        if (hosts.isEmpty() || list.isEmpty()) return emptyList()
        val targets = hosts.flatMap { h -> list.map { Hit(h, it) } }
        val pool = Executors.newFixedThreadPool(CONCURRENCY)
        try {
            val jobs: List<Pair<Hit, Future<Boolean>>> = targets.map { t -> t to pool.submit(Callable { connect(t.ip, t.port, timeoutMs) }) }
            // every job is bounded by its own connect timeout; the pool runs them in waves
            val deadline = System.currentTimeMillis() + (targets.size / CONCURRENCY + 2) * (timeoutMs + 200L)
            return jobs.filter { (_, job) ->
                try {
                    job.get(maxOf(1L, deadline - System.currentTimeMillis()), TimeUnit.MILLISECONDS)
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
