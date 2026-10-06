package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The MX-compatible ACTION_VIEW extras and the result an external player hands back (no Activity needed). */
class ExternalPlayerTest {
    @Test
    fun theViewSpecCarriesTheDataTypeAndTheMxExtras() {
        val s = ExternalPlayer.spec("http://srv:8090/stream/a.mkv?link=x&index=1&play", "S01E02 · Pilot", 754_000L, null)
        assertEquals("http://srv:8090/stream/a.mkv?link=x&index=1&play", s.url)
        assertEquals("video/*", s.mime)
        assertEquals("S01E02 · Pilot", s.extras["title"])
        assertEquals(754_000, s.extras["position"])
        assertTrue(s.extras["position"] is Int)
        assertEquals(true, s.extras["return_result"])
        assertEquals(true, s.extras["secure_uri"])
    }

    @Test
    fun aGivenMimeIsKeptAndANegativeOrHugePositionIsClamped() {
        assertEquals("video/x-matroska", ExternalPlayer.spec("http://h/v", "t", 0, "video/x-matroska").mime)
        assertEquals("video/*", ExternalPlayer.spec("http://h/v", "t", 0, "  ").mime)
        assertEquals(0, ExternalPlayer.spec("http://h/v", "t", -5, null).extras["position"])
        assertEquals(Int.MAX_VALUE, ExternalPlayer.spec("http://h/v", "t", Long.MAX_VALUE, null).extras["position"])
    }

    @Test
    fun anEmptyTitleIsLeftOut() {
        assertFalse(ExternalPlayer.spec("http://h/v", " ", 0, null).extras.containsKey("title"))
    }

    @Test
    fun parseReadsIntAndLongPositionAndDuration() {
        val a = ExternalPlayer.parseExtras(-1, mapOf("position" to 61_000, "duration" to 2_400_000, "end_by" to "user"))
        assertTrue(a.returned)
        assertEquals(61_000L, a.positionMs)
        assertEquals(2_400_000L, a.durationMs)
        assertFalse(a.ended)
        val b = ExternalPlayer.parseExtras(-1, mapOf("position" to 61_000L, "duration" to 2_400_000L))
        assertEquals(61_000L, b.positionMs)
        assertEquals(2_400_000L, b.durationMs)
    }

    @Test
    fun vlcExtraKeysAreTheFallback() {
        val v = ExternalPlayer.parseExtras(-1, mapOf("extra_position" to 61_000L, "extra_duration" to 2_400_000L))
        assertTrue(v.returned)
        assertEquals(61_000L, v.positionMs)
        assertEquals(2_400_000L, v.durationMs)
        // the MX keys win when both are there
        val both = ExternalPlayer.parseExtras(-1, mapOf("position" to 5_000, "extra_position" to 9_000L, "extra_duration" to 100_000L))
        assertEquals(5_000L, both.positionMs)
        assertEquals(100_000L, both.durationMs)
        assertFalse(ExternalPlayer.parseExtras(-1, mapOf("extra_position" to -1L)).returned)
    }

    @Test
    fun playbackCompletionMeansEnded() {
        val r = ExternalPlayer.parseExtras(-1, mapOf("end_by" to "playback_completion", "duration" to 2_400_000))
        assertTrue(r.returned)
        assertTrue(r.ended)
        assertNull(r.positionMs)
    }

    @Test
    fun missingExtrasMeanNothingCameBack() {
        assertFalse(ExternalPlayer.parseExtras(0, null).returned)
        assertFalse(ExternalPlayer.parseExtras(0, emptyMap()).returned)
        // a duration alone tells nothing about where the user stopped
        assertFalse(ExternalPlayer.parseExtras(-1, mapOf("duration" to 100)).returned)
        assertFalse(ExternalPlayer.parseExtras(-1, mapOf("position" to "oops", "duration" to -3)).returned)
    }

    @Test
    fun theResultJsonHasOnlyTheKnownFields() {
        val none = ExternalPlayer.parseExtras(0, null).toJson()
        assertEquals(false, none.getBoolean("returned"))
        assertFalse(none.has("positionMs"))
        val r = ExternalPlayer.parseExtras(-1, mapOf("position" to 5_000, "end_by" to "user")).toJson()
        assertEquals(true, r.getBoolean("returned"))
        assertEquals(5_000L, r.getLong("positionMs"))
        assertFalse(r.has("durationMs"))
        assertEquals(false, r.getBoolean("ended"))
    }
}
