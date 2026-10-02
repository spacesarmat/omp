package com.spacesarmat.omp.player

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Segments of the page: session filter and queueing until the player takes them (no Activity needed). */
class NativePlayerBridgeTest {
    private fun item(i: Int) = ItemSkip(i, emptyList(), null, null, false, false, null, null, null)

    private fun request(session: Long?) =
        PlayRequest(listOf(QueueItem("http://h/1", "t", null, null, emptyList(), 0)), 0, 0, 10, true, "", "", false, session)

    private fun segments(index: Int, session: Long?): JSONObject {
        val o = JSONObject().put("type", "segments").put("index", index).put("chapters", org.json.JSONArray())
        if (session != null) o.put("session", session)
        return o
    }

    @After
    fun tearDown() {
        NativePlayerBridge.request = null
        NativePlayerBridge.resetSkips()
    }

    @Test
    fun sameRun() {
        assertTrue(SkipInbox.sameRun(3, 3))
        assertFalse(SkipInbox.sameRun(2, 3))
        assertTrue(SkipInbox.sameRun(null, 3))
        assertTrue(SkipInbox.sameRun(2, null))
    }

    @Test
    fun inboxQueuesTakesAndResets() {
        val box = SkipInbox()
        assertTrue(box.add(item(0), 5, 5))
        assertFalse(box.add(item(1), 4, 5))
        assertTrue(box.add(item(2), null, 5))
        assertEquals(listOf(0, 2), box.take().map { it.index })
        assertTrue(box.take().isEmpty())
        box.add(item(3), 5, 5)
        box.reset()
        assertTrue(box.take().isEmpty())
    }

    @Test
    fun bridgeKeepsMessagesOfTheCurrentRunUntilTheyAreTaken() {
        NativePlayerBridge.request = request(7)
        // no player yet: queued
        assertTrue(NativePlayerBridge.segments(segments(0, 7)))
        // another run: rejected
        assertFalse(NativePlayerBridge.segments(segments(1, 6)))
        // malformed: rejected
        assertFalse(NativePlayerBridge.segments(JSONObject().put("type", "segments")))
        // a replacing queue: messages of the new run wait for the player to load it
        NativePlayerBridge.request = request(8)
        assertTrue(NativePlayerBridge.segments(segments(2, 8)))
        assertEquals(listOf(0, 2), NativePlayerBridge.takeSkips().map { it.index })
        assertTrue(NativePlayerBridge.takeSkips().isEmpty())
    }

    @Test
    fun aNewPlayNativeDropsQueuedMessages() {
        NativePlayerBridge.request = request(7)
        NativePlayerBridge.segments(segments(0, 7))
        NativePlayerBridge.resetSkips()
        assertTrue(NativePlayerBridge.takeSkips().isEmpty())
    }
}
