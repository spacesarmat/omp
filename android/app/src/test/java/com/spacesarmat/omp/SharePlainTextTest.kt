package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SharePlainTextTest {
    @Test
    fun keepsATitleLink() {
        val text = "Институт\n2026\nСезон 2 выходит 8 нояб.\nhttps://omp-player.online/t/tv/9/s/2"
        assertEquals(text, sharePlainText(text))
    }

    @Test
    fun refusesEmptyAndMagnets() {
        assertNull(sharePlainText(null))
        assertNull(sharePlainText("  "))
        assertNull(sharePlainText("magnet:?xt=urn:btih:abc"))
        assertNull(sharePlainText("see xt=urn:btih:abc"))
        assertNull(sharePlainText("x".repeat(4001)))
    }
}
