package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the LG rule (introChapter in tests/player/chapters.test.ts): [start, end - 1 s). */
class IntroSkipTest {
    private val s = IntroSkip().apply { set(0, 60_000, 150_000) }

    @Test
    fun dueInsideTheIntroOnly() {
        assertFalse(s.due(0, 59_999))
        assertTrue(s.due(0, 60_000))
        assertTrue(s.due(0, 148_999))
        assertFalse(s.due(0, 149_000))
        assertFalse(s.due(0, 200_000))
    }

    @Test
    fun otherItemsHaveNoIntro() {
        assertFalse(s.due(1, 100_000))
        assertNull(s.target(1))
    }

    @Test
    fun okSeeksToTheEndOfTheIntro() {
        assertEquals(150_000L, s.target(0))
    }

    @Test
    fun dismissHidesOnlyThatIntro() {
        s.set(1, 10_000, 90_000)
        s.dismiss(0)
        assertFalse(s.due(0, 100_000))
        assertTrue(s.due(1, 20_000))
        // a new segment start for the same item shows the button again
        s.set(0, 70_000, 150_000)
        assertTrue(s.due(0, 100_000))
    }

    @Test
    fun badSegmentsAreIgnored() {
        val e = IntroSkip()
        e.set(0, 5_000, 5_000)
        e.set(0, -1, 5_000)
        e.set(-1, 0, 5_000)
        assertNull(e.segment(0))
        assertFalse(e.due(0, 5_000))
    }

    @Test
    fun clearForgetsEverything() {
        s.dismiss(0)
        s.clear()
        assertFalse(s.due(0, 100_000))
    }
}
