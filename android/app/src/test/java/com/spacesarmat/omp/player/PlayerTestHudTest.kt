package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Beta gate for the native player codes. A stable version stays dark even if the page asked. */
class PlayerTestHudTest {
    @Test
    fun labelsFollowBetaAndThePageSwitch() {
        assertTrue(PlayerTestHud.enabled("0.20.6-beta.1", true))
        assertTrue(PlayerTestHud.enabled("0.20.6-beta.12-test", true))
        assertFalse(PlayerTestHud.enabled("0.20.6-beta.1", false))
        assertFalse(PlayerTestHud.enabled("0.20.5", true))
        assertFalse(PlayerTestHud.enabled("0.20.5-test", true))
        assertFalse(PlayerTestHud.enabled("0.20.6-beta", true))
        assertFalse(PlayerTestHud.enabled("", true))
    }

    @Test
    fun labelSizeFollowsThePagePx() {
        assertEquals(20f, PlayerTestHud.sizeDp(20), 0f)
        assertEquals(16f, PlayerTestHud.sizeDp(16), 0f)
        assertEquals(36f, PlayerTestHud.sizeDp(36), 0f)
        assertEquals(12f, PlayerTestHud.sizeDp(12), 0f)
        assertEquals(36f, PlayerTestHud.sizeDp(80), 0f)
        assertEquals(8f, PlayerTestHud.sizeDp(3), 0f)
        assertEquals(20f, PlayerTestHud.sizeDp(null), 0f)
        assertEquals(20f, PlayerTestHud.sizeDp(0), 0f)
    }
}
