package com.spacesarmat.omp

import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import javax.net.ssl.SSLContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * Samsung Tizen remote websocket. The page builds the path and the JSON key.
 * The first text frame (the connect event, which may carry the token) is returned to the page.
 * The certificate is pinned on first use, the same way as an LG TV.
 */
object SamsungRemote {
    private const val PATH = "/api/v2/channels/samsung.remote.control"
    private val lock = Any()
    private var socket: WebSocket? = null
    private var client: OkHttpClient? = null
    private var host: String? = null
    private var hello: String = ""
    private val dead = AtomicBoolean(false)

    fun click(ip: String, path: String, body: String): String {
        if (!OmpNativePlugin.IPV4.matches(ip) || !path.startsWith(PATH)) throw IllegalArgumentException("bad")
        synchronized(lock) {
            try {
                if (socket == null || host != ip || dead.get()) {
                    closeLocked()
                    dead.set(false)
                    val opened = connect(ip, path)
                    if (dead.get()) {
                        opened.first.cancel()
                        throw IllegalStateException("closed")
                    }
                    socket = opened.first
                    host = ip
                    hello = opened.second
                }
                val live = socket ?: throw IllegalStateException("closed")
                if (!live.send(body)) {
                    dead.set(true)
                    closeLocked()
                    throw IllegalStateException("send")
                }
                return hello
            } catch (e: Exception) {
                dead.set(true)
                closeLocked()
                throw e
            }
        }
    }

    private fun closeLocked() {
        try {
            socket?.close(1000, null)
        } catch (_: Exception) {
        }
        socket = null
        client = null
        host = null
        hello = ""
    }

    private fun connect(ip: String, path: String): Pair<WebSocket, String> {
        try {
            return open("wss", ip, 8002, path)
        } catch (_: Exception) {
            return open("ws", ip, 8001, path)
        }
    }

    private fun open(scheme: String, ip: String, port: Int, path: String): Pair<WebSocket, String> {
        val builder = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS)
        if (scheme == "wss") {
            val tm = CertPins.trustManager(ip)
            val ctx = SSLContext.getInstance("TLS")
            ctx.init(null, arrayOf(tm), SecureRandom())
            builder.sslSocketFactory(ctx.socketFactory, tm)
            builder.hostnameVerifier { host, _ -> host == ip }
        }
        val http = builder.build()
        client = http
        val url = "$scheme://$ip:$port$path"
        val hello = AtomicReference<String>("")
        val fail = AtomicReference<Throwable?>(null)
        val latch = CountDownLatch(1)
        val ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (hello.compareAndSet("", text)) latch.countDown()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                dead.set(true)
                fail.set(t)
                latch.countDown()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                dead.set(true)
            }
        })
        if (!latch.await(8, TimeUnit.SECONDS)) {
            dead.set(true)
            ws.cancel()
            throw IllegalStateException("timeout")
        }
        val err = fail.get()
        if (hello.get().isEmpty() && err != null) throw err
        if (scheme == "wss") CertPins.commit(ip)
        return ws to hello.get()
    }
}
