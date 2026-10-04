package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Language codes, codec names, track names, the start option, errors and the track choice of [VlcEngine]. */
class VlcSupportTest {
    @Test
    fun languagesBecomeTwoLetterCodes() {
        assertEquals("ru", VlcSupport.lang("rus"))
        assertEquals("ru", VlcSupport.lang("ru"))
        assertEquals("ru", VlcSupport.lang("RU"))
        assertEquals("ru", VlcSupport.lang("ru-RU"))
        assertEquals("ru", VlcSupport.lang("Russian"))
        assertEquals("ru", VlcSupport.lang("русский"))
        assertEquals("en", VlcSupport.lang("eng"))
        assertEquals("uk", VlcSupport.lang("ukr"))
        assertEquals("ja", VlcSupport.lang("jpn"))
        // ISO 639-2/B and /T
        assertEquals("de", VlcSupport.lang("ger"))
        assertEquals("de", VlcSupport.lang("deu"))
        assertEquals("fr", VlcSupport.lang("fre"))
        assertEquals("zh", VlcSupport.lang("chi"))
        assertNull(VlcSupport.lang("und"))
        assertNull(VlcSupport.lang(""))
        assertNull(VlcSupport.lang(null))
        assertNull(VlcSupport.lang("qqq"))
    }

    @Test
    fun codecNames() {
        assertEquals("AC3", VlcSupport.codecName("a52 "))
        assertEquals("E-AC3", VlcSupport.codecName("eac3"))
        assertEquals("DTS", VlcSupport.codecName("dts "))
        assertEquals("TrueHD", VlcSupport.codecName("mlp "))
        assertEquals("AAC", VlcSupport.codecName("mp4a"))
        assertEquals("", VlcSupport.codecName("xyz1"))
        assertEquals("", VlcSupport.codecName(null))
    }

    @Test
    fun trackNames() {
        assertEquals(VlcSupport.NameInfo("ru", "Дубляж"), VlcSupport.parseName("Дубляж - [Russian]"))
        assertEquals(VlcSupport.NameInfo("en", null), VlcSupport.parseName("Track 2 - [English]"))
        assertEquals(VlcSupport.NameInfo("ru", null), VlcSupport.parseName("Russian"))
        assertEquals(VlcSupport.NameInfo(null, null), VlcSupport.parseName("Track 1"))
        assertEquals(VlcSupport.NameInfo(null, "Комментарии"), VlcSupport.parseName("Комментарии"))
        assertEquals(VlcSupport.NameInfo(null, null), VlcSupport.parseName(null))
    }

    @Test
    fun startOptionInSeconds() {
        assertEquals(":start-time=754.250", VlcSupport.startOption(754_250))
        assertEquals(":start-time=0.000", VlcSupport.startOption(0))
    }

    @Test
    fun errorKinds() {
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, VlcSupport.errorKind(opened = true, played = false))
        assertEquals(ErrorKind.OTHER, VlcSupport.errorKind(opened = false, played = false))
        assertEquals(ErrorKind.OTHER, VlcSupport.errorKind(opened = true, played = true))
    }

    private val audio = listOf(
        EngineTrack("a1", "en", null, "AC3", 6, selected = true),
        EngineTrack("a2", "ru", "Дубляж", "AC3", 6),
        EngineTrack("a3", "ru", "Многоголосый", "AAC", 2),
    )

    @Test
    fun audioByChoiceThenLanguage() {
        assertEquals("a2", VlcSupport.pickAudio(audio, null, "ru")?.id)
        assertEquals("a2", VlcSupport.pickAudio(audio, null, "rus")?.id)
        assertEquals("a3", VlcSupport.pickAudio(audio, VlcSupport.Choice.Track("ru", "Многоголосый", null), "en")?.id)
        // the choice is not in this item: the language
        assertEquals("a1", VlcSupport.pickAudio(audio, VlcSupport.Choice.Track("de", "Оригинал", null), "en")?.id)
        assertNull(VlcSupport.pickAudio(audio, null, ""))
        assertNull(VlcSupport.pickAudio(audio, null, "ja"))
    }

    private val subs = listOf(
        EngineTrack("s3", "en", "Full"),
        EngineTrack("s4", "ru", "Надписи"),
        EngineTrack("s9", "ru", "Полные (файл)", external = 0),
    )

    @Test
    fun subtitlesOffUnlessOn() {
        val p = VlcSupport.pickSub(subs, null, TrackPrefs("ru", "ru", false))
        assertTrue(p.off)
    }

    @Test
    fun subtitlesByLanguageEmbeddedFirst() {
        val p = VlcSupport.pickSub(subs, null, TrackPrefs("ru", "ru", true))
        assertFalse(p.off)
        assertEquals("s4", p.track?.id)
        val files = VlcSupport.pickSub(subs.filter { it.external != null }, null, TrackPrefs("ru", "ru", true))
        assertEquals("s9", files.track?.id)
        // no match yet: no decision (VLC's own choice, the files may still come)
        val none = VlcSupport.pickSub(subs, null, TrackPrefs("ru", "ja", true))
        assertFalse(none.off)
        assertNull(none.track)
    }

    @Test
    fun subtitleChoiceCarriesOver() {
        assertTrue(VlcSupport.pickSub(subs, VlcSupport.Choice.Off, TrackPrefs("ru", "ru", true)).off)
        assertEquals("s9", VlcSupport.pickSub(subs, VlcSupport.Choice.Track(null, null, 0), TrackPrefs("ru", "en", false)).track?.id)
        assertEquals("s3", VlcSupport.pickSub(subs, VlcSupport.choiceOf(subs[0]), TrackPrefs("ru", "ru", false)).track?.id)
        assertEquals(VlcSupport.Choice.Off, VlcSupport.choiceOf(null))
    }
}
