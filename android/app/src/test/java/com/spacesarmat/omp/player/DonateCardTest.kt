package com.spacesarmat.omp.player

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** «Поддержать» of the native player: the page's QR message and where the card shows (no Activity needed). */
class DonateCardTest {
    private val bits21 = "10".repeat(221).substring(0, 441)

    @Test
    fun parsesAValidCard() {
        val d = DonateQr.parse(JSONObject().put("modules", 21).put("bits", bits21).put("label", "boosty.to/djmaker"))
        assertNotNull(d)
        assertEquals(21, d!!.modules)
        assertEquals("boosty.to/djmaker", d.label)
        assertTrue(d.dark(0, 0))
        assertFalse(d.dark(1, 0))
    }

    @Test
    fun rejectsMalformedCards() {
        assertNull(DonateQr.parse(null))
        assertNull(DonateQr.parse(JSONObject().put("modules", 21).put("bits", bits21.substring(1))))
        assertNull(DonateQr.parse(JSONObject().put("modules", 20).put("bits", "1".repeat(400))))
        assertNull(DonateQr.parse(JSONObject().put("modules", 21).put("bits", "2" + bits21.substring(1))))
    }

    @Test
    fun playRequestCarriesTheCardOnlyWhenSent() {
        val queue = JSONArray().put(JSONObject().put("url", "http://h/1"))
        assertNull(PlayRequest.parse(JSONObject().put("queue", queue))!!.donate)
        val withCard = JSONObject().put("queue", queue).put("donate", JSONObject().put("modules", 21).put("bits", bits21).put("label", "x"))
        assertNotNull(PlayRequest.parse(withCard)!!.donate)
    }

    @Test
    fun modeOnPauseInTheCreditsAndOtherwiseNone() {
        // pause
        assertEquals(DonateQr.PAUSE, DonateQr.mode(true, false, true, false, 100_000, 1_000_000, null))
        // playing: none; inside the known credits or the next-episode countdown: credits
        assertEquals(DonateQr.NONE, DonateQr.mode(true, false, false, false, 100_000, 1_000_000, 900_000))
        assertEquals(DonateQr.CREDITS, DonateQr.mode(true, false, false, false, 900_000, 1_000_000, 900_000))
        assertEquals(DonateQr.CREDITS, DonateQr.mode(true, false, true, true, 1_000_000, 1_000_000, null))
        // unknown credits near the end: none
        assertEquals(DonateQr.NONE, DonateQr.mode(true, false, false, false, 990_000, 1_000_000, null))
        // supporter / no card sent, error: none
        assertEquals(DonateQr.NONE, DonateQr.mode(false, false, true, false, 100_000, 1_000_000, null))
        assertEquals(DonateQr.NONE, DonateQr.mode(true, true, true, false, 100_000, 1_000_000, null))
    }

    @Test
    fun hideCommandIsAcceptedWithoutAPlayer() {
        assertTrue(NativePlayerBridge.donate(JSONObject().put("type", "donate").put("on", false)))
        assertTrue(NativePlayerBridge.donate(JSONObject().put("type", "donate").put("on", true)))
    }
}
