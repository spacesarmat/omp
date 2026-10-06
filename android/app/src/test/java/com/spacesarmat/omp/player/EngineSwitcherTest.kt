package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The activity's engine decisions ([EngineSwitcher]) over fake engines and a fake host (no Android, no video). */
class EngineSwitcherTest {
    private class Host : EngineSwitcher.Host {
        override var finishing = false
        var vlcFails = false
        val created = ArrayList<Pair<EngineKind, FakeEngine>>()
        val posted = ArrayList<() -> Unit>()
        val ass = HashSet<Int>()
        var beforeSwitch = 0
        val switched = ArrayList<Pair<EngineKind, SwitchReason>>()
        val messages = ArrayList<String>()

        override fun create(kind: EngineKind): PlayerEngine? {
            if (kind == EngineKind.VLC && vlcFails) return null
            return FakeEngine().also { created.add(kind to it) }
        }

        override fun post(block: () -> Unit) {
            posted.add(block)
        }

        fun runPosted() {
            val list = ArrayList(posted)
            posted.clear()
            list.forEach { it() }
        }

        override fun assSubs(r: PlayRequest, index: Int): Boolean = r.queue.getOrNull(index)?.assSubs == true || index in ass

        override fun beforeSwitch() {
            beforeSwitch++
        }

        override fun switched(kind: EngineKind, reason: SwitchReason) {
            switched.add(kind to reason)
        }

        override fun message(text: String) {
            messages.add(text)
        }

        fun engine(i: Int) = created[i].second
    }

    /** The activity's Ui: engine failures go to the switcher (as PlayerActivity.engineFailed). */
    private class Ui(val sw: () -> EngineSwitcher) : PlayerSession.Ui {
        override fun changed() = Unit

        override fun itemEnded() = Unit

        override fun engineFailed(kind: ErrorKind, detail: String, beforeFirstFrame: Boolean) =
            sw().engineFailed(kind, detail, beforeFirstFrame)
    }

    private fun request(engine: EngineMode = EngineMode.AUTO, startMs: Long = 0, ass: Set<Int> = emptySet(), session: Long = 3) = PlayRequest(
        queue = (0..2).map { QueueItem("http://h/$it", "Серия ${it + 1}", "abc", it, emptyList(), 0, assSubs = it in ass) },
        index = 0,
        startAtMs = startMs,
        seekStep = 10,
        autoNext = true,
        audioLang = "ru",
        subLang = "ru",
        subtitlesOn = false,
        session = session,
        engine = engine,
    )

    private class Rig(vlc: Boolean = true, val host: Host = Host()) {
        val sw = EngineSwitcher(host, vlc)
        lateinit var session: PlayerSession

        fun start(r: PlayRequest): Rig {
            session = PlayerSession(sw.firstEngine(r), Ui { sw })
            sw.session = session
            session.load(r)
            return this
        }
    }

    @Test
    fun firstEngineFollowsTheModeAndTheAssFlag() {
        assertEquals(EngineKind.MEDIA3, Rig().start(request()).sw.kind)
        assertEquals(EngineKind.VLC, Rig().start(request(ass = setOf(0))).sw.kind)
        assertEquals(EngineKind.VLC, Rig().start(request(engine = EngineMode.VLC)).sw.kind)
        assertEquals(EngineKind.MEDIA3, Rig().start(request(engine = EngineMode.BUILTIN, ass = setOf(0))).sw.kind)
    }

    @Test
    fun formatErrorBeforeTheFirstFrameMovesToVlcLaterAtTheSamePosition() {
        val rig = Rig().start(request(startMs = 754_000))
        val media3 = rig.host.engine(0)
        media3.listener?.onError(ErrorKind.UNSUPPORTED_FORMAT, "ERROR_CODE_DECODING_FORMAT_UNSUPPORTED")
        // not inside the engine's callback
        assertEquals(1, rig.host.created.size)
        assertNull(rig.session.error)
        rig.host.runPosted()
        val vlc = rig.host.engine(1)
        assertEquals(EngineKind.VLC, rig.host.created[1].first)
        assertTrue(media3.released)
        assertTrue(rig.session.engine === vlc)
        assertEquals(754_000L, vlc.opened.single().second)
        assertEquals(1, rig.host.beforeSwitch)
        assertEquals(listOf(EngineKind.VLC to SwitchReason.FORMAT), rig.host.switched)
        // VLC failing too: the error is shown, no second switch
        vlc.listener?.onError(ErrorKind.UNSUPPORTED_FORMAT, "vlc_error")
        assertTrue(rig.host.posted.isEmpty())
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, rig.session.error)
    }

    @Test
    fun outOfMemoryMidPlayMovesToVlcAtTheSamePlace() {
        val rig = Rig().start(request())
        val media3 = rig.host.engine(0)
        media3.listener?.onFirstFrame()
        media3.positionMs = 10_000
        media3.listener?.onError(ErrorKind.OTHER, EngineChooser.OUT_OF_MEMORY)
        rig.host.runPosted()
        assertEquals(EngineKind.VLC, rig.sw.kind)
        assertTrue(media3.released)
        assertEquals(10_000L, rig.host.engine(1).opened.single().second)
    }

    @Test
    fun vlcThatDoesNotCopeGoesBackToBuiltinAndIsReleased() {
        val rig = Rig().start(request(engine = EngineMode.VLC))
        val vlc = rig.host.engine(0)
        vlc.positionMs = 27_000
        assertTrue(rig.sw.backToBuiltin())
        assertEquals(EngineKind.MEDIA3, rig.sw.kind)
        assertTrue(vlc.released)
        assertEquals(27_000L, rig.host.engine(1).opened.single().second)
        assertEquals(listOf(EngineKind.MEDIA3 to SwitchReason.MANUAL), rig.host.switched)
        // nothing to go back from on Media3
        assertFalse(rig.sw.backToBuiltin())
    }

    @Test
    fun media3DecodingFailedKeepsItsTextButSwitchesBeforeTheFirstFrame() {
        val rig = Rig().start(request())
        rig.host.engine(0).listener?.onError(ErrorKind.OTHER, EngineChooser.DECODING_FAILED)
        rig.host.runPosted()
        assertEquals(EngineKind.VLC, rig.sw.kind)
        // after the first frame: the error with the old text
        val r2 = Rig().start(request())
        r2.host.engine(0).listener?.onFirstFrame()
        r2.host.engine(0).listener?.onError(ErrorKind.OTHER, EngineChooser.DECODING_FAILED)
        assertTrue(r2.host.posted.isEmpty())
        assertEquals(ErrorKind.OTHER, r2.session.error)
        assertEquals("Не удалось воспроизвести видео", r2.session.errorText())
    }

    @Test
    fun vlcThatCannotStartShowsTheMedia3Error() {
        val host = Host().apply { vlcFails = true }
        val rig = Rig(host = host).start(request())
        host.engine(0).listener?.onError(ErrorKind.DECODER, "ERROR_CODE_DECODER_INIT_FAILED")
        host.runPosted()
        assertEquals(EngineKind.MEDIA3, rig.sw.kind)
        assertFalse(host.engine(0).released)
        assertEquals(ErrorKind.DECODER, rig.session.error)
        assertTrue(host.switched.isEmpty())
    }

    @Test
    fun withoutLibVlcNoVlcIsEverCreated() {
        val rig = Rig(vlc = false).start(request(engine = EngineMode.VLC, ass = setOf(0, 1)))
        assertEquals(EngineKind.MEDIA3, rig.sw.kind)
        rig.host.engine(0).listener?.onError(ErrorKind.UNSUPPORTED_FORMAT, "x")
        assertTrue(rig.host.posted.isEmpty())
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, rig.session.error)
        rig.sw.assSubsKnown(0)
        rig.sw.goTo(1)
        assertEquals("Плеер: Встроенный · VLC недоступен на этом устройстве", rig.sw.menuRow())
        rig.sw.menuPressed()
        assertEquals(listOf("VLC недоступен на этом устройстве"), rig.host.messages)
        assertTrue(rig.host.created.all { it.first == EngineKind.MEDIA3 })
        assertEquals(1, rig.host.created.size)
    }

    @Test
    fun assSubtitlesOfTheCurrentItemOnlySwitchIt() {
        val rig = Rig().start(request())
        rig.sw.assSubsKnown(2)
        assertEquals(EngineKind.MEDIA3, rig.sw.kind)
        rig.host.engine(0).positionMs = 12_000
        rig.sw.assSubsKnown(0)
        assertEquals(EngineKind.VLC, rig.sw.kind)
        assertEquals(12_000L, rig.host.engine(1).opened.single().second)
        assertEquals(listOf(EngineKind.VLC to SwitchReason.ASS), rig.host.switched)
        // finishing: nothing more
        rig.host.finishing = true
        rig.sw.menuPressed()
        assertEquals(2, rig.host.created.size)
    }

    @Test
    fun anAssFlaggedNextItemOpensDirectlyOnVlc() {
        val rig = Rig().start(request())
        rig.host.ass.add(1)
        val media3 = rig.host.engine(0)
        assertTrue(rig.sw.goTo(1))
        val vlc = rig.host.engine(1)
        // Media3 never opened item 1
        assertEquals(listOf("http://h/0"), media3.opened.map { it.first.url })
        assertTrue(media3.released)
        assertEquals("http://h/1", vlc.opened.single().first.url)
        assertEquals(1, rig.session.index)
        assertEquals(listOf(EngineKind.VLC to SwitchReason.ASS), rig.host.switched)
        assertFalse(rig.sw.goTo(1))
        assertFalse(rig.sw.goTo(7))
    }

    @Test
    fun theMenuTogglesAndEndsTheAutomaticSwitches() {
        val rig = Rig().start(request())
        assertEquals("Плеер: Встроенный → сменить на VLC", rig.sw.menuRow())
        rig.sw.menuPressed()
        assertEquals(EngineKind.VLC, rig.sw.kind)
        assertEquals("Плеер: VLC → сменить на встроенный", rig.sw.menuRow())
        rig.sw.menuPressed()
        assertEquals(EngineKind.MEDIA3, rig.sw.kind)
        assertEquals(listOf(EngineKind.VLC to SwitchReason.MANUAL, EngineKind.MEDIA3 to SwitchReason.MANUAL), rig.host.switched)
        rig.sw.assSubsKnown(0)
        assertEquals(EngineKind.MEDIA3, rig.sw.kind)
    }

    @Test
    fun aNewRunPicksItsEngineAndReplacesTheOldOne() {
        val rig = Rig().start(request())
        val media3 = rig.host.engine(0)
        val r2 = request(engine = EngineMode.VLC, startMs = 5_000, session = 4)
        rig.session.load(r2, rig.sw.engineForRun(r2))
        val vlc = rig.host.engine(1)
        assertTrue(media3.released)
        assertTrue(rig.session.engine === vlc)
        assertEquals(5_000L, vlc.opened.single().second)
        assertEquals(TrackPrefs("ru", "ru", false), vlc.prefs)
        // the same kind again: kept
        val r3 = request(engine = EngineMode.VLC, session = 5)
        assertNull(rig.sw.engineForRun(r3))
    }
}
