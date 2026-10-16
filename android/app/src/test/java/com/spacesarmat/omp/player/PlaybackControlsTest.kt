package com.spacesarmat.omp.player

import android.content.pm.PackageManager
import androidx.media3.common.Player
import com.spacesarmat.omp.I18n
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Manifest contract and notification actions for the phone's foreground PlaybackService. No device. */
class PlaybackControlsTest {
    @Test
    fun serviceRunsOnlyAfterThePhoneEnablesIt() {
        assertEquals(Embedded2160.PLAYBACK_SERVICE, PlaybackControls.SERVICE)
        assertFalse(PlaybackControls.componentRuns(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT))
        assertFalse(PlaybackControls.componentRuns(PackageManager.COMPONENT_ENABLED_STATE_DISABLED))
        assertFalse(PlaybackControls.componentRuns(PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER))
        assertFalse(PlaybackControls.componentRuns(PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED))
        assertTrue(PlaybackControls.componentRuns(PackageManager.COMPONENT_ENABLED_STATE_ENABLED))
    }

    @Test
    fun notificationIsSeekPlayPauseSeekStopWithoutASecondPlayButton() {
        assertEquals(listOf("seekBack", "playPause", "seekForward", "stop"), PlaybackControls.notificationActions)
        assertEquals(
            listOf(Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_FORWARD, Player.COMMAND_STOP),
            PlaybackControls.preferenceCommands,
        )
        assertFalse(PlaybackControls.preferenceCommands.contains(Player.COMMAND_PLAY_PAUSE))
    }

    @Test
    fun preferenceButtonsAreSeekBackSeekForwardAndStop() {
        I18n.lang = "en"
        val buttons = PlaybackNotification.preferenceButtons()
        assertEquals(3, buttons.size)
        assertEquals(Player.COMMAND_SEEK_BACK, buttons[0].playerCommand)
        assertEquals(Player.COMMAND_SEEK_FORWARD, buttons[1].playerCommand)
        assertEquals(Player.COMMAND_STOP, buttons[2].playerCommand)
        assertEquals("Seek backward", buttons[0].displayName.toString())
        assertEquals("Seek forward", buttons[1].displayName.toString())
        assertEquals("Stop", buttons[2].displayName.toString())
        assertFalse(buttons.any { it.playerCommand == Player.COMMAND_PLAY_PAUSE })
        I18n.lang = "ru"
    }

    @Test
    fun sessionGetterNameIsNotConfusedWithSessionId() {
        assertTrue(PlaybackControls.isSessionGetter("getSession"))
        assertTrue(PlaybackControls.isSessionGetter("getSession\$player_core"))
        assertFalse(PlaybackControls.isSessionGetter("getSessionId"))
        assertFalse(PlaybackControls.isSessionGetter("setSession"))
        assertFalse(PlaybackControls.isSessionGetter("getSessionActivity"))
    }

    @Test
    fun manifestKeepsADisabledNonExportedMediaPlaybackServiceAndDropsBluetoothValidation() {
        val xml = manifest()
        for (permission in PlaybackControls.manifestPermissions) {
            assertTrue(permission, xml.contains("android:name=\"$permission\""))
        }
        val service = element(xml, "service", PlaybackControls.SERVICE)
        assertTrue(service.contains("android:exported=\"false\""))
        assertTrue(service.contains("android:enabled=\"false\""))
        assertTrue(service.contains("android:foregroundServiceType=\"${PlaybackControls.FOREGROUND_SERVICE_TYPE}\""))
        assertTrue(service.contains("android:stopWithTask=\"true\""))
        assertTrue(service.contains("androidx.media3.session.MediaSessionService"))
        assertTrue(service.contains("tools:node=\"replace\""))
        assertFalse(service.contains("tools:node=\"remove\""))
        assertFalse(service.contains("android.media.browse.MediaBrowserService"))
        assertFalse(service.contains("android:exported=\"true\""))
        val bluetooth = element(xml, "activity", "androidx.media3.session.BluetoothValidationActivity")
        assertTrue(bluetooth.contains("tools:node=\"remove\""))
    }

    @Test
    fun mergedManifestHasOneMediaPlaybackTypeAndNoBluetoothActivity() {
        val file = File("build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml")
        assumeTrue(file.isFile)
        val xml = file.readText()
        val service = element(xml, "service", PlaybackControls.SERVICE)
        assertTrue(service.contains("android:foregroundServiceType=\"mediaPlayback\""))
        assertFalse(service.contains("mediaPlayback|"))
        assertFalse(service.contains("android.media.browse.MediaBrowserService"))
        assertTrue(service.contains("android:exported=\"false\""))
        assertTrue(service.contains("android:enabled=\"false\""))
        assertTrue(service.contains("android:stopWithTask=\"true\""))
        assertFalse(xml.contains("BluetoothValidationActivity"))
        assertEquals(1, Regex("android:name=\"${Regex.escape(PlaybackControls.SERVICE)}\"").findAll(xml).count())
    }

    @Test
    fun notificationLabelsExistInBothLanguages() {
        val keys = listOf("player.notify.seekBack", "player.notify.seekForward", "player.notify.stop")
        for (key in keys) {
            I18n.lang = "en"
            val en = I18n.s(key)
            I18n.lang = "ru"
            val ru = I18n.s(key)
            assertTrue(key, en.isNotEmpty() && en != key)
            assertTrue(key, ru.isNotEmpty() && ru != key && ru != en)
            assertFalse(key, en.any { it in '\u0400'..'\u04FF' })
        }
        I18n.lang = "ru"
    }

    private fun manifest(): String {
        val file = listOf(File("src/main/AndroidManifest.xml"), File("android/app/src/main/AndroidManifest.xml"))
            .firstOrNull { it.isFile }
            ?: error("AndroidManifest.xml not found from ${File(".").absolutePath}")
        return file.readText()
    }

    /** The element whose android:name is [name], from its opening tag through the matching close or `/>`. */
    private fun element(xml: String, tag: String, name: String): String {
        val marker = "android:name=\"$name\""
        val at = xml.indexOf(marker)
        assertTrue("$name is declared", at >= 0)
        val start = xml.lastIndexOf("<$tag", at)
        assertTrue(start >= 0)
        val close = xml.indexOf("</$tag>", at)
        val self = xml.indexOf("/>", at)
        val end = when {
            close >= 0 && (self < 0 || close < self) -> close + tag.length + 3
            self >= 0 -> self + 2
            else -> error("unclosed $tag $name")
        }
        return xml.substring(start, end)
    }
}
