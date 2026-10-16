package com.spacesarmat.omp.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Samsung closes PiP without destroying the player. These are the pause decisions for that, for leaving
 * the activity outside PiP, and for the screen turning off. No device.
 */
class PhonePlaybackTest {
    @Test
    fun closingPipWhileStoppedPausesWhenBackgroundIsOff() {
        assertTrue(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.PIP_CHANGED,
                inPictureInPicture = false,
                resumed = false,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun closingPipKeepsPlayingWhenBackgroundIsOn() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = true,
                leave = PhonePlayback.Leave.PIP_CHANGED,
                inPictureInPicture = false,
                resumed = false,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun expandingPipBackToThePlayerDoesNotPause() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.PIP_CHANGED,
                inPictureInPicture = false,
                resumed = true,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun pipChangeWhileTheActivityIsFinishingDoesNotPauseAgain() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.PIP_CHANGED,
                inPictureInPicture = false,
                resumed = false,
                finishing = true,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun enteringPipOnHomeDoesNotPause() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.STOP,
                inPictureInPicture = true,
                resumed = false,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun stoppingOutsidePipPausesWhenBackgroundIsOff() {
        assertTrue(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.STOP,
                inPictureInPicture = false,
                resumed = false,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun stoppingOutsidePipKeepsPlayingWhenBackgroundIsOn() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = true,
                leave = PhonePlayback.Leave.STOP,
                inPictureInPicture = false,
                resumed = false,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun rotationDoesNotPause() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.STOP,
                inPictureInPicture = false,
                resumed = false,
                finishing = false,
                changingConfigurations = true,
            ),
        )
    }

    @Test
    fun screenOffPausesWhenBackgroundIsOffEvenInPip() {
        assertTrue(
            PhonePlayback.shouldPause(
                backgroundPlayback = false,
                leave = PhonePlayback.Leave.SCREEN_OFF,
                inPictureInPicture = true,
                resumed = false,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }

    @Test
    fun screenOffKeepsPlayingWhenBackgroundIsOn() {
        assertFalse(
            PhonePlayback.shouldPause(
                backgroundPlayback = true,
                leave = PhonePlayback.Leave.SCREEN_OFF,
                inPictureInPicture = true,
                resumed = true,
                finishing = false,
                changingConfigurations = false,
            ),
        )
    }
}
