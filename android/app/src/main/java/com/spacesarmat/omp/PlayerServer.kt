package com.spacesarmat.omp

import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.json.JSONArray

/**
 * Tiny HTTP/1.1 server the TV player posts its state to (`POST /omp/<token>`, text/plain JSON).
 * Every response carries the queued commands `{"cmds":[...]}` (each delivered once; commands older than
 * [CMD_TTL_MS] are dropped so they never reach a later TV session). Only the current TV may connect;
 * starting for another TV rotates the token (new URL). One accept thread plus at most [WORKERS] connection threads, all daemons.
 */
class PlayerServer(private val onMessage: (String) -> Unit) {
    private class Running(
        val socket: ServerSocket,
        val workers: ThreadPoolExecutor,
        val local: InetAddress,
        val tvIp: String,
        val url: String,
    )

    private class Queued(val at: Long, val cmd: Any)

    private val lock = Any()
    private var running: Running? = null
    private val queue = ArrayDeque<Queued>()

    /** Starts (or reuses, for the same TV) the server on the interface that reaches [tvIp]; returns the report URL. */
    @Synchronized
    @Throws(IOException::class, UserError::class)
    fun start(tvIp: String): String {
        val local = localAddressFor(tvIp)
        synchronized(lock) {
            running?.let { if (it.local == local && it.tvIp == tvIp && !it.socket.isClosed) return it.url }
        }
        stop()
        val server = ServerSocket()
        try {
            server.reuseAddress = true
            server.bind(InetSocketAddress(local, 0))
        } catch (e: IOException) {
            closeQuietly(server)
            throw e
        }
        val token = newToken()
        val url = "http://${local.hostAddress}:${server.localPort}/omp/$token"
        val workers = ThreadPoolExecutor(
            WORKERS, WORKERS, 30, TimeUnit.SECONDS, ArrayBlockingQueue(BACKLOG),
        ) { r -> Thread(r, "omp-player-conn").apply { isDaemon = true } }
        workers.allowCoreThreadTimeOut(true)
        val run = Running(server, workers, local, tvIp, url)
        synchronized(lock) { running = run }
        Thread({ acceptLoop(run, "/omp/$token") }, "omp-player-accept").apply {
            isDaemon = true
            start()
        }
        return url
    }

    fun stop() {
        val run = synchronized(lock) {
            val r = running
            running = null
            queue.clear()
            r
        } ?: return
        closeQuietly(run.socket)
        run.workers.shutdownNow()
    }

    /** Appends commands for the next response; the queue keeps the newest [MAX_QUEUE]. */
    fun enqueue(cmds: JSONArray) {
        val now = nowMs()
        synchronized(lock) {
            for (i in 0 until cmds.length()) {
                queue.addLast(Queued(now, cmds.get(i)))
                while (queue.size > MAX_QUEUE) queue.removeFirst()
            }
        }
    }

    /** Takes the queued commands, dropping those older than [CMD_TTL_MS]. */
    private fun drain(): JSONArray {
        val now = nowMs()
        return synchronized(lock) {
            val arr = JSONArray()
            for (q in queue) if (now - q.at <= CMD_TTL_MS) arr.put(q.cmd)
            queue.clear()
            arr
        }
    }

    private fun acceptLoop(run: Running, path: String) {
        while (!run.socket.isClosed) {
            val client = try {
                run.socket.accept()
            } catch (_: IOException) {
                break
            }
            try {
                run.workers.execute { handle(client, run.tvIp, path) }
            } catch (_: RejectedExecutionException) {
                closeQuietly(client)
            }
        }
        closeQuietly(run.socket)
    }

    private fun handle(client: Socket, tvIp: String, path: String) {
        try {
            client.soTimeout = READ_TIMEOUT_MS
            val out = client.getOutputStream()
            if (client.inetAddress?.hostAddress != tvIp) {
                respond(out, 404, "Not Found")
                return
            }
            val input = BufferedInputStream(client.getInputStream())
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(' ')
            if (parts.size < 3) {
                respond(out, 400, "Bad Request")
                return
            }
            val method = parts[0].uppercase()
            val target = parts[1].substringBefore('?')
            var length = 0L
            var lines = 0
            while (true) {
                val line = readLine(input) ?: return
                if (line.isEmpty()) break
                if (++lines > MAX_HEADERS) {
                    respond(out, 431, "Request Header Fields Too Large")
                    return
                }
                val colon = line.indexOf(':')
                if (colon > 0 && line.substring(0, colon).trim().equals("Content-Length", ignoreCase = true)) {
                    length = line.substring(colon + 1).trim().toLongOrNull() ?: -1L
                }
            }
            val pathOk = MessageDigest.isEqual(target.toByteArray(), path.toByteArray())
            when {
                method == "OPTIONS" -> respond(out, 204, "No Content")
                method != "POST" || !pathOk -> respond(out, 404, "Not Found")
                length < 0 -> respond(out, 400, "Bad Request")
                length > MAX_BODY -> respond(out, 413, "Payload Too Large")
                else -> {
                    val body = readBody(input, length.toInt()) ?: return
                    onMessage(String(body, Charsets.UTF_8))
                    val json = "{\"cmds\":${drain()}}".toByteArray(Charsets.UTF_8)
                    respond(out, 200, "OK", json)
                }
            }
        } catch (_: Exception) {
            // one bad connection never affects the server
        } finally {
            closeQuietly(client)
        }
    }

    private fun respond(out: OutputStream, code: Int, reason: String, body: ByteArray? = null) {
        val head = StringBuilder()
            .append("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n")
            .append("Access-Control-Allow-Origin: *\r\n")
            .append("Access-Control-Allow-Methods: POST, OPTIONS\r\n")
            .append("Access-Control-Allow-Headers: Content-Type\r\n")
            .append("Access-Control-Max-Age: 600\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Connection: close\r\n")
        if (body != null) head.append("Content-Type: application/json\r\n")
        head.append("Content-Length: ").append(body?.size ?: 0).append("\r\n\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        if (body != null) out.write(body)
        out.flush()
    }

    companion object {
        private const val WORKERS = 4
        private const val BACKLOG = 16
        private const val MAX_QUEUE = 50
        private const val MAX_BODY = 65_536L
        private const val MAX_LINE = 8_192
        private const val MAX_HEADERS = 100
        private const val READ_TIMEOUT_MS = 5_000
        private const val CMD_TTL_MS = 3_000L
        private val random = SecureRandom()

        private val IPV4 = Regex("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$")

        /** Local IPv4 address the OS would use to reach [tvIp] (UDP connect sends no packets). */
        @Throws(IOException::class, UserError::class)
        fun localAddressFor(tvIp: String): InetAddress {
            if (!IPV4.matches(tvIp)) throw UserError(I18n.s("plugin.badTvAddr2"))
            val local = DatagramSocket().use { s ->
                s.connect(InetAddress.getByName(tvIp), 9)
                s.localAddress
            }
            if (local !is Inet4Address || local.isAnyLocalAddress || local.isLoopbackAddress) {
                throw UserError(I18n.s("errors.noNetTv"))
            }
            return local
        }

        private fun nowMs(): Long = System.nanoTime() / 1_000_000

        private fun newToken(): String {
            val bytes = ByteArray(16)
            random.nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        }

        /** ASCII line without CRLF; null at EOF; throws when longer than [MAX_LINE]. */
        private fun readLine(input: InputStream): String? {
            val sb = StringBuilder()
            while (true) {
                val b = input.read()
                if (b < 0) return if (sb.isEmpty()) null else sb.toString()
                if (b == '\n'.code) break
                if (b != '\r'.code) sb.append(b.toChar())
                if (sb.length > MAX_LINE) throw IOException("line too long")
            }
            return sb.toString()
        }

        private fun readBody(input: InputStream, length: Int): ByteArray? {
            val buf = ByteArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(buf, read, length - read)
                if (n < 0) return null
                read += n
            }
            return buf
        }

        private fun closeQuietly(c: java.io.Closeable) {
            try {
                c.close()
            } catch (_: IOException) {
            }
        }
    }
}
