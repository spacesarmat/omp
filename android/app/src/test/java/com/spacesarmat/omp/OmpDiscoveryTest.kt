package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.InetAddress

class OmpDiscoveryTest {
    @Test
    fun keepsPlainNames() {
        assertEquals("Гостиная", OmpDiscovery.cleanName("Гостиная"))
        assertEquals("Living Room (2)", OmpDiscovery.cleanName("Living Room (2)"))
    }

    @Test
    fun decodesDnsEscapes() {
        assertEquals("Living Room", OmpDiscovery.cleanName("Living\\032Room"))
        assertEquals("a.b", OmpDiscovery.cleanName("a\\.b"))
        // «Г» as two UTF-8 bytes
        assertEquals("Г", OmpDiscovery.cleanName("\\208\\147"))
    }

    private fun addr(vararg b: Int) = InetAddress.getByAddress(ByteArray(b.size) { b[it].toByte() })

    @Test
    fun picksTheFirstIpv4OfHostAddresses() {
        val v6 = addr(0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
        assertEquals("192.168.1.7", OmpDiscovery.pickIpv4(listOf(v6, addr(192, 168, 1, 7), addr(10, 0, 0, 2)), v6))
        assertEquals("10.0.0.2", OmpDiscovery.pickIpv4(emptyList(), addr(10, 0, 0, 2)))
        assertEquals("10.0.0.2", OmpDiscovery.pickIpv4(null, addr(10, 0, 0, 2)))
        assertEquals("10.0.0.2", OmpDiscovery.pickIpv4(listOf(v6), addr(10, 0, 0, 2)))
        assertEquals(null, OmpDiscovery.pickIpv4(listOf(v6), v6))
        assertEquals(null, OmpDiscovery.pickIpv4(null, null))
    }

    @Test
    fun retriesAFailedResolveOnceWhileTimeIsLeft() {
        org.junit.Assert.assertTrue(OmpDiscovery.shouldRetry(0, true, 2000))
        org.junit.Assert.assertFalse(OmpDiscovery.shouldRetry(1, true, 2000))
        org.junit.Assert.assertFalse(OmpDiscovery.shouldRetry(0, false, 2000))
        org.junit.Assert.assertFalse(OmpDiscovery.shouldRetry(0, true, 100))
    }

    @Test
    fun fallsBackForBlank() {
        assertEquals("Android TV", OmpDiscovery.cleanName(null))
        assertEquals("Android TV", OmpDiscovery.cleanName("  "))
    }
}
