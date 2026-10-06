package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class PlayerBufferTest {
    private val mb = 1024 * 1024

    @Test
    fun aQuarterOfTheHeapBetween16And64Mb() {
        assertEquals(32 * mb, PlayerBuffer.capBytes(128))
        assertEquals(64 * mb, PlayerBuffer.capBytes(512))
        assertEquals(16 * mb, PlayerBuffer.capBytes(48))
        assertEquals(64 * mb, PlayerBuffer.capBytes(256))
        // no memory class known: the floor
        assertEquals(16 * mb, PlayerBuffer.capBytes(0))
    }

    @Test
    fun anOomAnywhereInTheCauseChainCounts() {
        val oom = OutOfMemoryError("Failed to allocate a 65552 byte allocation")
        assertTrue(PlayerBuffer.causedByOom(oom))
        assertTrue(PlayerBuffer.causedByOom(RuntimeException("Source error", IllegalStateException("Unexpected", oom))))
        assertFalse(PlayerBuffer.causedByOom(IOException("reset")))
        assertFalse(PlayerBuffer.causedByOom(null))
    }
}
