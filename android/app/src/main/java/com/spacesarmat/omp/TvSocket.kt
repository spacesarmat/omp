package com.spacesarmat.omp

import android.annotation.SuppressLint
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** OkHttp clients for talking to the TV. */
object TvHttp {
    private val base: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    /** Client for plain ws:// (system trust for anything else). */
    fun plain(): OkHttpClient = base

    /**
     * Client that accepts the TV's self-signed certificate. The trust-all manager lives only in
     * this client instance, and the hostname verifier only lets through [host] (the TV IP), so
     * the relaxed trust can never apply to any other server.
     */
    fun trustingOnly(host: String): OkHttpClient {
        val tm = AnyCertTrustManager()
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(tm), SecureRandom())
        return base.newBuilder()
            .sslSocketFactory(ctx.socketFactory, tm)
            .hostnameVerifier { name, _ -> name.equals(host, ignoreCase = true) }
            .connectionSpecs(listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS))
            .build()
    }

    @SuppressLint("CustomX509TrustManager", "TrustAllX509TrustManager")
    private class AnyCertTrustManager : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}

/**
 * One WebSocket to the TV. Callbacks run on OkHttp threads. [onOpen]/[onFail] fire at most once
 * and only before the socket opened; [onMessage]/[onClosed] only after it opened. After [close]
 * nothing is reported any more.
 */
class TvSocket(
    private val onOpen: (TvSocket) -> Unit,
    private val onFail: (String) -> Unit,
    private val onMessage: (String) -> Unit,
    private val onClosed: (String) -> Unit,
) {
    private val lock = Any()
    private var ws: WebSocket? = null
    private var opened = false
    private var finished = false

    /** Tries [urls] in order with matching [clients]; the next one is tried only if the previous failed to open. */
    fun connect(urls: List<String>, clients: List<OkHttpClient>) {
        attempt(urls, clients, 0, null)
    }

    private fun attempt(urls: List<String>, clients: List<OkHttpClient>, i: Int, lastError: String?) {
        synchronized(lock) { if (finished) return }
        if (i >= urls.size) {
            fail(lastError ?: "нет адреса")
            return
        }
        val request = try {
            Request.Builder().url(urls[i]).build()
        } catch (e: IllegalArgumentException) {
            attempt(urls, clients, i + 1, e.message)
            return
        }
        val socket = clients[i].newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val ok = synchronized(lock) {
                    if (finished) false else { ws = webSocket; opened = true; true }
                }
                if (ok) onOpen(this@TvSocket) else webSocket.cancel()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (isCurrent(webSocket)) onMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                if (isCurrent(webSocket)) closed("Телевизор закрыл соединение")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (isCurrent(webSocket)) closed("Телевизор закрыл соединение")
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val wasOpen = synchronized(lock) { opened && ws === webSocket }
                if (wasOpen) {
                    closed("Связь с телевизором потеряна")
                } else {
                    attempt(urls, clients, i + 1, t.message ?: t.javaClass.simpleName)
                }
            }
        })
        synchronized(lock) { if (finished) socket.cancel() }
    }

    private fun isCurrent(webSocket: WebSocket): Boolean =
        synchronized(lock) { !finished && opened && ws === webSocket }

    private fun fail(reason: String) {
        val report = synchronized(lock) { if (finished) false else { finished = true; true } }
        if (report) onFail(reason)
    }

    private fun closed(reason: String) {
        val report = synchronized(lock) {
            if (finished) false else { finished = true; ws = null; true }
        }
        if (report) onClosed(reason)
    }

    /** Sends a text frame; false if the socket is not open. */
    fun send(text: String): Boolean {
        val socket = synchronized(lock) { if (finished) null else ws } ?: return false
        return socket.send(text)
    }

    val isOpen: Boolean get() = synchronized(lock) { !finished && opened }

    /** Closes silently: no further callbacks. */
    fun close() {
        val socket = synchronized(lock) {
            finished = true
            val s = ws
            ws = null
            s
        }
        socket?.close(1000, null)
    }
}
