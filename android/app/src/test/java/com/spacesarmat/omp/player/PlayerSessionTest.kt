package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The queue, resume points, errors, tracks and reported state over a [FakeEngine] (no Activity, no video). */
class PlayerSessionTest {
    private class RecUi : PlayerSession.Ui {
        var changed = 0
        var ended = 0

        override fun changed() {
            changed++
        }

        override fun itemEnded() {
            ended++
        }
    }

    private val subFiles = listOf(
        SubFile("http://h/a.srt", "Английские", "srt", "en"),
        SubFile("http://h/b.ass", "Надписи", "ass", "ru"),
    )

    private fun request(index: Int = 0, startMs: Long = 0, resume: List<Long> = listOf(0, 0, 0)) = PlayRequest(
        queue = resume.mapIndexed { i, r ->
            QueueItem("http://h/$i", "Серия ${i + 1}", null, i, if (i == 0) subFiles else emptyList(), r)
        },
        index = index,
        startAtMs = startMs,
        seekStep = 10,
        autoNext = true,
        audioLang = "ru",
        subLang = "en",
        subtitlesOn = false,
        session = 7,
    )

    private val engine = FakeEngine()
    private val ui = RecUi()
    private val session = PlayerSession(engine, ui)

    @Test
    fun loadOpensTheItemAtStartWithPreferences() {
        session.load(request(index = 1, startMs = 42_000))
        assertTrue(engine.listener === session)
        assertEquals(TrackPrefs("ru", "en", false), engine.prefs)
        assertEquals("http://h/1", engine.opened.single().first.url)
        assertEquals(42_000L, engine.opened.single().second)
        assertEquals(1, session.index)
        assertTrue(session.hasNext())
    }

    @Test
    fun itemSubtitleFilesGoToTheEngine() {
        session.load(request())
        assertEquals(subFiles, engine.opened.single().first.subtitles)
    }

    @Test
    fun leftItemKeepsItsPositionAndNewItemStartsFromItsResume() {
        session.load(request(resume = listOf(0, 120_000, 0)))
        engine.durationMs = 1_000_000
        engine.positionMs = 300_000
        session.tick()
        assertTrue(session.goTo(1))
        assertEquals("http://h/1", engine.opened.last().first.url)
        assertEquals(120_000L, engine.opened.last().second)
        assertEquals(300_000L, session.resumeOf(0))
        // back to the first item: it starts where it was left
        engine.durationMs = 1_000_000
        engine.positionMs = 500_000
        assertTrue(session.goTo(0))
        assertEquals(300_000L, engine.opened.last().second)
        assertEquals(500_000L, session.resumeOf(1))
    }

    @Test
    fun positionIsReadWhenLeavingNotOnlyOnTicks() {
        session.load(request())
        engine.durationMs = 1_000_000
        engine.positionMs = 200_000
        session.tick()
        engine.positionMs = 250_000 // moved since the last tick
        session.goTo(2)
        assertEquals(250_000L, session.resumeOf(0))
    }

    @Test
    fun nearlyWatchedOrBarelyStartedItemsResumeFromTheStart() {
        session.load(request())
        engine.durationMs = 1_000_000
        engine.positionMs = 950_000
        session.goTo(1)
        assertEquals(0L, session.resumeOf(0))
        engine.durationMs = 1_000_000
        engine.positionMs = 5_000
        session.goTo(2)
        assertEquals(0L, session.resumeOf(1))
    }

    @Test
    fun unknownDurationWhenLeavingKeepsTheLastKnown() {
        session.load(request())
        engine.durationMs = 1_000_000
        engine.positionMs = 100_000
        session.tick()
        engine.durationMs = 0 // e.g. after an error
        engine.positionMs = 950_000
        session.goTo(1)
        assertEquals(0L, session.resumeOf(0))
    }

    @Test
    fun goToRejectsCurrentAndOutOfRange() {
        session.load(request())
        assertFalse(session.goTo(0))
        assertFalse(session.goTo(3))
        assertFalse(session.goTo(-1))
        assertEquals(1, engine.opened.size)
    }

    @Test
    fun errorsShowUntilReadyAndRetryClearsThem() {
        session.load(request())
        val l = engine.listener!!
        l.onError(ErrorKind.NETWORK, "ERROR_CODE_IO_NETWORK_CONNECTION_FAILED")
        assertEquals(ErrorKind.NETWORK, session.error)
        assertEquals("Сервер недоступен или не отвечает", session.errorText())
        assertTrue(session.snapshot().paused)
        l.onReady()
        assertNull(session.error)
        l.onError(ErrorKind.DECODER, "x")
        session.retry()
        assertNull(session.error)
        assertEquals(1, engine.retries)
        l.onError(ErrorKind.UNSUPPORTED_FORMAT, "x")
        session.goTo(1)
        assertNull(session.error)
    }

    @Test
    fun errorTexts() {
        assertEquals("Формат видео не поддерживается", PlayerSession.message(ErrorKind.UNSUPPORTED_FORMAT))
        assertEquals("Формат видео не поддерживается", PlayerSession.message(ErrorKind.DECODER))
        assertEquals("Не удалось воспроизвести видео", PlayerSession.message(ErrorKind.OTHER))
    }

    @Test
    fun eventsReachTheUi() {
        session.load(request())
        val l = engine.listener!!
        l.onEnded()
        assertEquals(1, ui.ended)
        val before = ui.changed
        l.onBuffering(true)
        l.onPlayingChanged(false)
        l.onTracksChanged()
        assertEquals(before + 3, ui.changed)
        assertFalse(session.firstFrame)
        l.onFirstFrame()
        assertTrue(session.firstFrame)
        session.goTo(1)
        assertFalse(session.firstFrame)
    }

    @Test
    fun snapshotReportsPositionStateAndTracks() {
        session.load(request(startMs = 61_500))
        engine.durationMs = 3_600_000
        engine.isBuffering = true
        engine.audio = listOf(
            EngineTrack("g0", "ru", "Дубляж", "AC3", 6, selected = false),
            EngineTrack("g1", "en", null, "DTS", 8, selected = true),
        )
        engine.subs = listOf(
            EngineTrack("g3", null, "Надписи", external = 1),
            EngineTrack("g2", "en", null, selected = true),
            EngineTrack("g4", null, null, external = 0),
        )
        val st = session.snapshot()
        assertEquals(0, st.index)
        assertEquals(61.5, st.timeSec, 0.0)
        assertEquals(3600.0, st.durationSec, 0.0)
        assertFalse(st.paused)
        assertTrue(st.buffering)
        assertEquals(listOf("Русский · Дубляж · AC3 5.1", "Английский · DTS 7.1"), st.audio)
        assertEquals(1, st.audioSel)
        assertEquals(listOf("off", "e0", "x0", "x1"), st.subs.map { it.value })
        assertEquals(listOf("Выкл", "Английский", "Английские (файл)", "Надписи (файл)"), st.subs.map { it.label })
        assertEquals("e0", st.subSel)
        engine.pause()
        assertTrue(session.snapshot().paused)
    }

    @Test
    fun selectionsGoToTheEngineByTrackId() {
        session.load(request())
        engine.audio = listOf(EngineTrack("g0", "ru", null), EngineTrack("g5", "en", null))
        engine.subs = listOf(EngineTrack("g7", "en", null), EngineTrack("g8", null, null, external = 0))
        session.selectAudio(1)
        assertEquals("g5", engine.selectedAudioId)
        session.selectAudio(9)
        assertEquals("g5", engine.selectedAudioId)
        session.selectSub("x0")
        assertEquals("g8", engine.selectedSubId)
        session.selectSub("e0")
        assertEquals("g7", engine.selectedSubId)
        session.selectSub("off")
        assertNull(engine.selectedSubId)
        session.selectSub("e5")
        assertNull(engine.selectedSubId)
    }

    @Test
    fun trackLabelsFallBack() {
        assertEquals("Дорожка 2", TrackOptions.audioLabel(EngineTrack("a", "und", null), 2))
        assertEquals("Субтитры 3", TrackOptions.subLabel(EngineTrack("s", null, ""), 3))
        assertEquals("Русский", TrackOptions.audioLabel(EngineTrack("a", "ru", "Русский"), 1))
        assertEquals("3 кан.", TrackOptions.channels(3))
        assertEquals("", TrackOptions.channels(0))
        assertEquals("Выкл", TrackOptions.selectedSub(TrackOptions.subs(emptyList(), emptyList())).label)
        assertEquals(-1, TrackOptions.selectedAudio(emptyList()))
    }
}
