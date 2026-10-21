package com.spacesarmat.omp.player

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
}
