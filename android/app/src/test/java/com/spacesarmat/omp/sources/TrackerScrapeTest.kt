package com.spacesarmat.omp.sources

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackerScrapeTest {
    private val hash = "08ada5a7a6183aae1e09d831df6748d566095a10"

    @Test
    fun httpUrlMustBeAScrape() {
        assertNull(TrackerScrape.allowHttp("http://tracker.example/announce"))
        assertNull(TrackerScrape.allowHttp("http://user:secret@tracker.example/scrape"))
        assertNull(TrackerScrape.allowHttp("ftp://tracker.example/scrape"))
        assertTrue(TrackerScrape.allowHttp("http://tracker.example/scrape?info_hash=abc") != null)
        assertTrue(TrackerScrape.allowHttp("https://tracker.example/scrape.php") != null)
    }

    @Test
    fun httpBodyKeepsHighBytes() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody(Buffer().write(byteArrayOf(0x64, 0xff.toByte(), 0x65))))
        server.start()
        try {
            val text = TrackerScrape.http("h1", server.url("/scrape").toString(), 2000)
            assertEquals(3, text.length)
            assertEquals(0x64, text[0].code)
            assertEquals(0xff, text[1].code)
            assertEquals(0x65, text[2].code)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun httpRedirectStaysOnTheHost() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "http://evil.example/scrape"))
        server.start()
        try {
            var threw = false
            try {
                TrackerScrape.http("h2", server.url("/scrape").toString(), 2000)
            } catch (_: Exception) {
                threw = true
            }
            assertTrue(threw)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun bep15Packets() {
        val tx = 0x01020304
        val connect = TrackerScrape.connectRequest(tx)
        assertEquals(16, connect.size)
        assertEquals(tx, ByteBuffer.wrap(connect, 12, 4).order(ByteOrder.BIG_ENDIAN).int)
        val conn = TrackerScrape.readConnect(connectReply(tx, 0x1122334455667788L), 16, tx)
        assertEquals(0x1122334455667788L, conn)
        assertNull(TrackerScrape.readConnect(connectReply(tx, 1L), 16, tx + 1))

        val bytes = TrackerScrape.hexToBytes(hash)!!
        val scrape = TrackerScrape.scrapeRequest(conn!!, 7, bytes)
        assertEquals(36, scrape.size)
        assertArrayEquals(bytes, scrape.copyOfRange(16, 36))
        val reply = ByteBuffer.allocate(20).order(ByteOrder.BIG_ENDIAN)
        reply.putInt(2)
        reply.putInt(7)
        reply.putInt(11)
        reply.putInt(6)
        reply.putInt(3)
        val counts = TrackerScrape.readScrape(reply.array(), 20, 7)
        assertEquals(11L, counts!!.seeders)
        assertEquals(6L, counts.completed)
        assertEquals(3L, counts.leechers)
        assertNull(TrackerScrape.readScrape(reply.array(), 20, 8))
    }

    @Test
    fun udpRoundTrip() {
        val server = DatagramSocket(0)
        val port = server.localPort
        val thread = Thread {
            try {
                val buf = ByteArray(64)
                val first = DatagramPacket(buf, buf.size)
                server.receive(first)
                val tx = ByteBuffer.wrap(first.data, 12, 4).order(ByteOrder.BIG_ENDIAN).int
                val hello = connectReply(tx, 99L)
                server.send(DatagramPacket(hello, hello.size, first.address, first.port))
                val second = DatagramPacket(buf, buf.size)
                server.receive(second)
                val tx2 = ByteBuffer.wrap(second.data, 12, 4).order(ByteOrder.BIG_ENDIAN).int
                val reply = ByteBuffer.allocate(20).order(ByteOrder.BIG_ENDIAN)
                reply.putInt(2)
                reply.putInt(tx2)
                reply.putInt(9)
                reply.putInt(4)
                reply.putInt(2)
                val out = reply.array()
                server.send(DatagramPacket(out, out.size, second.address, second.port))
            } catch (_: Exception) {
                // the assertion below fails if the reply never arrives
            }
        }
        thread.isDaemon = true
        thread.start()
        try {
            val counts = TrackerScrape.udp("u1", "127.0.0.1", port, hash, 2000)
            assertEquals(9L, counts!!.seeders)
            assertEquals(4L, counts.completed)
            assertEquals(2L, counts.leechers)
        } finally {
            thread.join(3000)
            server.close()
        }
    }

    private fun connectReply(tx: Int, connectionId: Long): ByteArray {
        val buf = ByteBuffer.allocate(16).order(ByteOrder.BIG_ENDIAN)
        buf.putInt(0)
        buf.putInt(tx)
        buf.putLong(connectionId)
        return buf.array()
    }
}
