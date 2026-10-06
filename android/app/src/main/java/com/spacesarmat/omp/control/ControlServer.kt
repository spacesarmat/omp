package com.spacesarmat.omp.control

import java.io.BufferedInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** A parsed request to the control server: method, path (no query), bearer token, body (UTF-8), Content-Type. */
class ControlRequest(
    val method: String,
    val path: String,
    val token: String?,
    val body: String,
    val contentType: String? = null,
    /** The client's address (LAN checks of the phone RPC server). */
    val remote: InetAddress? = null,
    /** The phone's own address the connection arrived on (the phone RPC server refuses mobile-data interfaces). */
    val local: InetAddress? = null,
)

/** The request line and headers, before the body is read ([ControlServer] precheck). */
class ControlHead(
    val method: String,
    val path: String,
    val token: String?,
    val contentType: String?,
    val length: Long,
    val remote: InetAddress? = null,
    val local: InetAddress? = null,
)

/** The answer: HTTP status and a JSON body. */
class ControlResponse(val status: Int, val json: String)

/**
 * Minimal HTTP/1.1 server of the phone remote on Android TV (`/omp/...`, see the spec «Управление с телефона»),
 * bound to all interfaces on [port]. One request per connection, body ≤ [MAX_BODY], read timeout, one accept
 * thread plus at most [workers] connection threads (daemons, [WORKERS] by default). Routing and auth live in [handler].
 */
class ControlServer(
    private val port: Int,
    /** Answers from the headers alone (auth, size of a route), so such a body is never read; null = go on. */
    private val precheck: (ControlHead) -> ControlResponse? = { null },
    /** The Access-Control-Allow-Origin value for a request's Origin; null = no CORS grant. */
    private val cors: (origin: String?) -> String? = ::phoneCors,
    /** Connection threads; the phone RPC server matches its dispatcher's limit of waiting calls. */
    private val workers: Int = WORKERS,
    private val handler: (ControlRequest) -> ControlResponse,
) {
    private class Running(val socket: ServerSocket, val workers: ThreadPoolExecutor)

    private var running: Running? = null

    @Synchronized
    @Throws(IOException::class)
    fun start() {
        if (running?.socket?.isClosed == false) return
        val server = ServerSocket()
        try {
            server.reuseAddress = true
            server.bind(InetSocketAddress(port))
        } catch (e: IOException) {
            closeQuietly(server)
            throw e
        }
        val pool = ThreadPoolExecutor(
            workers, workers, 30, TimeUnit.SECONDS, ArrayBlockingQueue(BACKLOG),
        ) { r -> Thread(r, "omp-control-conn").apply { isDaemon = true } }
        pool.allowCoreThreadTimeOut(true)
        val run = Running(server, pool)
        running = run
        Thread({ acceptLoop(run) }, "omp-control-accept").apply {
            isDaemon = true
            start()
        }
    }

    /** The bound port (the one asked for, or the system's choice for 0); -1 when not running. */
    val localPort: Int
        @Synchronized get() = running?.socket?.localPort ?: -1

    @Synchronized
    fun stop() {
        val run = running ?: return
        running = null
        closeQuietly(run.socket)
        run.workers.shutdownNow()
    }

    private fun acceptLoop(run: Running) {
        while (!run.socket.isClosed) {
            val client = try {
                run.socket.accept()
            } catch (_: IOException) {
                break
            }
            try {
                run.workers.execute { handle(client) }
            } catch (_: RejectedExecutionException) {
                closeQuietly(client)
            }
        }
        closeQuietly(run.socket)
    }

    private fun handle(client: Socket) {
        try {
            client.soTimeout = READ_TIMEOUT_MS
            val remote: InetAddress? = client.inetAddress
            val local: InetAddress? = client.localAddress
            val out = client.getOutputStream()
            // a slow sender (one byte per read timeout) is cut at the overall deadline
            val input = BufferedInputStream(DeadlineInput(client, System.nanoTime() + REQUEST_DEADLINE_MS * 1_000_000))
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(' ')
            if (parts.size < 3) {
                respond(out, 400, error("bad_request"))
                return
            }
            val method = parts[0].uppercase()
            val path = parts[1].substringBefore('?')
            var length = 0L
            var token: String? = null
            var origin: String? = null
            var contentType: String? = null
            var lines = 0
            while (true) {
                val line = readLine(input) ?: return
                if (line.isEmpty()) break
                if (++lines > MAX_HEADERS) {
                    respond(out, 431, error("headers_too_large"))
                    return
                }
                val colon = line.indexOf(':')
                if (colon <= 0) continue
                val name = line.substring(0, colon).trim()
                val value = line.substring(colon + 1).trim()
                when {
                    name.equals("Content-Length", ignoreCase = true) -> length = value.toLongOrNull() ?: -1L
                    name.equals("Authorization", ignoreCase = true) && value.startsWith("Bearer ", ignoreCase = true) ->
                        token = value.substring(7).trim()
                    name.equals("Origin", ignoreCase = true) -> origin = value
                    name.equals("Content-Type", ignoreCase = true) -> contentType = value
                }
            }
            when {
                method == "OPTIONS" -> respond(out, 204, null, origin)
                length < 0 -> respond(out, 400, error("bad_request"), origin)
                else -> {
                    val early = try {
                        precheck(ControlHead(method, path, token, contentType, length, remote, local))
                    } catch (_: Exception) {
                        ControlResponse(500, error("internal"))
                    }
                    if (early != null) respond(out, early.status, early.json, origin) else readAndHandle(out, input, method, path, token, contentType, length, origin, remote, local)
                }
            }
        } catch (_: Exception) {
            // one bad connection never affects the server
        } finally {
            closeQuietly(client)
        }
    }

    private fun readAndHandle(
        out: OutputStream,
        input: InputStream,
        method: String,
        path: String,
        token: String?,
        contentType: String?,
        length: Long,
        origin: String?,
        remote: InetAddress?,
        local: InetAddress?,
    ) {
        when {
            length > MAX_BODY -> respond(out, 413, error("too_large"), origin)
            else -> {
                val body = readBody(input, length.toInt()) ?: return
                val res = try {
                    handler(ControlRequest(method, path, token, String(body, Charsets.UTF_8), contentType, remote, local))
                } catch (_: Exception) {
                    ControlResponse(500, error("internal"))
                }
                respond(out, res.status, res.json, origin)
            }
        }
    }

    private fun respond(out: OutputStream, code: Int, json: String?, origin: String? = null) {
        val body = json?.toByteArray(Charsets.UTF_8)
        val head = StringBuilder()
            .append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n")
        // the default rule grants CORS only to the phone app's WebView ([phoneCors]); the phone RPC server grants "*"
        val allow = try {
            cors(origin)
        } catch (_: Exception) {
            null
        }
        if (allow != null) {
            head.append("Access-Control-Allow-Origin: ").append(allow).append("\r\n")
                .append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
                .append("Access-Control-Allow-Headers: Content-Type, Authorization\r\n")
                .append("Access-Control-Max-Age: 600\r\n")
        }
        head.append("Vary: Origin\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Connection: close\r\n")
        if (body != null) head.append("Content-Type: application/json; charset=utf-8\r\n")
        head.append("Content-Length: ").append(body?.size ?: 0).append("\r\n\r\n")
        out.write(head.toString().toByteArray(Charsets.ISO_8859_1))
        if (body != null) out.write(body)
        out.flush()
    }

    companion object {
        const val MAX_BODY = 65_536L
        const val WORKERS = 4
        private const val BACKLOG = 16
        private const val MAX_LINE = 8_192
        private const val MAX_HEADERS = 100
        private const val READ_TIMEOUT_MS = 5_000
        private const val REQUEST_DEADLINE_MS = 10_000L

        /** Origins of the phone app's WebView (Capacitor androidScheme http/https, capacitor:// on iOS). */
        val PHONE_ORIGINS = setOf("http://localhost", "https://localhost", "capacitor://localhost")

        fun error(code: String) = "{\"error\":\"$code\"}"

        private fun reason(code: Int) = when (code) {
            200 -> "OK"
            204 -> "No Content"
            400 -> "Bad Request"
            401 -> "Unauthorized"
            403 -> "Forbidden"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            409 -> "Conflict"
            410 -> "Gone"
            413 -> "Payload Too Large"
            415 -> "Unsupported Media Type"
            431 -> "Request Header Fields Too Large"
            503 -> "Service Unavailable"
            else -> "Internal Server Error"
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

        /** Socket input whose every read waits at most until [deadline] (System.nanoTime), then fails. */
        private class DeadlineInput(private val socket: Socket, private val deadline: Long) : InputStream() {
            private val input = socket.getInputStream()

            private fun arm() {
                val left = (deadline - System.nanoTime()) / 1_000_000
                if (left <= 0) throw IOException("request deadline")
                socket.soTimeout = minOf(left, READ_TIMEOUT_MS.toLong()).toInt().coerceAtLeast(1)
            }

            override fun read(): Int {
                arm()
                return input.read()
            }

            override fun read(b: ByteArray, off: Int, len: Int): Int {
                arm()
                return input.read(b, off, len)
            }
        }

        private fun closeQuietly(c: Closeable) {
            try {
                c.close()
            } catch (_: IOException) {
            }
        }
    }
}

/** The default CORS rule: only the phone app's WebView may call with fetch, other web pages get no grant. */
fun phoneCors(origin: String?): String? = origin?.takeIf { it in ControlServer.PHONE_ORIGINS }
