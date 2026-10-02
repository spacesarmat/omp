package com.spacesarmat.omp.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTest {
    private var now = 1_000_000L
    private val store = object : PhoneStore {
        var saved: List<PairedPhone> = emptyList()
        override fun load() = saved
        override fun save(phones: List<PairedPhone>) {
            saved = phones
        }
    }
    private val pairing = Pairing(store, { now })

    private fun paired(r: Pairing.Result) = r as Pairing.Result.Paired
    private fun refused(r: Pairing.Result) = (r as Pairing.Result.Refused).error

    @Test
    fun codeIsFourDigitsValidFiveMinutes() {
        val c = pairing.newCode()
        assertTrue(Regex("^[0-9]{4}$").matches(c.code))
        assertEquals(now + 300_000L, c.expiresAt)
    }

    @Test
    fun rightCodeGivesTokenOnce() {
        val c = pairing.newCode()
        val p = paired(pairing.pair(c.code, "Pixel 8"))
        assertTrue(Regex("^[0-9a-f]{32}$").matches(p.token))
        assertEquals("Pixel 8", p.phone)
        assertTrue(pairing.isPaired(p.token))
        assertFalse(pairing.isPaired("0".repeat(32)))
        assertFalse(pairing.isPaired(null))
        assertEquals(1, store.saved.size)
        // used up
        assertEquals(Pairing.EXPIRED, refused(pairing.pair(c.code, "x")))
    }

    @Test
    fun expiredCode() {
        val c = pairing.newCode()
        now += 300_000L
        assertEquals(Pairing.EXPIRED, refused(pairing.pair(c.code, null)))
        assertEquals(Pairing.EXPIRED, refused(Pairing(store, { now }).pair("1234", null)))
    }

    @Test
    fun onlyTheLatestCodeIsValid() {
        var first = pairing.newCode()
        var second = pairing.newCode()
        while (second.code == first.code) {
            first = second
            second = pairing.newCode()
        }
        assertEquals(Pairing.BAD_CODE, refused(pairing.pair(first.code, null)))
        paired(pairing.pair(second.code, null))
    }

    @Test
    fun fiveWrongCodesInvalidateTheCode() {
        val c = pairing.newCode()
        val wrong = if (c.code == "0000") "0001" else "0000"
        repeat(5) { assertEquals(Pairing.BAD_CODE, refused(pairing.pair(wrong, null))) }
        assertEquals(Pairing.EXPIRED, refused(pairing.pair(c.code, null)))
        // a new code starts a fresh count
        val n = pairing.newCode()
        repeat(4) { pairing.pair(if (n.code == "0000") "0001" else "0000", null) }
        paired(pairing.pair(n.code, null))
    }

    @Test
    fun keepsTenPhonesEvictingTheOldest() {
        val tokens = (1..11).map {
            now += 1
            paired(pairing.pair(pairing.newCode().code, "p$it")).token
        }
        assertEquals(10, store.saved.size)
        assertEquals("p2", store.saved.first().phone)
        assertFalse(pairing.isPaired(tokens[0]))
        assertTrue(pairing.isPaired(tokens[10]))
        // reloaded from the store
        assertTrue(Pairing(store, { now }).isPaired(tokens[1]))
    }

    @Test
    fun phoneNameIsCleaned() {
        assertEquals("Телефон", Pairing.cleanName(null))
        assertEquals("Телефон", Pairing.cleanName("  \n "))
        assertEquals("ab", Pairing.cleanName(" a\u0000b "))
        assertEquals(64, Pairing.cleanName("x".repeat(100)).length)
    }
}
