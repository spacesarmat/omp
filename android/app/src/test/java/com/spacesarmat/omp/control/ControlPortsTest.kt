package com.spacesarmat.omp.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket

class ControlPortsTest {
    @Test
    fun theFirstFreePortWins() {
        val tried = ArrayList<Int>()
        val r = ControlPorts.bindFirst(TvRemote.PORTS) { p ->
            tried.add(p)
            if (p < 8097) throw IOException("taken")
            "server $p"
        }
        assertEquals(8097 to "server 8097", r)
        assertEquals(listOf(8095, 8096, 8097), tried)
    }

    @Test
    fun allTakenGivesNull() {
        assertNull(ControlPorts.bindFirst(listOf(8095, 8096)) { throw IOException("taken") })
    }

    @Test
    fun aRealServerMovesOnWhenItsPortIsTaken() {
        val blocker = ServerSocket()
        blocker.bind(InetSocketAddress(0))
        val taken = blocker.localPort
        try {
            val r = ControlPorts.bindFirst(listOf(taken, 0)) { p ->
                val s = ControlServer(p) { ControlResponse(200, "{}") }
                s.start()
                s
            }!!
            assertEquals(0, r.first)
            assertTrue(r.second.localPort > 0 && r.second.localPort != taken)
            r.second.stop()
        } finally {
            blocker.close()
        }
    }
}
