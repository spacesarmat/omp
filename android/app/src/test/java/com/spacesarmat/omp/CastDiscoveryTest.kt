package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CastDiscoveryTest {
    private fun attrs(vararg kv: Pair<String, String?>): Map<String, ByteArray?> =
        kv.associate { (k, v) -> k to v?.toByteArray(Charsets.UTF_8) }

    @Test
    fun readsFriendlyNameAndModel() {
        val tv = CastDiscovery.fromTxt(
            "192.168.1.9",
            "Chromecast-0123456789abcdef0123456789abcdef",
            attrs("fn" to "Спальня", "md" to "Chromecast HD", "id" to "0123"),
        )
        assertEquals(FoundCastTv("192.168.1.9", "Спальня", "Chromecast HD"), tv)
    }

    @Test
    fun fallsBackToTheServiceNameWithoutItsId() {
        val tv = CastDiscovery.fromTxt("10.0.0.2", "BRAVIA-4K-VH2-1a2b3c4d5e6f7a8b9c0d1e2f", attrs("md" to "BRAVIA 4K VH2"))
        assertEquals("BRAVIA 4K VH2", tv.name)
        assertEquals("BRAVIA 4K VH2", tv.model)
    }

    @Test
    fun fallsBackToTheModelThenAndroidTv() {
        assertEquals("MIBOX4", CastDiscovery.fromTxt("10.0.0.2", "0123456789abcdef0123", attrs("md" to "MIBOX4")).name)
        val bare = CastDiscovery.fromTxt("10.0.0.2", null, null)
        assertEquals("Android TV", bare.name)
        assertNull(bare.model)
    }

    @Test
    fun blankAndControlCharactersAreDropped() {
        assertNull(CastDiscovery.txt(attrs("fn" to "  "), "fn"))
        assertNull(CastDiscovery.txt(attrs("fn" to null), "fn"))
        assertNull(CastDiscovery.txt(null, "fn"))
        assertEquals("Кухня", CastDiscovery.txt(attrs("fn" to "Кух\u0000ня\n"), "fn"))
        assertEquals(80, CastDiscovery.txt(attrs("fn" to "x".repeat(200)), "fn")!!.length)
    }

    @Test
    fun decodesEscapedServiceNames() {
        assertEquals("Living Room TV", CastDiscovery.nameFromService("Living\\032Room\\032TV"))
        assertNull(CastDiscovery.nameFromService(""))
        assertNull(CastDiscovery.nameFromService("0123456789abcdef0123"))
    }

    @Test
    fun probeAllowsOnlyHomeNetworksAndKnownPorts() {
        assertTrue(PortProbe.isPrivateIpv4("192.168.1.5"))
        assertTrue(PortProbe.isPrivateIpv4("10.1.2.3"))
        assertTrue(PortProbe.isPrivateIpv4("172.20.0.1"))
        assertFalse(PortProbe.isPrivateIpv4("172.32.0.1"))
        assertFalse(PortProbe.isPrivateIpv4("8.8.8.8"))
        assertFalse(PortProbe.isPrivateIpv4("192.168.1"))
        assertFalse(PortProbe.isPrivateIpv4("localhost"))
        assertEquals(listOf(9922, 9991), PortProbe.allowedPorts(listOf(9922, 22, 9991, 9922, 80)))
        assertEquals(emptyList<Int>(), PortProbe.open("8.8.8.8", listOf(9922), 100))
        assertEquals(emptyList<Int>(), PortProbe.open("192.168.1.5", listOf(22), 100))
    }
}
