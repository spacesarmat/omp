package com.spacesarmat.omp.player

import android.view.KeyEvent
import com.spacesarmat.omp.I18n
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Colour keys of the player: Red audio list, Green subtitles list, Yellow / Info «Инфо», Blue menu. */
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
        assertEquals(ColorAction.INFO, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_YELLOW))
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
    fun overAnOpenListBlueOnlyClosesOthersAct() {
        assertNull(ColorKeys.inDialog(ColorAction.MENU))
        assertEquals(ColorAction.AUDIO, ColorKeys.inDialog(ColorAction.AUDIO))
        assertEquals(ColorAction.SUBS, ColorKeys.inDialog(ColorAction.SUBS))
        assertEquals(ColorAction.INFO, ColorKeys.inDialog(ColorAction.INFO))
    }

    @Test
    fun aHeldKeyActsOnce() {
        assertTrue(colorKeyActs(0))
        assertTrue(!colorKeyActs(1))
        assertTrue(!colorKeyActs(12))
    }

    @Test
    fun hintHasADotPerKey() {
        val h = ColorKeys.hint()
        assertEquals("● аудио · ● субтитры · ● инфо · ● меню", h.text)
        assertEquals(listOf(ColorKeys.RED, ColorKeys.GREEN, ColorKeys.YELLOW, ColorKeys.BLUE), h.dots)
        assertEquals(h.text.count { it == '●' }, h.dots.size)
        I18n.lang = "en"
        assertEquals("● audio · ● subtitles · ● info · ● menu", ColorKeys.hint().text)
        assertTrue(Regex("[\\u0400-\\u04FF]").find(ColorKeys.hint().text) == null)
    }
}
