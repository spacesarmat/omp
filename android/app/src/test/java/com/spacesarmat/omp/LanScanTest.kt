package com.spacesarmat.omp

import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LanScanTest {
    @Test
    fun onlyThePrivateSubnetOfTheDevice() {
        val hosts = LanScan.subnetHosts("192.168.1.40")
        assertEquals(254, hosts.size)
        assertEquals("192.168.1.1", hosts.first())
        assertEquals("192.168.1.254", hosts.last())
        assertEquals(254, LanScan.subnetHosts("10.0.0.2").size)
        assertEquals(254, LanScan.subnetHosts("172.20.1.9").size)
        assertTrue(LanScan.subnetHosts("8.8.8.8").isEmpty())
        assertTrue(LanScan.subnetHosts("172.32.0.1").isEmpty())
        assertTrue(LanScan.subnetHosts("not an ip").isEmpty())
    }

    @Test
    fun onlyTheJackettAndProwlarrPorts() {
        assertEquals(listOf(9117, 9696, 8191), LanScan.allowedPorts(listOf(22, 9117, 80, 9696, 9117, 8191, 5555)))
        assertTrue(LanScan.scan("192.168.1.40", listOf(22, 80), 100) { _, _, _ -> true }.isEmpty())
        assertTrue(LanScan.scan("8.8.8.8", listOf(9117), 100) { _, _, _ -> true }.isEmpty())
    }

    @Test
    fun findsTheOpenPortsWithBoundedConcurrency() {
        val asked = Collections.synchronizedList(ArrayList<String>())
        val inFlight = AtomicInteger()
        val peak = AtomicInteger()
        val hits = LanScan.scan("192.168.1.40", listOf(9117, 9696, 22), 100) { ip, port, timeout ->
            val n = inFlight.incrementAndGet()
            peak.accumulateAndGet(n) { a, b -> maxOf(a, b) }
            asked.add("$ip:$port")
            assertEquals(100, timeout)
            Thread.sleep(1)
            inFlight.decrementAndGet()
            (ip == "192.168.1.5" && port == 9117) || (ip == "192.168.1.7" && port == 9696)
        }
        assertEquals(listOf(LanScan.Hit("192.168.1.5", 9117), LanScan.Hit("192.168.1.7", 9696)), hits)
        assertEquals(508, asked.size)
        assertTrue(asked.none { it.endsWith(":22") })
        assertTrue(peak.get() <= LanScan.CONCURRENCY)
    }
}
