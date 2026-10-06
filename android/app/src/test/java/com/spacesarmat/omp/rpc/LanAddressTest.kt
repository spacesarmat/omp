package com.spacesarmat.omp.rpc

import java.net.InetAddress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanAddressTest {
    @Test
    fun ranges() {
        listOf("192.168.1.5", "10.0.0.2", "172.16.4.1", "172.31.255.1", "169.254.3.3", "fe80::1", "fd00::5", "::ffff:192.168.0.7")
            .forEach { assertTrue(it, LanAddress.allowed(InetAddress.getByName(it))) }
        listOf("127.0.0.1", "8.8.8.8", "100.64.0.1", "172.32.0.1", "::1", "2001:db8::1", "::ffff:8.8.8.8", "0.0.0.0")
            .forEach { assertFalse(it, LanAddress.allowed(InetAddress.getByName(it))) }
        assertFalse(LanAddress.allowed(null))
    }
}
