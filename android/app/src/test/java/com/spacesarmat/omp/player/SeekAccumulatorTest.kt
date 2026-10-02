package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Mirrors tests/player/seek.test.ts (seconds there, ms here). */
class SeekAccumulatorTest {
    private var now = 0L
    private val acc = SeekAccumulator({ now })

    @Test
    fun stepAcceleratesEvery4RepeatsUpToX6() {
        assertEquals(10, seekStep(10, 0))
        assertEquals(10, seekStep(10, 3))
        assertEquals(20, seekStep(10, 4))
        assertEquals(60, seekStep(10, 100))
    }

    @Test
    fun accumulatesPresses() {
        assertEquals(110_000L, acc.press(1, 100_000, 1_000_000, 10))
        now = 100
        assertEquals(120_000L, acc.press(1, 100_000, 1_000_000, 10))
        assertEquals(120_000L, acc.pending())
        assertEquals(120_000L, acc.take())
        assertNull(acc.pending())
    }

    @Test
    fun accelerationAfterFourRepeats() {
        var t = 0L
        for (i in 0 until 4) { t = acc.press(1, 0, 10_000_000, 10); now += 100 }
        assertEquals(40_000L, t)
        assertEquals(60_000L, acc.press(1, 0, 10_000_000, 10))
    }

    @Test
    fun repeatWindowIs900ms() {
        // 4 presses 899 ms apart are repeats: the 5th (repeat 4) steps 20 s
        for (i in 0 until 4) { acc.press(1, 0, 10_000_000, 10); now += 899 }
        assertEquals(60_000L, acc.press(1, 0, 10_000_000, 10))
        acc.cancel()
        // 900 ms apart: never a repeat, always the base step
        for (i in 0 until 4) { acc.press(1, 0, 10_000_000, 10); now += 900 }
        assertEquals(50_000L, acc.press(1, 0, 10_000_000, 10))
    }

    @Test
    fun clampsToZeroAndDurationMinusOne() {
        assertEquals(0L, acc.press(-1, 5_000, 1_000_000, 10))
        acc.cancel()
        assertEquals(999_000L, acc.press(1, 995_000, 1_000_000, 10))
    }

    @Test
    fun takeAndCancelResetAcceleration() {
        for (i in 0 until 5) { acc.press(1, 0, 10_000_000, 10); now += 100 }
        acc.take()
        now += 100
        assertEquals(10_000L, acc.press(1, 0, 10_000_000, 10))
        for (i in 0 until 5) { acc.press(1, 0, 10_000_000, 10); now += 100 }
        acc.cancel()
        now += 100
        assertEquals(10_000L, acc.press(1, 0, 10_000_000, 10))
        acc.cancel()
        assertNull(acc.take())
    }
}
