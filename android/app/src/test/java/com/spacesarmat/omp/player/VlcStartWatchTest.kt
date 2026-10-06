package com.spacesarmat.omp.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VlcStartWatchTest {
    /** Ticks every 500 ms from [from] to [to] (ms) at position [pos]; true if any tick asked. */
    private fun run(w: VlcStartWatch, key: Any, from: Long, to: Long, pos: (Long) -> Long, playing: Boolean = true): Boolean {
        var asked = false
        var t = from
        while (t <= to) {
            if (w.tick(playing, key, pos(t), t)) asked = true
            t += 500
        }
        return asked
    }

    @Test
    fun aStuckStartAsksAfter20Seconds() {
        val w = VlcStartWatch()
        // «0:27 / 0:00»: the position stays where the item opened
        assertFalse(run(w, "a", 0, 19_500, { 27_000L }))
        assertTrue(w.tick(true, "a", 27_000, 20_500))
        // asked once
        assertFalse(w.tick(true, "a", 27_000, 21_000))
    }

    @Test
    fun playbackThatMovesIsNeverAsked() {
        val w = VlcStartWatch()
        assertFalse(run(w, "a", 0, 60_000, { t -> 27_000L + t }))
    }

    @Test
    fun pausedTimeDoesNotCount() {
        val w = VlcStartWatch()
        assertFalse(run(w, "a", 0, 60_000, { 0L }, playing = false))
        assertFalse(run(w, "a", 60_500, 79_500, { 0L }))
        assertTrue(run(w, "a", 80_000, 81_000, { 0L }))
    }

    @Test
    fun waitGivesAnother20SecondsAndANewItemStartsOver() {
        val w = VlcStartWatch()
        assertTrue(run(w, "a", 0, 21_000, { 0L }))
        w.waitMore()
        assertFalse(run(w, "a", 21_500, 40_500, { 0L }))
        assertTrue(run(w, "a", 41_000, 42_000, { 0L }))
        // another engine / item: the clock starts again
        assertFalse(run(w, "b", 42_500, 60_000, { 0L }))
    }
}
