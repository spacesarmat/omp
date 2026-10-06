package com.spacesarmat.omp

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvKeysTest {
    @Test
    fun colourKeysAreTheLgOnes() {
        assertEquals(403, TvKeys.webCode(KeyEvent.KEYCODE_PROG_RED))
        assertEquals(404, TvKeys.webCode(KeyEvent.KEYCODE_PROG_GREEN))
        assertEquals(405, TvKeys.webCode(KeyEvent.KEYCODE_PROG_YELLOW))
        assertEquals(406, TvKeys.webCode(KeyEvent.KEYCODE_PROG_BLUE))
        assertEquals(183, KeyEvent.KEYCODE_PROG_RED)
        assertEquals(186, KeyEvent.KEYCODE_PROG_BLUE)
    }

    @Test
    fun mediaKeysStayAndOthersPassThrough() {
        assertEquals(415, TvKeys.webCode(KeyEvent.KEYCODE_MEDIA_PLAY))
        assertEquals(33, TvKeys.webCode(KeyEvent.KEYCODE_CHANNEL_UP))
        assertNull(TvKeys.webCode(KeyEvent.KEYCODE_DPAD_CENTER))
        assertNull(TvKeys.webCode(KeyEvent.KEYCODE_BACK))
        assertNull(TvKeys.webCode(KeyEvent.KEYCODE_F1))
    }
}
