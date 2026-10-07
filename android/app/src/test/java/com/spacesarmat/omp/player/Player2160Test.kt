package com.spacesarmat.omp.player

import android.app.Activity
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The extras handed to 2160 Player and the result it hands back (no Activity needed). */
class Player2160Test {
    private val one = listOf(Player2160.Item("http://srv/a.mkv", "S01E02 · Pilot"))
    private val three = listOf(
        Player2160.Item("http://srv/1.mkv", "One"),
        Player2160.Item("http://srv/2.mkv", "Two"),
        Player2160.Item("http://srv/3.mkv", "Three"),
    )

    @Test
    fun oneItemHasTitlePositionAndReturnResultButNoPlaylist() {
        val s = Player2160.spec(one, 0, 754_000L, false, "")
        assertEquals("http://srv/a.mkv", s.url)
        assertEquals("S01E02 · Pilot", s.extras["title"])
        assertEquals(754_000, s.extras["position"])
        assertTrue(s.extras["position"] is Int)
        assertEquals(true, s.extras["return_result"])
        assertFalse(s.extras.containsKey("video_list.name"))
        assertFalse(s.extras.containsKey("from_start"))
    }

    @Test
    fun fromStartSetsTheFlagAndNoPosition() {
        val s = Player2160.spec(one, 0, 754_000L, true, "")
        assertEquals(true, s.extras["from_start"])
        assertFalse(s.extras.containsKey("position"))
    }

    @Test
    fun zeroAndHugePositionsAreHandled() {
        assertFalse(Player2160.spec(one, 0, 0L, false, "").extras.containsKey("position"))
        assertEquals(Int.MAX_VALUE, Player2160.spec(one, 0, Long.MAX_VALUE, false, "").extras["position"])
    }

    @Test
    fun aPlaylistPutsTheNamesAndStartsAtTheStartItem() {
        val s = Player2160.spec(three, 1, 0L, false, "")
        assertEquals("http://srv/2.mkv", s.url)
        assertEquals("Two", s.extras["title"])
        @Suppress("UNCHECKED_CAST")
        assertArrayEquals(arrayOf("One", "Two", "Three"), s.extras["video_list.name"] as Array<String>)
    }

    @Test
    fun blankSegmentsAreOmittedAndGivenOnesKept() {
        assertFalse(Player2160.spec(one, 0, 0L, false, "  ").extras.containsKey("tv.p2160.extra.SEGMENTS"))
        assertEquals("a,b", Player2160.spec(one, 0, 0L, false, "a,b").extras["tv.p2160.extra.SEGMENTS"])
    }

    @Test
    fun parseReadsIntAndLongPositionAndKeepsTheUrl() {
        val a = Player2160.parseExtras(mapOf("position" to 61_000, "duration" to 2_400_000, "end_by" to "user"), "http://srv/2.mkv")
        assertTrue(a.returned)
        assertEquals(61_000L, a.positionMs)
        assertEquals(2_400_000L, a.durationMs)
        assertFalse(a.ended)
        assertEquals("http://srv/2.mkv", a.url)
        val v = Player2160.parseExtras(mapOf("extra_position" to 5_000L, "extra_duration" to 9_000L), null)
        assertEquals(5_000L, v.positionMs)
        assertEquals(9_000L, v.durationMs)
        assertNull(v.url)
    }

    @Test
    fun playbackCompletionMeansEnded() {
        val r = Player2160.parseExtras(mapOf("end_by" to "playback_completion"), "http://srv/1.mkv")
        assertTrue(r.returned)
        assertTrue(r.ended)
    }

    @Test
    fun nothingUsableMeansNotReturned() {
        assertFalse(Player2160.parseExtras(null, null).returned)
        assertFalse(Player2160.parseExtras(mapOf("duration" to 100), null).returned)
    }

    @Test
    fun aCanceledResultIsNotReturned() {
        assertFalse(Player2160.parse(Activity.RESULT_CANCELED, null).returned)
    }

    @Test
    fun theResultJsonCarriesTheUrl() {
        val j = Player2160.parseExtras(mapOf("position" to 5_000), "http://srv/1.mkv").toJson()
        assertEquals("http://srv/1.mkv", j.getString("url"))
        assertEquals(5_000L, j.getLong("positionMs"))
    }

    @Test
    fun playableRemapsStartWhenAnEarlierItemIsDropped() {
        val items = listOf(Player2160.Item("", "x"), Player2160.Item("http://a", "A"), Player2160.Item(" ", "y"), Player2160.Item("http://b", "B"))
        val (kept, start) = Player2160.playable(items, 3)!!
        assertEquals(listOf("http://a", "http://b"), kept.map { it.url })
        assertEquals(1, start)
        assertEquals("B", kept[start].title)
    }

    @Test
    fun playableIsNullWhenTheStartItemHasNoUrl() {
        assertNull(Player2160.playable(listOf(Player2160.Item("http://a", "A"), Player2160.Item("", "B")), 1))
        assertNull(Player2160.playable(emptyList(), 0))
    }

    @Test
    fun playableKeepsAnAllValidListAsIs() {
        val (kept, start) = Player2160.playable(three, 2)!!
        assertEquals(three, kept)
        assertEquals(2, start)
    }
}
