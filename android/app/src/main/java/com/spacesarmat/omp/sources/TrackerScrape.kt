package com.spacesarmat.omp.sources

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Random
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Tracker scrape from this device. HTTP(S) replaces announce with scrape (the path must contain "scrape") and returns
 * the body as Latin-1 so the 20-byte infohash survives. UDP is BEP 15 (connect, then scrape). Cleartext is allowed
 * here on purpose: magnet trackers are often plain HTTP, and the URL is limited to a scrape path on the host the
 * magnet named. Redirects stay on that host. Nothing is logged (a passkey can sit in the query).
 */
object TrackerScrape {
    const val MAX_BYTES = 262144
    private const val MAGIC = 0x41727101980L
    private const val ACTION_CONNECT = 0
    private const val ACTION_SCRAPE = 2

    data class Counts(val seeders: Long, val completed: Long, val leechers: Long)

    private val running = ConcurrentHashMap<String, () -> Unit>()
    private val httpClient = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()

    fun cancel(id: String) {
        running.remove(id)?.invoke()
    }

    /** http(s) URL whose path contains "scrape" and has no user info. */
    fun allowHttp(url: String): HttpUrl? {
        val u = url.toHttpUrlOrNull() ?: return null
        if (u.scheme != "http" && u.scheme != "https") return null
        if (u.username.isNotEmpty()) return null
        if (!u.encodedPath.lowercase().contains("scrape")) return null
        if (u.host.isEmpty()) return null
        return u
    }

    fun hexToBytes(hex: String): ByteArray? {
        if (!hex.matches(Regex("^[0-9a-fA-F]{40}$"))) return null
        return ByteArray(20) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    fun connectRequest(tx: Int): ByteArray {
        val buf = ByteBuffer.allocate(16).order(ByteOrder.BIG_ENDIAN)
        buf.putLong(MAGIC)
        buf.putInt(ACTION_CONNECT)
        buf.putInt(tx)
        return buf.array()
    }

    /** Connection id, or null when the packet is not the connect reply for [tx]. */
    fun readConnect(packet: ByteArray, len: Int, tx: Int): Long? {
        if (len < 16) return null
        val buf = ByteBuffer.wrap(packet, 0, 16).order(ByteOrder.BIG_ENDIAN)
        val action = buf.int
        val got = buf.int
        if (action != ACTION_CONNECT || got != tx) return null
        return buf.long
    }

    fun scrapeRequest(connectionId: Long, tx: Int, infohash: ByteArray): ByteArray {
        val buf = ByteBuffer.allocate(16 + infohash.size).order(ByteOrder.BIG_ENDIAN)
        buf.putLong(connectionId)
        buf.putInt(ACTION_SCRAPE)
        buf.putInt(tx)
        buf.put(infohash)
        return buf.array()
    }

    /** Seeders / completed / leechers, or null for an error packet or a mismatched transaction. */
    fun readScrape(packet: ByteArray, len: Int, tx: Int): Counts? {
        if (len < 20) return null
        val buf = ByteBuffer.wrap(packet, 0, len).order(ByteOrder.BIG_ENDIAN)
        val action = buf.int
        val got = buf.int
        if (action != ACTION_SCRAPE || got != tx) return null
        val seeders = buf.int.toLong() and 0xffffffffL
        val completed = buf.int.toLong() and 0xffffffffL
        val leechers = buf.int.toLong() and 0xffffffffL
        return Counts(seeders, completed, leechers)
    }

    fun latin1(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size)
        for (b in bytes) sb.append((b.toInt() and 0xff).toChar())
        return sb.toString()
    }

    /** Blocking. Throws [IOException] when the tracker does not answer with a scrape body. */
    fun http(id: String, url: String, timeoutMs: Int): String {
        var current = allowHttp(url) ?: throw IOException("bad-url")
        val client = httpClient.newBuilder()
            .connectTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .build()
        var hops = 0
        while (true) {
            val req = Request.Builder().url(current).get().header("User-Agent", "OMP").header("Accept", "*/*").build()
            val call = client.newCall(req)
            val stop = { call.cancel() }
            running[id] = stop
            try {
                call.execute().use { resp ->
                    if (resp.code in 300..399) {
                        if (hops >= 2) throw IOException("no-answer")
                        val loc = resp.header("Location") ?: throw IOException("no-answer")
                        val next = current.resolve(loc) ?: throw IOException("no-answer")
                        if (!next.host.equals(current.host, ignoreCase = true)) throw IOException("no-answer")
                        current = allowHttp(next.toString()) ?: throw IOException("no-answer")
                        hops++
                        return@use
                    }
                    if (resp.code !in 200..299) throw IOException("no-answer")
                    val body = resp.body ?: throw IOException("no-answer")
                    return latin1(readLimited(body.byteStream()))
                }
            } finally {
                running.remove(id, stop)
            }
        }
    }

    /** Blocking. Null when the tracker does not answer. */
    fun udp(id: String, host: String, port: Int, infohash: String, timeoutMs: Int): Counts? {
        if (!hostOk(host) || port !in 1..65535) return null
        val hash = hexToBytes(infohash) ?: return null
        val socket = DatagramSocket()
        val stop = {
            try {
                socket.close()
            } catch (_: Exception) {
            }
        }
        running[id] = stop
        try {
            socket.soTimeout = timeoutMs
            val addr = InetAddress.getByName(host)
            val rnd = Random()
            val tx1 = rnd.nextInt()
            val connect = connectRequest(tx1)
            socket.send(DatagramPacket(connect, connect.size, addr, port))
            val buf = ByteArray(256)
            val first = DatagramPacket(buf, buf.size)
            socket.receive(first)
            val conn = readConnect(first.data, first.length, tx1) ?: return null
            val tx2 = rnd.nextInt()
            val scrape = scrapeRequest(conn, tx2, hash)
            socket.send(DatagramPacket(scrape, scrape.size, addr, port))
            val second = DatagramPacket(buf, buf.size)
            socket.receive(second)
            return readScrape(second.data, second.length, tx2)
        } catch (_: Exception) {
            return null
        } finally {
            running.remove(id, stop)
            stop()
        }
    }

    private fun hostOk(host: String): Boolean {
        if (host.isEmpty() || host.length > 253) return false
        return host.none { it.isWhitespace() || it == '/' || it == '@' || it == '\\' }
    }

    private fun readLimited(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        var total = 0
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_BYTES) throw IOException("too-big")
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
