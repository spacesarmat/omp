package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Test

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

    @Test
    fun fallsBackForBlank() {
        assertEquals("Android TV", OmpDiscovery.cleanName(null))
        assertEquals("Android TV", OmpDiscovery.cleanName("  "))
    }
}
