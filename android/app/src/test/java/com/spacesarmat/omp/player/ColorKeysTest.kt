package com.spacesarmat.omp.player

import android.view.KeyEvent
import com.spacesarmat.omp.I18n
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Colour keys of the player: Red audio list, Green subtitles list, Yellow night sound, Blue menu, Info «Инфо». */
class ColorKeysTest {
    @Before
    fun ru() {
        I18n.lang = "ru"
    }

    @After
    fun back() {
        I18n.lang = "ru"
    }

    @Test
    fun keysMapToActions() {
        assertEquals(ColorAction.AUDIO, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_RED))
        assertEquals(ColorAction.SUBS, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_GREEN))
        assertEquals(ColorAction.NIGHT, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_YELLOW))
        assertEquals(ColorAction.INFO, ColorKeys.actionFor(KeyEvent.KEYCODE_INFO))
        assertEquals(ColorAction.MENU, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_BLUE))
        assertNull(ColorKeys.actionFor(KeyEvent.KEYCODE_DPAD_UP))
        assertNull(ColorKeys.actionFor(KeyEvent.KEYCODE_DPAD_CENTER))
    }

    @Test
    fun phoneRemoteKeysByName() {
        assertEquals(KeyEvent.KEYCODE_PROG_RED, ColorKeys.remoteCode("RED"))
        assertEquals(KeyEvent.KEYCODE_PROG_GREEN, ColorKeys.remoteCode("GREEN"))
        assertEquals(KeyEvent.KEYCODE_PROG_YELLOW, ColorKeys.remoteCode("YELLOW"))
        assertEquals(KeyEvent.KEYCODE_PROG_BLUE, ColorKeys.remoteCode("BLUE"))
        assertEquals(KeyEvent.KEYCODE_INFO, ColorKeys.remoteCode("INFO"))
        assertEquals(KeyEvent.KEYCODE_MENU, ColorKeys.remoteCode("MENU"))
        assertNull(ColorKeys.remoteCode("CATALOG"))
    }

    @Test
    fun aKeyClosesItsOwnWindow() {
        // Red over the audio list (opened by Red or from the menu): only closes it
        assertNull(ColorKeys.inDialog(ColorAction.AUDIO, ColorAction.AUDIO))
        assertNull(ColorKeys.inDialog(ColorAction.SUBS, ColorAction.SUBS))
        assertNull(ColorKeys.inDialog(ColorAction.MENU, ColorAction.MENU))
    }

    @Test
    fun anotherKeyClosesAndOpensItsOwn() {
        assertEquals(ColorAction.AUDIO, ColorKeys.inDialog(ColorAction.AUDIO, ColorAction.SUBS))
        assertEquals(ColorAction.SUBS, ColorKeys.inDialog(ColorAction.SUBS, ColorAction.AUDIO))
        assertEquals(ColorAction.SUBS, ColorKeys.inDialog(ColorAction.SUBS, ColorAction.MENU))
        assertEquals(ColorAction.INFO, ColorKeys.inDialog(ColorAction.INFO, ColorAction.AUDIO))
        assertEquals(ColorAction.NIGHT, ColorKeys.inDialog(ColorAction.NIGHT, ColorAction.MENU))
        assertEquals(ColorAction.AUDIO, ColorKeys.inDialog(ColorAction.AUDIO, null))
        // Blue over a list only closes it, as before
        assertNull(ColorKeys.inDialog(ColorAction.MENU, ColorAction.AUDIO))
        assertNull(ColorKeys.inDialog(ColorAction.MENU, null))
    }

    @Test
    fun aHeldKeyActsOnce() {
        assertTrue(colorKeyActs(0))
        assertTrue(!colorKeyActs(1))
        assertTrue(!colorKeyActs(12))
    }

    @Test
    fun nightLabels() {
        assertEquals("Ночной звук: Вкл", ColorKeys.nightLabel(true))
        assertEquals("Ночной звук: Выкл", ColorKeys.nightLabel(false))
        assertEquals("Ночной звук недоступен", ColorKeys.nightUnavailable())
    }

    @Test
    fun hintHasADotPerEntry() {
        val full = ColorKeys.hint(true)
        assertEquals("● аудио · ● субтитры · ● ночной звук · ● меню · Info — инфо", full.text)
        assertEquals(listOf(ColorKeys.RED, ColorKeys.GREEN, ColorKeys.YELLOW, ColorKeys.BLUE), full.dots)
        assertEquals(full.text.count { it == '●' }, full.dots.size)
        val vlc = ColorKeys.hint(false)
        assertFalse(vlc.text.contains("ночной"))
        assertEquals(listOf(ColorKeys.RED, ColorKeys.GREEN, ColorKeys.BLUE), vlc.dots)
        assertEquals(vlc.text.count { it == '●' }, vlc.dots.size)
        I18n.lang = "en"
        assertEquals("● audio · ● subtitles · ● night sound · ● menu · Info — info", ColorKeys.hint(true).text)
        val cyr = Regex("[\u0400-\u04FF]")
        assertTrue(cyr.find(ColorKeys.hint(true).text) == null)
        assertTrue(cyr.find(ColorKeys.nightUnavailable()) == null)
    }
}
