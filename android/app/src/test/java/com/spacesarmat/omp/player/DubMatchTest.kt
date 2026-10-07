package com.spacesarmat.omp.player

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** «Озвучка» of a series: tracks picked by the start order (title, then language), manual choices reported and carried. */
class DubMatchTest {
    private val audio = listOf(
        EngineTrack("a0", "rus", "Дубляж", "AC3", 6, selected = true),
        EngineTrack("a1", "rus", "MVO | LostFilm", "AC3", 2),
        EngineTrack("a2", "eng", "Original", "DTS", 6),
    )

    @Test
    fun labelsCompareNormalised() {
        assertTrue(DubMatch.same("LostFilm", "lostfilm"))
        assertTrue(DubMatch.same("LostFilm", "MVO | LostFilm"))
        assertTrue(DubMatch.same("HDrezka  Studio", "hdrezka studio (18+)"))
        assertTrue(DubMatch.same("Кубик в Кубе", "кубик в кубе"))
        assertTrue(DubMatch.same("Дубляж Ёлка", "дубляж елка"))
        assertFalse(DubMatch.same("Lost", "LostFilm"))
        assertFalse(DubMatch.same("ru", "ru · LostFilm"))
        assertFalse(DubMatch.same("", "LostFilm"))
        assertFalse(DubMatch.same("NewStudio", "LostFilm"))
        // codec names are no titles
        assertFalse(DubMatch.same("SUBRIP", "subrip"))
    }

    @Test
    fun codecNamesAreNoDubs() {
        for (s in listOf("SUBRIP", "srt", "ASS", "PGS", "hdmv_pgs_subtitle", "VobSub", "WEBVTT", "tx3g", "mov_text", "dvb_subtitle",
            "PCM_S16LE 2.0", "AC3 5.1", "DTS-HD MA", "E-AC3", "TrueHD Atmos 7.1", "AAC stereo")) {
            assertTrue(s, DubMatch.isCodecLabel(s))
            assertEquals("", DubMatch.title(s))
        }
        assertFalse(DubMatch.isCodecLabel("LostFilm"))
        assertFalse(DubMatch.isCodecLabel("Forced"))
        assertFalse(DubMatch.isCodecLabel(""))
        assertEquals(listOf("LostFilm" to "rus"), DubMatch.seen(listOf(EngineTrack("p", "rus", "PCM_S24LE"), EngineTrack("l", "rus", "LostFilm"))))
    }

    @Test
    fun languagesCompareAcrossCodes() {
        assertTrue(DubMatch.sameLang("ru", "rus"))
        assertTrue(DubMatch.sameLang("en", "eng"))
        assertFalse(DubMatch.sameLang("ru", "en"))
        assertFalse(DubMatch.sameLang("und", "und"))
        assertFalse(DubMatch.sameLang("", "ru"))
    }

    @Test
    fun audioByLabelThenLanguage() {
        assertEquals(1, DubMatch.pickAudio(audio, "LostFilm", "ru"))
        assertEquals(2, DubMatch.pickAudio(audio, "original", ""))
        // no such dub in this file: the language
        assertEquals(2, DubMatch.pickAudio(audio, "HDrezka Studio", "en"))
        assertEquals(0, DubMatch.pickAudio(audio, "HDrezka Studio", "ru"))
        assertEquals(-1, DubMatch.pickAudio(audio, "HDrezka Studio", "de"))
        assertEquals(-1, DubMatch.pickAudio(audio, "", ""))
    }

    @Test
    fun startOrderSeriesDubThenTorrentChoiceThenSeriesLanguage() {
        // series dub → torrent's own dub → torrent's language → series language → settings
        val order = listOf(TrackPick("HDrezka Studio"), TrackPick("Original"), TrackPick("", "ru"), TrackPick("", "en"))
        assertEquals(2, DubMatch.pickAudio(audio, order))
        assertEquals(0, DubMatch.pickAudio(audio, order.drop(1).filter { it.label.isEmpty() }))
        assertEquals(-1, DubMatch.pickAudio(audio, emptyList()))
    }

    @Test
    fun subtitlesByTitleInTheSameLanguageThenLanguage() {
        val files = listOf(SubFile("u", "Rus.Songs.srt", "srt", "ru"))
        val subs = listOf(
            EngineTrack("s0", "eng", "Forced"),
            EngineTrack("s1", "rus", "Forced"),
            EngineTrack("s2", "rus", "Надписи"),
            EngineTrack("x0", null, null, external = 0),
        )
        // a generic title of another language is another track
        assertEquals(1, DubMatch.pickSub(subs, files, "Forced", "ru"))
        assertEquals(0, DubMatch.pickSub(subs, files, "Forced", "en"))
        // title without a language: the first one
        assertEquals(0, DubMatch.pickSub(subs, files, "Forced", ""))
        assertEquals(2, DubMatch.pickSub(subs, files, "надписи", ""))
        assertEquals(3, DubMatch.pickSub(subs, files, "Rus.Songs.srt", "ru"))
        assertEquals(1, DubMatch.pickSub(subs, files, "Полные", "ru"))
        assertEquals(-1, DubMatch.pickSub(subs, files, "Полные", "de"))
        // an «off» step decides
        assertEquals(DubMatch.OFF, DubMatch.pickSub(subs, files, listOf(TrackPick("Полные", "de"), TrackPick(off = true))))
    }

    @Test
    fun requestCarriesTheStartOrder() {
        val o = JSONObject()
            .put("queue", JSONArray().put(JSONObject().put("url", "http://h/1")))
            .put("audioPick", JSONArray().put(JSONObject().put("l", " LostFilm ")).put(JSONObject().put("g", "ru")).put(JSONObject()).put(5))
            .put("subPick", JSONArray().put(JSONObject().put("l", "Надписи").put("g", "ru")).put(JSONObject().put("off", true)))
        val r = PlayRequest.parse(o)!!
        assertEquals(listOf(TrackPick("LostFilm"), TrackPick("", "ru")), r.audioPick)
        assertEquals(listOf(TrackPick("Надписи", "ru"), TrackPick(off = true)), r.subPick)
        val bare = PlayRequest.parse(JSONObject().put("queue", JSONArray().put(JSONObject().put("url", "http://h/1"))))!!
        assertTrue(bare.audioPick.isEmpty())
        assertTrue(bare.subPick.isEmpty())
    }

    // ---- PlayerSession ----

    private class RecUi : PlayerSession.Ui {
        val chosen = ArrayList<TrackChoice>()
        override fun changed() = Unit
        override fun itemEnded() = Unit
        override fun trackChosen(choice: TrackChoice) {
            chosen.add(choice)
        }
    }

    private fun request(audioPick: List<TrackPick> = emptyList(), subPick: List<TrackPick> = emptyList(), subtitlesOn: Boolean = false) =
        PlayRequest(
            queue = listOf(
                QueueItem("http://h/0", "1", "hash", 0, emptyList(), 0),
                QueueItem("http://h/1", "2", "hash", 1, emptyList(), 0),
                QueueItem("http://h/2", "3", "hash", 2, emptyList(), 0),
            ),
            index = 0,
            startAtMs = 0,
            seekStep = 10,
            autoNext = true,
            audioLang = "ru",
            subLang = "ru",
            subtitlesOn = subtitlesOn,
            session = 1,
            audioPick = audioPick,
            subPick = subPick,
        )

    @Test
    fun sessionPicksTheSeriesDubWhenTracksArrive() {
        val engine = FakeEngine()
        val session = PlayerSession(engine, RecUi())
        session.load(request(listOf(TrackPick("LostFilm"), TrackPick("", "ru"))))
        assertNull(engine.selectedAudioId)
        engine.audio = audio
        session.onTracksChanged()
        assertEquals("a1", engine.selectedAudioId)
        // once per item: a later track change (the user's pick) is left alone
        engine.selectedAudioId = "a2"
        session.onTracksChanged()
        assertEquals("a2", engine.selectedAudioId)
    }

    @Test
    fun sessionLeavesTheEngineLanguagePickWithoutAStartOrder() {
        val engine = FakeEngine()
        val session = PlayerSession(engine, RecUi())
        session.load(request())
        engine.audio = audio
        engine.subs = listOf(EngineTrack("s0", "rus", "Полные", selected = true))
        session.onTracksChanged()
        assertNull(engine.selectedAudioId)
        assertEquals("unset", engine.selectedSubId)
        assertEquals(TrackPrefs("ru", "ru", false), engine.prefs)
    }

    @Test
    fun sessionPicksSubtitlesByTitleOrTurnsThemOff() {
        val engine = FakeEngine()
        val session = PlayerSession(engine, RecUi())
        session.load(request(subPick = listOf(TrackPick("Надписи", "ru")), subtitlesOn = true))
        engine.subs = listOf(EngineTrack("s0", "rus", "Полные", selected = true), EngineTrack("s1", "rus", "Надписи"))
        session.onTracksChanged()
        assertEquals("s1", engine.selectedSubId)

        val e2 = FakeEngine()
        val s2 = PlayerSession(e2, RecUi())
        s2.load(request(subPick = listOf(TrackPick(off = true)), subtitlesOn = true))
        e2.subs = listOf(EngineTrack("s0", "rus", "Полные", selected = true))
        s2.onTracksChanged()
        assertNull(e2.selectedSubId)
    }

    @Test
    fun manualChoicesAreReportedAndCarriedToTheNextItem() {
        val engine = FakeEngine()
        val ui = RecUi()
        val session = PlayerSession(engine, ui)
        session.load(request(listOf(TrackPick("LostFilm"))))
        engine.audio = audio
        session.onTracksChanged()
        session.selectAudio(2)
        val a = ui.chosen.single()
        assertTrue(a.audio)
        assertEquals("Original", a.label)
        assertEquals("eng", a.lang)
        assertEquals(3, a.seen.size)
        // the next episode starts with the dub picked by hand
        assertTrue(session.goTo(1))
        engine.selectedAudioId = null
        engine.audio = listOf(EngineTrack("b0", "rus", "LostFilm", selected = true), EngineTrack("b1", "eng", "Original"))
        session.onTracksChanged()
        assertEquals("b1", engine.selectedAudioId)

        engine.subs = listOf(EngineTrack("s0", "rus", "Надписи"))
        session.selectSub("off")
        assertTrue(ui.chosen.last().off)
        session.selectSub("e0")
        val s = ui.chosen.last()
        assertFalse(s.audio)
        assertFalse(s.off)
        assertEquals("Надписи", s.label)
        assertEquals("rus", s.lang)
    }

    @Test
    fun untitledChoicesAndSubtitlesOffAreCarriedToo() {
        val engine = FakeEngine()
        val ui = RecUi()
        val session = PlayerSession(engine, ui)
        // subtitles on from the settings, audio by the engine's language
        session.load(request(subtitlesOn = true))
        engine.audio = listOf(EngineTrack("a0", "rus", null, "AC3", 6, selected = true), EngineTrack("a1", "eng", "PCM_S16LE", "PCM", 2))
        engine.subs = listOf(EngineTrack("s0", "rus", null, selected = true))
        session.onTracksChanged()
        session.selectAudio(1)
        assertEquals("", ui.chosen.last().label) // a codec name is no dub title
        assertEquals("eng", ui.chosen.last().lang)
        session.selectSub("off")

        // the next item: the English audio (by language) and no subtitles
        assertTrue(session.goTo(1))
        engine.selectedAudioId = null
        engine.selectedSubId = "unset"
        engine.audio = listOf(EngineTrack("b0", "rus", null, selected = true), EngineTrack("b1", "eng", null))
        engine.subs = listOf(EngineTrack("t0", "rus", null, selected = true))
        session.onTracksChanged()
        assertEquals("b1", engine.selectedAudioId)
        assertNull(engine.selectedSubId)

        // untitled subtitles turned on by hand: by language on the next item
        engine.subs = listOf(EngineTrack("t0", "rus", null), EngineTrack("t1", "eng", null))
        session.selectSub("e1")
        assertTrue(session.goTo(2))
        engine.selectedSubId = "unset"
        engine.subs = listOf(EngineTrack("u0", "rus", null), EngineTrack("u1", "eng", null))
        session.onTracksChanged()
        assertEquals("u1", engine.selectedSubId)
    }
}
