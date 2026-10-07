package com.spacesarmat.omp.player

import android.view.KeyEvent
import com.spacesarmat.omp.I18n
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ColorKeysTest {
    @Before
    fun ru() {
        I18n.lang = "ru"
    }

    private fun audio(selected: Int, n: Int) =
        TrackOptions.audio((0 until n).map { EngineTrack("a$it", "ru", null, "AC3", 2, it == selected) })

    @Test
    fun keysMapToActions() {
        assertEquals(ColorAction.AUDIO, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_RED))
        assertEquals(ColorAction.SUBS, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_GREEN))
        assertEquals(ColorAction.NIGHT, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_YELLOW))
        assertEquals(ColorAction.MENU, ColorKeys.actionFor(KeyEvent.KEYCODE_PROG_BLUE))
        assertNull(ColorKeys.actionFor(KeyEvent.KEYCODE_DPAD_UP))
        assertNull(ColorKeys.actionFor(KeyEvent.KEYCODE_DPAD_CENTER))
    }

    @Test
    fun audioCyclesAndWraps() {
        assertEquals(1, ColorKeys.nextAudio(audio(0, 3)))
        assertEquals(0, ColorKeys.nextAudio(audio(2, 3)))
        assertNull(ColorKeys.nextAudio(audio(0, 1)))
        assertNull(ColorKeys.nextAudio(emptyList()))
    }

    private fun subs(selected: Int?, n: Int) = TrackOptions.subs(
        (0 until n).map { EngineTrack("s$it", "ru", null, selected = it == selected) }, emptyList(),
    )

    @Test
    fun subtitlesGoOffThenTracksThenOff() {
        assertEquals("e0", ColorKeys.nextSub(subs(null, 2))!!.value)
        assertEquals("e1", ColorKeys.nextSub(subs(0, 2))!!.value)
        assertEquals("off", ColorKeys.nextSub(subs(1, 2))!!.value)
        assertNull(ColorKeys.nextSub(subs(null, 0)))
    }

    @Test
    fun labelsUseTheMenuFormat() {
        assertEquals("Аудио: Русский · AC3 2.0", ColorKeys.audioLabel(audio(0, 1)[0].label))
        assertEquals("Субтитры: Выкл", ColorKeys.subsLabel(I18n.s("player.off")))
        assertEquals("Ночной звук: Вкл", ColorKeys.nightLabel(true))
        assertEquals("Ночной звук: Выкл", ColorKeys.nightLabel(false))
        assertEquals("Ночной звук недоступен", ColorKeys.nightUnavailable())
    }

    @Test
    fun hintHasADotPerEntry() {
        val full = ColorKeys.hint(true)
        assertEquals("● аудио · ● субтитры · ● ночной звук · ● меню", full.text)
        assertEquals(listOf(ColorKeys.RED, ColorKeys.GREEN, ColorKeys.YELLOW, ColorKeys.BLUE), full.dots)
        val vlc = ColorKeys.hint(false)
        assertFalse(vlc.text.contains("ночной"))
        assertEquals(listOf(ColorKeys.RED, ColorKeys.GREEN, ColorKeys.BLUE), vlc.dots)
        assertEquals(vlc.text.count { it == '●' }, vlc.dots.size)
        I18n.lang = "en"
        val cyr = Regex("[\\u0400-\\u04FF]")
        assertTrue(cyr.find(ColorKeys.hint(true).text) == null)
        assertTrue(cyr.find(ColorKeys.nightUnavailable()) == null)
    }
}
