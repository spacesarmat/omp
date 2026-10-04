package com.spacesarmat.omp.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** End of item, countdowns, Play at the end, next-item warm-up, state de-duplication. */
class PlayerFlowTest {
    private val flow = PlayerFlow()

    @Test
    fun endWithNextStartsTheFiveSecondCountdownThenGoesOn() {
        assertEquals(PlayerFlow.End.COUNTDOWN, flow.itemEnded(hasNext = true, autoNext = true))
        assertEquals(5, flow.countdown)
        repeat(4) { assertFalse(flow.second()) }
        assertTrue(flow.second())
    }

    @Test
    fun endWithoutNextOrAutoNextCloses() {
        assertEquals(PlayerFlow.End.CLOSE, flow.itemEnded(hasNext = false, autoNext = true))
        assertEquals(PlayerFlow.End.CLOSE, PlayerFlow().itemEnded(hasNext = true, autoNext = false))
    }

    @Test
    fun endDuringTheEndCountdownIsIgnored() {
        flow.itemEnded(true, true)
        assertEquals(PlayerFlow.End.NONE, flow.itemEnded(true, true))
        assertEquals(5, flow.countdown)
    }

    @Test
    fun creditsCountdownGivesWayToTheEndOne() {
        assertTrue(flow.creditsDue(hasNext = true, autoNext = true, playing = true))
        assertEquals(10, flow.countdown)
        assertTrue(flow.creditsCountdown)
        flow.second()
        assertEquals(PlayerFlow.End.COUNTDOWN, flow.itemEnded(true, true))
        assertEquals(5, flow.countdown)
        assertFalse(flow.creditsCountdown)
    }

    @Test
    fun creditsCountdownNeedsNextAutoNextPlayingAndNoRunningCountdown() {
        assertFalse(flow.creditsDue(hasNext = false, autoNext = true, playing = true))
        assertFalse(flow.creditsDue(hasNext = true, autoNext = false, playing = true))
        assertFalse(flow.creditsDue(hasNext = true, autoNext = true, playing = false))
        flow.itemEnded(true, true)
        assertFalse(flow.creditsDue(true, true, true))
        assertFalse(flow.creditsCountdown)
    }

    @Test
    fun playAfterBackOnTheEndCountdownGoesToTheNextItem() {
        flow.itemEnded(true, true)
        flow.cancel() // Back
        assertEquals(PlayerFlow.Play.NEXT, flow.playPressed(playing = false, hasNext = true))
        assertEquals(PlayerFlow.Play.CLOSE, flow.playPressed(playing = false, hasNext = false))
        assertEquals(PlayerFlow.Play.PAUSE, flow.playPressed(playing = true, hasNext = true))
    }

    @Test
    fun movingOrEnteringLeavesTheEnd() {
        flow.itemEnded(true, true)
        flow.cancel()
        flow.moved()
        assertEquals(PlayerFlow.Play.PLAY, flow.playPressed(false, true))
        flow.itemEnded(true, true)
        flow.entered()
        assertEquals(-1, flow.countdown)
        assertEquals(PlayerFlow.Play.PLAY, flow.playPressed(false, true))
    }

    @Test
    fun queueReplaceResetsEverything() {
        flow.creditsDue(true, true, true)
        assertTrue(flow.preloadDue(0, true, true, 0, 0))
        flow.reset()
        assertEquals(-1, flow.countdown)
        assertFalse(flow.creditsCountdown)
        assertFalse(flow.ended)
        flow.itemEnded(true, true)
        assertTrue(flow.preloadDue(0, true, false, 0, 0))
    }

    @Test
    fun preloadOncePerNextItemOnCountdownOrNearTheEnd() {
        // far from the end, no countdown
        assertFalse(flow.preloadDue(0, true, true, 100_000, 3_600_000))
        // last minute while playing
        assertTrue(flow.preloadDue(0, true, true, 3_550_000, 3_600_000))
        assertFalse(flow.preloadDue(0, true, true, 3_560_000, 3_600_000))
        // paused near the end: no
        assertFalse(flow.preloadDue(1, true, false, 3_550_000, 3_600_000))
        // a countdown: yes, even paused
        flow.itemEnded(true, true)
        assertTrue(flow.preloadDue(1, true, false, 3_600_000, 3_600_000))
        // no next item: never
        assertFalse(PlayerFlow().preloadDue(2, false, true, 3_590_000, 3_600_000))
    }

    @Test
    fun preloadRequestForTorrServerStreams() {
        val r = NextPreload.request("http://admin:p%40ss+1@192.168.1.5:8090/stream/Movie%20A.mkv?link=abc&index=2&play")!!
        assertEquals("http://192.168.1.5:8090/stream/Movie%20A.mkv?link=abc&index=2&preload", r.url)
        assertEquals("Basic " + java.util.Base64.getEncoder().encodeToString("admin:p@ss+1".toByteArray()), r.authorization)
        val plain = NextPreload.request("https://ts.example/stream?link=h&index=0&play&preload&stat")!!
        assertEquals("https://ts.example/stream?link=h&index=0&preload", plain.url)
        assertNull(plain.authorization)
    }

    @Test
    fun noPreloadForOtherUrls() {
        assertNull(NextPreload.request("http://h/video.mkv"))
        assertNull(NextPreload.request("http://h/stream/x?index=1&play"))
        assertNull(NextPreload.request("file:///sdcard/a.mkv"))
        assertNull(NextPreload.request("not a url"))
    }

    private fun snap(time: Double, paused: Boolean = false) =
        PlayerSnapshot(0, time, 100.0, paused, false, emptyList(), -1, emptyList(), "off")

    @Test
    fun identicalStatesWithinHalfASecondAreDropped() {
        val d = StateDeduper()
        assertTrue(d.shouldEmit(snap(1.0), 0))
        assertFalse(d.shouldEmit(snap(1.0), 100))
        assertTrue(d.shouldEmit(snap(1.0, paused = true), 150))
        // the 1 s heartbeat of a paused player still goes out
        assertTrue(d.shouldEmit(snap(1.0, paused = true), 1150))
        d.reset()
        assertTrue(d.shouldEmit(snap(1.0, paused = true), 1200))
    }
}
