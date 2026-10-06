package com.spacesarmat.omp.player

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** «Авто» / «Встроенный» / «VLC» and the automatic switch, and the switch keeping the position (fakes). */
class EngineChooserTest {
    @Test
    fun modesFromThePage() {
        assertEquals(EngineMode.AUTO, EngineMode.parse("auto"))
        assertEquals(EngineMode.BUILTIN, EngineMode.parse("builtin"))
        assertEquals(EngineMode.VLC, EngineMode.parse("vlc"))
        assertEquals(EngineMode.AUTO, EngineMode.parse(""))
        assertEquals(EngineMode.AUTO, EngineMode.parse(null))
        assertEquals(EngineMode.AUTO, EngineMode.parse("mpv"))
    }

    @Test
    fun initialEngine() {
        assertEquals(EngineKind.MEDIA3, EngineChooser(EngineMode.AUTO).initial(false))
        assertEquals(EngineKind.VLC, EngineChooser(EngineMode.AUTO).initial(true))
        assertEquals(EngineKind.MEDIA3, EngineChooser(EngineMode.BUILTIN).initial(true))
        assertEquals(EngineKind.VLC, EngineChooser(EngineMode.VLC).initial(false))
    }

    @Test
    fun autoSwitchesOnAFormatOrDecoderErrorBeforeTheFirstFrame() {
        for (kind in listOf(ErrorKind.UNSUPPORTED_FORMAT, ErrorKind.DECODER)) {
            val c = EngineChooser(EngineMode.AUTO)
            c.initial(false)
            assertTrue(c.onError(kind, firstFrame = false))
            assertEquals(EngineKind.VLC, c.current)
            // never back, never twice
            assertFalse(c.onError(kind, firstFrame = false))
            assertEquals(EngineKind.VLC, c.current)
        }
    }

    @Test
    fun noSwitchAfterTheFirstFrameOrForOtherErrors() {
        val c = EngineChooser(EngineMode.AUTO)
        c.initial(false)
        assertFalse(c.onError(ErrorKind.UNSUPPORTED_FORMAT, firstFrame = true))
        assertFalse(c.onError(ErrorKind.NETWORK, firstFrame = false))
        assertFalse(c.onError(ErrorKind.OTHER, firstFrame = false))
        assertEquals(EngineKind.MEDIA3, c.current)
    }

    @Test
    fun explicitModesNeverSwitchByThemselves() {
        val b = EngineChooser(EngineMode.BUILTIN)
        b.initial(false)
        assertFalse(b.onError(ErrorKind.UNSUPPORTED_FORMAT, firstFrame = false))
        assertFalse(b.onAssSubs())
        assertEquals(EngineKind.MEDIA3, b.current)
        val v = EngineChooser(EngineMode.VLC)
        v.initial(false)
        assertFalse(v.onError(ErrorKind.DECODER, firstFrame = false))
        assertEquals(EngineKind.VLC, v.current)
    }

    @Test
    fun autoSwitchesForAssSubtitlesOnce() {
        val c = EngineChooser(EngineMode.AUTO)
        c.initial(false)
        assertTrue(c.onAssSubs())
        assertEquals(EngineKind.VLC, c.current)
        assertFalse(c.onAssSubs())
    }

    @Test
    fun aMenuChoiceEndsTheAutomaticDecisions() {
        val c = EngineChooser(EngineMode.AUTO)
        c.initial(true)
        assertEquals(EngineKind.MEDIA3, c.toggle())
        assertFalse(c.onAssSubs())
        assertFalse(c.onError(ErrorKind.UNSUPPORTED_FORMAT, firstFrame = false))
        assertEquals(EngineKind.MEDIA3, c.current)
        assertEquals(EngineKind.VLC, c.toggle())
    }

    @Test
    fun vlcThatCannotStartEndsTheAutomaticSwitches() {
        val c = EngineChooser(EngineMode.AUTO)
        c.initial(false)
        assertTrue(c.onError(ErrorKind.UNSUPPORTED_FORMAT, firstFrame = false))
        c.fallBack(EngineKind.MEDIA3)
        assertEquals(EngineKind.MEDIA3, c.current)
        // the error is shown now, no endless retry
        assertFalse(c.onError(ErrorKind.UNSUPPORTED_FORMAT, firstFrame = false))
        assertFalse(c.onAssSubs())
    }

    @Test
    fun menuRowAndMessageTexts() {
        assertEquals("Плеер: VLC → сменить на встроенный", EngineChooser.menuRow(EngineKind.VLC))
        assertEquals("Плеер: Встроенный → сменить на VLC", EngineChooser.menuRow(EngineKind.MEDIA3))
        assertEquals("Встроенный плеер не открыл этот файл — включён VLC", EngineChooser.FORMAT_SWITCH_TEXT)
        assertEquals("builtin", EngineKind.MEDIA3.wire)
        assertEquals("vlc", EngineKind.VLC.wire)
    }

    @Test
    fun playNativeCarriesTheEngineAndTheAssFlag() {
        val q = JSONArray()
            .put(JSONObject().put("url", "http://h/0").put("title", "Серия 1").put("assSubs", true))
            .put(JSONObject().put("url", "http://h/1").put("title", "Серия 2"))
        val r = PlayRequest.parse(JSONObject().put("queue", q).put("engine", "vlc"))!!
        assertEquals(EngineMode.VLC, r.engine)
        assertTrue(r.queue[0].assSubs)
        assertFalse(r.queue[1].assSubs)
        assertEquals(EngineMode.AUTO, PlayRequest.parse(JSONObject().put("queue", q))!!.engine)
    }

    @Test
    fun withoutLibVlcEverythingStaysOnMedia3() {
        for (mode in EngineMode.values()) {
            val c = EngineChooser(mode, vlcAvailable = false)
            assertEquals(EngineKind.MEDIA3, c.initial(true))
            assertFalse(c.onError(ErrorKind.UNSUPPORTED_FORMAT, firstFrame = false))
            assertFalse(c.onAssSubs())
            assertEquals(EngineKind.MEDIA3, c.toggle())
        }
        assertEquals("Плеер: Встроенный · VLC недоступен на этом устройстве", EngineChooser.menuRow(EngineKind.MEDIA3, vlcAvailable = false))
    }

    @Test
    fun media3DecodingFailedSwitchesOnlyBeforeTheFirstFrame() {
        val c = EngineChooser(EngineMode.AUTO)
        c.initial(false)
        assertFalse(c.onError(ErrorKind.OTHER, firstFrame = true, detail = EngineChooser.DECODING_FAILED))
        assertFalse(c.onError(ErrorKind.OTHER, firstFrame = false, detail = "ERROR_CODE_UNSPECIFIED"))
        assertTrue(c.onError(ErrorKind.OTHER, firstFrame = false, detail = EngineChooser.DECODING_FAILED))
    }

    @Test
    fun outOfMemoryMovesToVlcEvenMidPlayButOnlyInAuto() {
        val c = EngineChooser(EngineMode.AUTO)
        c.initial(false)
        assertTrue(c.onError(ErrorKind.OTHER, firstFrame = true, detail = EngineChooser.OUT_OF_MEMORY))
        assertEquals(EngineKind.VLC, c.current)
        // once: VLC is not left again
        assertFalse(c.onError(ErrorKind.OTHER, firstFrame = true, detail = EngineChooser.OUT_OF_MEMORY))
        val builtin = EngineChooser(EngineMode.BUILTIN)
        builtin.initial(false)
        assertFalse(builtin.onError(ErrorKind.OTHER, firstFrame = true, detail = EngineChooser.OUT_OF_MEMORY))
        val noVlc = EngineChooser(EngineMode.AUTO, vlcAvailable = false)
        noVlc.initial(false)
        assertFalse(noVlc.onError(ErrorKind.OTHER, firstFrame = true, detail = EngineChooser.OUT_OF_MEMORY))
    }
}
