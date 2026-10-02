package com.spacesarmat.omp.player

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors the LG rules (tests/player/chapters.test.ts, tests/ui/playerChapters.test.tsx). */
class SkipsTest {
    private val chapters = listOf(ChapterMark(0, "Пролог"), ChapterMark(92_000, "Заставка"), ChapterMark(185_000, ""))

    private fun info(
        intro: Segment? = Segment(60_000, 150_000),
        credits: Long? = 1_300_000,
        autoIntro: Boolean = false,
        autoCredits: Boolean = false,
        list: List<ChapterMark> = chapters,
    ) = ItemSkip(0, list, intro, credits, autoIntro, autoCredits, null, null, null)

    @Test
    fun parsesTheSegmentsMessage() {
        val o = JSONObject(
            """{"type":"segments","index":2,"session":7,"chapters":[{"start":92.5,"title":"Заставка"},{"start":0,"title":""}],
            "intro":{"start":92.5,"end":180},"credits":{"start":1300},"autoIntro":true,"autoCredits":false,
            "mi":[45,135],"mc":90,"pending":40}""",
        )
        val s = ItemSkip.parse(o)!!
        assertEquals(2, s.index)
        assertEquals(listOf(ChapterMark(0, ""), ChapterMark(92_500, "Заставка")), s.chapters)
        assertEquals(Segment(92_500, 180_000), s.intro)
        assertEquals(1_300_000L, s.creditsMs)
        assertTrue(s.autoIntro)
        assertFalse(s.autoCredits)
        assertEquals(Segment(45_000, 135_000), s.markIntro)
        assertEquals(90L, s.markCreditsS)
        assertEquals(40_000L, s.pendingMs)
    }

    @Test
    fun parseDropsBadParts() {
        assertNull(ItemSkip.parse(JSONObject("""{"chapters":[]}""")))
        val s = ItemSkip.parse(JSONObject("""{"index":0,"intro":{"start":10,"end":5},"credits":{"start":0},"mi":[1]}"""))!!
        assertTrue(s.chapters.isEmpty())
        assertNull(s.intro)
        assertNull(s.creditsMs)
        assertNull(s.markIntro)
        assertNull(s.markCreditsS)
        assertNull(s.pendingMs)
    }

    @Test
    fun chapterTargets() {
        assertEquals(1, Chapters.indexAt(chapters, 100_000))
        assertEquals(185_000L, Chapters.target(chapters, 100_000, 1))
        assertNull(Chapters.target(chapters, 200_000, 1))
        // CH− in the first 3 s of a chapter: the previous one, later: the start of the current one
        assertEquals(0L, Chapters.target(chapters, 94_000, -1))
        assertEquals(92_000L, Chapters.target(chapters, 95_000, -1))
        assertEquals(0L, Chapters.target(chapters, 1_000, -1))
        assertNull(Chapters.target(emptyList(), 1_000, 1))
    }

    @Test
    fun ticksTitlesAndRows() {
        assertArrayEquals(floatArrayOf(0.25f, 0.5f), Chapters.ticks(listOf(ChapterMark(0, ""), ChapterMark(100, ""), ChapterMark(200, ""), ChapterMark(400, "")), 400), 0.0001f)
        assertEquals(0, Chapters.ticks(chapters, 0).size)
        assertEquals("Глава 2 «Заставка»", Chapters.current(chapters, 100_000))
        assertEquals("Глава 3", Chapters.current(chapters, 190_000))
        assertEquals(listOf("0:00 · Пролог", "1:32 · Заставка", "3:05 · Глава 3"), Chapters.rows(chapters))
        assertEquals("1:02:03", formatClock(3_723_000))
    }

    @Test
    fun chapterKeys() {
        val s = SkipState()
        assertEquals(ChapterStep.Wait, s.chapterStep(0, 1_000, 1))
        s.set(info())
        assertEquals(ChapterStep.Seek(92_000), s.chapterStep(0, 1_000, 1))
        assertEquals(ChapterStep.None, s.chapterStep(0, 200_000, 1))
        s.set(info(list = emptyList()))
        assertEquals(ChapterStep.NextItem, s.chapterStep(0, 1_000, 1))
        assertEquals(ChapterStep.PrevItem, s.chapterStep(0, 1_000, -1))
    }

    @Test
    fun skipButtonInsideTheIntroUntilHidden() {
        val s = SkipState()
        s.set(info())
        assertFalse(s.skipDue(0, 59_999))
        assertTrue(s.skipDue(0, 60_000))
        assertFalse(s.skipDue(0, 149_000))
        assertFalse(s.skipDue(1, 100_000))
        assertEquals(150_000L, s.introTarget(0, 1_400_000))
        // a manual mark past the end of the file: never past the last second
        assertEquals(99_000L, s.introTarget(0, 100_000))
        s.hideIntro(0)
        assertFalse(s.skipDue(0, 100_000))
        // another visit of the item shows it again
        s.enter()
        assertTrue(s.skipDue(0, 100_000))
    }

    @Test
    fun autoIntroOncePerVisit() {
        val s = SkipState()
        s.set(info(autoIntro = false))
        assertNull(s.autoIntro(0, 70_000, 1_400_000))
        s.set(info(autoIntro = true))
        assertNull(s.autoIntro(0, 10_000, 1_400_000))
        assertEquals(150_000L, s.autoIntro(0, 70_000, 1_400_000))
        // «Вернуть»: back at the intro start, no second skip and no button
        assertNull(s.autoIntro(0, 60_000, 1_400_000))
        assertFalse(s.skipDue(0, 60_000))
        s.enter()
        assertEquals(150_000L, s.autoIntro(0, 61_000, 1_400_000))
    }

    @Test
    fun creditsSkipOnlyOnCrossingWhilePlaying() {
        val s = SkipState()
        s.set(info(autoCredits = true))
        // opened or resumed inside the credits: no skip
        assertFalse(s.creditsCrossed(0, 1_310_000, true, true))
        assertFalse(s.creditsCrossed(0, 1_310_500, true, true))
        s.enter()
        // a seek into the credits: no skip
        assertFalse(s.creditsCrossed(0, 1_000_000, true, true))
        s.seeked()
        assertFalse(s.creditsCrossed(0, 1_300_200, true, true))
        s.enter()
        assertFalse(s.creditsCrossed(0, 1_299_600, true, true))
        assertTrue(s.creditsCrossed(0, 1_300_100, true, true))
        // once
        assertFalse(s.creditsCrossed(0, 1_299_600, true, true))
        assertFalse(s.creditsCrossed(0, 1_300_100, true, true))
    }

    @Test
    fun creditsSkipNeedsNextItemPlaybackAndTheSetting() {
        val off = SkipState().apply { set(info(autoCredits = false)) }
        off.creditsCrossed(0, 1_299_600, true, true)
        assertFalse(off.creditsCrossed(0, 1_300_100, true, true))
        val last = SkipState().apply { set(info(autoCredits = true)) }
        last.creditsCrossed(0, 1_299_600, true, false)
        assertFalse(last.creditsCrossed(0, 1_300_100, true, false))
        val paused = SkipState().apply { set(info(autoCredits = true)) }
        paused.creditsCrossed(0, 1_299_600, false, true)
        assertFalse(paused.creditsCrossed(0, 1_300_100, false, true))
    }

    @Test
    fun countdownFromTheCreditsStart() {
        val s = SkipState()
        s.set(info())
        assertFalse(s.countdownDue(0, 1_299_000, 1_400_000))
        assertTrue(s.countdownDue(0, 1_300_000, 1_400_000))
        assertFalse(s.countdownDue(0, 1_400_000, 1_400_000))
        assertFalse(s.countdownDue(0, 50_000, 59_000))
        s.dismissCountdown()
        assertFalse(s.countdownDue(0, 1_350_000, 1_400_000))
        s.enter()
        assertTrue(s.countdownDue(0, 1_350_000, 1_400_000))
        s.set(info(credits = null))
        assertFalse(s.countdownDue(0, 1_350_000, 1_400_000))
    }

    @Test
    fun markRowsLikeLg() {
        assertEquals(
            listOf("Отметить начало заставки: —", "Отметить конец заставки: сейчас 2:15", "Отметить начало титров: —"),
            markRows(null, 135_000, 1_400_000),
        )
        val withMarks = ItemSkip(0, emptyList(), null, null, false, false, Segment(30_000, 90_000), 100, null)
        assertEquals(
            listOf("Отметить начало заставки: 0:30", "Отметить конец заставки: сейчас 2:15", "Отметить начало титров: 21:40"),
            markRows(withMarks, 135_000, 1_400_000),
        )
        val pending = withMarks.copy(pendingMs = 45_000)
        assertEquals("Отметить начало заставки: 0:45", markRows(pending, 135_000, 1_400_000)[0])
        assertEquals("Отметить конец заставки: начало 0:45 · сейчас 2:15", markRows(pending, 135_000, 1_400_000)[1])
    }
}
