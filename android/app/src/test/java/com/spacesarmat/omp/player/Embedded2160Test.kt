package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

/** The phone's embedded 2160 screen: what the request carries (no Activity needed). */
class Embedded2160Test {
    private val three = listOf(
        Player2160.Item("http://u:p%40ss@srv:8090/stream/1.mkv?link=h&index=1&play", "S01E01 · One"),
        Player2160.Item("http://u:p%40ss@srv:8090/stream/2.mkv?link=h&index=2&play", "S01E02"),
        Player2160.Item("http://u:p%40ss@srv:8090/stream/3.mkv?link=h&index=3&play", " "),
    )

    @Test
    fun credentialsBecomeOneBasicHeaderAndLeaveEveryUrl() {
        val p = Embedded2160.plan(three, 1, 0, true, "")
        assertEquals(
            listOf(
                "http://srv:8090/stream/1.mkv?link=h&index=1&play",
                "http://srv:8090/stream/2.mkv?link=h&index=2&play",
                "http://srv:8090/stream/3.mkv?link=h&index=3&play",
            ),
            p.entries.map { it.url },
        )
        val token = Base64.getEncoder().encodeToString("u:p@ss".toByteArray())
        assertEquals(mapOf("Authorization" to "Basic $token", "User-Agent" to "OMP"), p.headers)
    }

    @Test
    fun noCredentialsOnlyTheUserAgent() {
        val p = Embedded2160.plan(listOf(Player2160.Item("http://srv/a.mkv", "A")), 0, 0, true, "")
        assertEquals("http://srv/a.mkv", p.entries[0].url)
        assertEquals(mapOf("User-Agent" to "OMP"), p.headers)
    }

    @Test
    fun titlesAreTrimmedAndBlankOnesLeftTo2160() {
        val p = Embedded2160.plan(three, 0, 0, true, "")
        assertEquals("S01E01 · One", p.entries[0].title)
        assertNull(p.entries[2].title)
    }

    @Test
    fun startPositionIsAlwaysExplicit() {
        assertEquals(754_000L, Embedded2160.plan(three, 1, 754_000L, false, "").startPositionMs)
        // from the start, or no position: 0, never null (2160's own resume point would win)
        assertEquals(0L, Embedded2160.plan(three, 1, 754_000L, true, "").startPositionMs)
        assertEquals(0L, Embedded2160.plan(three, 1, 0L, false, "").startPositionMs)
        assertEquals(0L, Embedded2160.plan(three, 1, -5L, false, "").startPositionMs)
        assertEquals(Int.MAX_VALUE.toLong(), Embedded2160.plan(three, 1, Long.MAX_VALUE, false, "").startPositionMs)
    }

    @Test
    fun startIndexAndSegmentsAreKept() {
        val p = Embedded2160.plan(three, 2, 0, true, " intro:0-90000;credits:1320000- ")
        assertEquals(2, p.startIndex)
        assertEquals("intro:0-90000;credits:1320000-", p.segments)
        assertEquals(2, Embedded2160.plan(three, 7, 0, true, "").startIndex)
        assertEquals(0, Embedded2160.plan(three, -1, 0, true, "").startIndex)
    }
}
