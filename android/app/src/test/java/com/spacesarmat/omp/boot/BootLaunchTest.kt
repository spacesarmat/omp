package com.spacesarmat.omp.boot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BootLaunchTest {
    @Test
    fun coldBootAndQuickBootLaunch() {
        assertTrue(BootLaunch.isBootAction(BootLaunch.ACTION_BOOT_COMPLETED))
        assertTrue(BootLaunch.isBootAction(BootLaunch.ACTION_QUICKBOOT_POWERON))
        assertTrue(BootLaunch.isBootAction(BootLaunch.ACTION_HTC_QUICKBOOT_POWERON))
    }

    @Test
    fun lockedBootScreenOnAndDreamDoNotLaunch() {
        assertFalse(BootLaunch.isBootAction(BootLaunch.ACTION_LOCKED_BOOT_COMPLETED))
        assertFalse(BootLaunch.isBootAction(BootLaunch.ACTION_SCREEN_ON))
        assertFalse(BootLaunch.isBootAction(BootLaunch.ACTION_DREAMING_STOPPED))
        assertFalse(BootLaunch.isBootAction("android.intent.action.DREAM_STOPPED"))
        assertFalse(BootLaunch.isBootAction("android.intent.action.MY_PACKAGE_REPLACED"))
        assertFalse(BootLaunch.isBootAction(null))
        assertFalse(BootLaunch.isBootAction(""))
    }

    @Test
    fun phonesNeverLaunchAndAnUnsetSwitchIsOn() {
        assertTrue(BootLaunch.shouldLaunch(isTv = true, enabled = null))
        assertTrue(BootLaunch.shouldLaunch(isTv = true, enabled = true))
        assertFalse(BootLaunch.shouldLaunch(isTv = true, enabled = false))
        assertFalse(BootLaunch.shouldLaunch(isTv = false, enabled = null))
        assertFalse(BootLaunch.shouldLaunch(isTv = false, enabled = true))
        assertFalse(BootLaunch.shouldLaunch(isTv = false, enabled = false))
    }

    @Test
    fun outcomeCoversPhoneDisabledAndOtherActions() {
        assertEquals(BootLaunch.Outcome.LAUNCH, BootLaunch.outcome(BootLaunch.ACTION_BOOT_COMPLETED, isTv = true, enabled = null))
        assertEquals(BootLaunch.Outcome.LAUNCH, BootLaunch.outcome(BootLaunch.ACTION_QUICKBOOT_POWERON, isTv = true, enabled = true))
        assertEquals(BootLaunch.Outcome.LAUNCH, BootLaunch.outcome(BootLaunch.ACTION_HTC_QUICKBOOT_POWERON, isTv = true, enabled = null))
        assertEquals(BootLaunch.Outcome.DISABLED, BootLaunch.outcome(BootLaunch.ACTION_BOOT_COMPLETED, isTv = true, enabled = false))
        assertEquals(BootLaunch.Outcome.PHONE, BootLaunch.outcome(BootLaunch.ACTION_BOOT_COMPLETED, isTv = false, enabled = null))
        assertEquals(BootLaunch.Outcome.PHONE, BootLaunch.outcome(BootLaunch.ACTION_QUICKBOOT_POWERON, isTv = false, enabled = true))
        assertEquals(BootLaunch.Outcome.NOT_BOOT, BootLaunch.outcome(BootLaunch.ACTION_SCREEN_ON, isTv = true, enabled = null))
        assertEquals(BootLaunch.Outcome.NOT_BOOT, BootLaunch.outcome(BootLaunch.ACTION_LOCKED_BOOT_COMPLETED, isTv = false, enabled = true))
        assertEquals(BootLaunch.Outcome.NOT_BOOT, BootLaunch.outcome(BootLaunch.ACTION_DREAMING_STOPPED, isTv = true, enabled = true))
    }

    @Test
    fun overlayPromptOnlyWhenTurningOnAfterABlockedLaunch() {
        assertFalse(BootLaunch.needsOverlayPrompt(sdkInt = 36, canDrawOverlays = false, launchBlocked = true, enabling = false))
        assertFalse(BootLaunch.needsOverlayPrompt(sdkInt = 36, canDrawOverlays = false, launchBlocked = false, enabling = true))
        assertFalse(BootLaunch.needsOverlayPrompt(sdkInt = 36, canDrawOverlays = true, launchBlocked = true, enabling = true))
        assertFalse(BootLaunch.needsOverlayPrompt(sdkInt = 28, canDrawOverlays = false, launchBlocked = true, enabling = true))
        assertTrue(BootLaunch.needsOverlayPrompt(sdkInt = 29, canDrawOverlays = false, launchBlocked = true, enabling = true))
        assertTrue(BootLaunch.needsOverlayPrompt(sdkInt = 36, canDrawOverlays = false, launchBlocked = true, enabling = true))
    }

    @Test
    fun aStaleSuccessDoesNotClearANewerAttempt() {
        val first = BootLaunch.nextAttempt(BootLaunch.AttemptState())
        assertEquals(1L, first.attempt)
        assertTrue(first.blocked)
        assertFalse(BootLaunch.afterSuccess(first, 1L).blocked)
        val second = BootLaunch.nextAttempt(BootLaunch.afterSuccess(first, 1L))
        assertEquals(2L, second.attempt)
        assertTrue(second.blocked)
        assertTrue(BootLaunch.afterSuccess(second, 1L).blocked)
        assertFalse(BootLaunch.afterSuccess(second, 2L).blocked)
        assertTrue(BootLaunch.afterSuccess(second, 0L).blocked)
    }
}
