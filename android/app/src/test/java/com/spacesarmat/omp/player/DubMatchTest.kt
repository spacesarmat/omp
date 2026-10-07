package com.spacesarmat.omp.player

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** «Озвучка» of a series: tracks picked by title (the dub) first, then by language; manual choices reported. */
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
    fun subtitlesByTitleOrFileThenLanguage() {
        val files = listOf(SubFile("u", "Rus.Forced.srt", "srt", "ru"))
        val subs = listOf(
            EngineTrack("s0", "eng", "Full"),
            EngineTrack("s1", "rus", "Надписи"),
            EngineTrack("x0", null, null, external = 0),
        )
        assertEquals(1, DubMatch.pickSub(subs, files, "надписи", "en"))
        assertEquals(2, DubMatch.pickSub(subs, files, "Rus.Forced.srt", ""))
        assertEquals(0, DubMatch.pickSub(subs, files, "Полные", "en"))
        assertEquals(1, DubMatch.pickSub(subs, files, "", "ru"))
        assertEquals(-1, DubMatch.pickSub(subs, files, "Полные", "de"))
    }

    @Test
    fun seenDubsAreTitledAndUnique() {
        val list = audio + EngineTrack("a3", "rus", "lostfilm") + EngineTrack("a4", "rus", null)
        assertEquals(listOf("Дубляж" to "rus", "MVO | LostFilm" to "rus", "Original" to "eng"), DubMatch.seen(list))
    }

    @Test
    fun requestCarriesTheTitles() {
        val o = JSONObject()
            .put("queue", JSONArray().put(JSONObject().put("url", "http://h/1")))
            .put("dubLabel", " LostFilm ")
            .put("subLabel", "Надписи")
        val r = PlayRequest.parse(o)!!
        assertEquals("LostFilm", r.dubLabel)
        assertEquals("Надписи", r.subLabel)
        val bare = PlayRequest.parse(JSONObject().put("queue", JSONArray().put(JSONObject().put("url", "http://h/1"))))!!
        assertEquals("", bare.dubLabel)
        assertEquals("", bare.subLabel)
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

    private fun request(dub: String, subLabel: String = "", subtitlesOn: Boolean = false) = PlayRequest(
        queue = listOf(
            QueueItem("http://h/0", "1", "hash", 0, emptyList(), 0),
            QueueItem("http://h/1", "2", "hash", 1, emptyList(), 0),
        ),
        index = 0,
        startAtMs = 0,
        seekStep = 10,
        autoNext = true,
        audioLang = "ru",
        subLang = "ru",
        subtitlesOn = subtitlesOn,
        session = 1,
        dubLabel = dub,
        subLabel = subLabel,
    )

    @Test
    fun sessionPicksTheSeriesDubWhenTracksArrive() {
        val engine = FakeEngine()
        val session = PlayerSession(engine, RecUi())
        session.load(request("LostFilm"))
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
    fun sessionLeavesTheEngineLanguagePickWithoutADub() {
        val engine = FakeEngine()
        val session = PlayerSession(engine, RecUi())
        session.load(request(""))
        engine.audio = audio
        session.onTracksChanged()
        assertNull(engine.selectedAudioId)
        assertEquals(TrackPrefs("ru", "ru", false), engine.prefs)
    }

    @Test
    fun sessionPicksSubtitlesByTitleWhenOn() {
        val engine = FakeEngine()
        val session = PlayerSession(engine, RecUi())
        session.load(request("", "Надписи", subtitlesOn = true))
        engine.subs = listOf(EngineTrack("s0", "rus", "Полные", selected = true), EngineTrack("s1", "rus", "Надписи"))
        session.onTracksChanged()
        assertEquals("s1", engine.selectedSubId)
    }

    @Test
    fun manualChoicesAreReportedAndCarriedToTheNextItem() {
        val engine = FakeEngine()
        val ui = RecUi()
        val session = PlayerSession(engine, ui)
        session.load(request("LostFilm"))
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
}
