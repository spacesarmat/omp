package com.spacesarmat.omp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeOnLanTest {
    @Test
    fun magicPacketIsSixFfAndTheMacSixteenTimes() {
        val p = WakeOnLan.magicPacket("AA:BB:CC:DD:EE:FF")!!
        assertEquals(102, p.size)
        for (i in 0 until 6) assertEquals(0xFF.toByte(), p[i])
        assertEquals(0xAA.toByte(), p[6])
        assertEquals(0xFF.toByte(), p[11])
        assertNull(WakeOnLan.magicPacket("nope"))
    }

    @Test
    fun targetsUseBothPortsAndTheReportedBroadcast() {
        val t = WakeOnLan.targets("192.168.1.5", "10.0.0.255")
        assertTrue(t.contains("255.255.255.255" to 9))
        assertTrue(t.contains("255.255.255.255" to 7))
        assertTrue(t.contains("10.0.0.255" to 9))
        assertTrue(t.contains("10.0.0.255" to 7))
        assertFalse(t.any { it.first == "192.168.1.255" })
    }

    @Test
    fun slash24WhenNoBroadcastWasReported() {
        val t = WakeOnLan.targets("192.168.1.5", null)
        assertTrue(t.contains("192.168.1.255" to 9))
        assertTrue(t.contains("192.168.1.255" to 7))
    }
}

class NetIdentityTest {
    @Test
    fun formatsAMacAndComputesABroadcast() {
        assertEquals("aa:bb:cc:dd:ee:ff", NetIdentity.formatMac(byteArrayOf(0xAA.toByte(), 0xBB.toByte(), 0xCC.toByte(), 0xDD.toByte(), 0xEE.toByte(), 0xFF.toByte())))
        assertNull(NetIdentity.formatMac(ByteArray(6)))
        assertEquals("192.168.1.255", NetIdentity.broadcast(byteArrayOf(192.toByte(), 168.toByte(), 1.toByte(), 40.toByte()), 24))
        assertEquals("10.1.255.255", NetIdentity.broadcast(byteArrayOf(10.toByte(), 1.toByte(), 2.toByte(), 3.toByte()), 16))
        assertNull(NetIdentity.broadcast(byteArrayOf(1.toByte(), 2.toByte(), 3.toByte()), 24))
    }
}

class CecPowerTest {
    @Test
    fun missingServiceDoesNothing() {
        assertFalse(CecPower.oneTouch(null))
    }

    @Test
    fun callsOneTouchPlayWhenTheMethodExists() {
        val box = object {
            var n = 0
            fun oneTouchPlay(cb: Any?) {
                n += 1
            }
        }
        assertTrue(CecPower.oneTouch(box))
        assertEquals(1, box.n)
    }
}

class IrBlasterTest {
    @Test
    fun stockTransmitterIsNotAReceiver() {
        assertFalse(IrBlaster.receiveExposed(listOf("hasIrEmitter", "transmit", "getCarrierFrequencies")))
        assertTrue(IrBlaster.receiveExposed(listOf("transmit", "learn")))
    }
}
