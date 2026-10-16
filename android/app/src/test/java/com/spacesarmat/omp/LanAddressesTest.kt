package com.spacesarmat.omp

import java.net.InetAddress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LanAddressesTest {
    @Test
    fun localClients() {
        assertTrue(LanAddresses.isLocalClient(InetAddress.getByName("127.0.0.1")))
        assertTrue(LanAddresses.isLocalClient(InetAddress.getByName("192.168.1.10")))
        assertTrue(LanAddresses.isLocalClient(InetAddress.getByName("10.0.0.2")))
        assertTrue(LanAddresses.isLocalClient(InetAddress.getByName("172.16.5.1")))
        assertFalse(LanAddresses.isLocalClient(InetAddress.getByName("8.8.8.8")))
        assertFalse(LanAddresses.isLocalClient(null))
    }

    @Test
    fun publicIpHosts() {
        assertTrue(LanAddresses.isPublicIpHost("8.8.8.8"))
        assertFalse(LanAddresses.isPublicIpHost("192.168.0.1"))
        assertFalse(LanAddresses.isPublicIpHost("127.0.0.1"))
        assertFalse(LanAddresses.isPublicIpHost("torrent.by"))
        assertFalse(LanAddresses.isPublicIpHost(null))
    }
}
