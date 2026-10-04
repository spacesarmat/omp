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

    // ---- the switch through PlayerSession (no video) ----

    /** The activity's part: «Авто» decides, the failing engine is replaced by a new one at the same position. */
    private class AutoUi(val chooser: EngineChooser, val vlc: FakeEngine) : PlayerSession.Ui {
        lateinit var session: PlayerSession
        var switched = 0

        override fun changed() = Unit

        override fun itemEnded() = Unit

        override fun engineFailed(kind: ErrorKind, beforeFirstFrame: Boolean): Boolean {
            if (!chooser.onError(kind, !beforeFirstFrame)) return false
            switched++
            session.switchEngine(vlc)
            return true
        }
    }

    private fun request(startMs: Long) = PlayRequest(
        queue = listOf(QueueItem("http://h/0", "Серия 1", "abc", 0, emptyList(), 0), QueueItem("http://h/1", "Серия 2", "abc", 1, emptyList(), 0)),
        index = 0,
        startAtMs = startMs,
        seekStep = 10,
        autoNext = true,
        audioLang = "ru",
        subLang = "ru",
        subtitlesOn = false,
        session = 3,
    )

    @Test
    fun autoMovesTheItemToVlcAtTheSamePositionWithoutAnError() {
        val media3 = FakeEngine()
        val vlc = FakeEngine()
        val chooser = EngineChooser(EngineMode.AUTO)
        chooser.initial(false)
        val ui = AutoUi(chooser, vlc)
        val session = PlayerSession(media3, ui)
        ui.session = session
        session.load(request(startMs = 754_000))
        media3.listener?.onError(ErrorKind.UNSUPPORTED_FORMAT, "ERROR_CODE_DECODING_FORMAT_UNSUPPORTED")
        assertEquals(1, ui.switched)
        assertTrue(media3.released)
        assertTrue(session.engine === vlc)
        assertEquals("http://h/0", vlc.opened.single().first.url)
        assertEquals(754_000L, vlc.opened.single().second)
        assertEquals(null, session.error)
        // VLC failing too: the error is shown, no second switch
        vlc.listener?.onError(ErrorKind.UNSUPPORTED_FORMAT, "vlc_error")
        assertEquals(1, ui.switched)
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, session.error)
    }

    @Test
    fun anErrorAfterTheFirstFrameStaysOnMedia3() {
        val media3 = FakeEngine()
        val chooser = EngineChooser(EngineMode.AUTO)
        chooser.initial(false)
        val ui = AutoUi(chooser, FakeEngine())
        val session = PlayerSession(media3, ui)
        ui.session = session
        session.load(request(startMs = 0))
        media3.listener?.onFirstFrame()
        media3.listener?.onError(ErrorKind.DECODER, "ERROR_CODE_DECODING_FAILED")
        assertEquals(0, ui.switched)
        assertFalse(media3.released)
        assertEquals(ErrorKind.DECODER, session.error)
    }

    @Test
    fun aNewQueueOnAnotherEngineReleasesThePreviousOne() {
        val media3 = FakeEngine()
        val vlc = FakeEngine()
        val session = PlayerSession(media3, AutoUi(EngineChooser(EngineMode.BUILTIN), FakeEngine()))
        session.load(request(startMs = 0))
        session.load(request(startMs = 5_000), vlc)
        assertTrue(media3.released)
        assertTrue(session.engine === vlc)
        assertTrue(vlc.listener === session)
        assertEquals(5_000L, vlc.opened.single().second)
        assertEquals(TrackPrefs("ru", "ru", false), vlc.prefs)
    }
}
