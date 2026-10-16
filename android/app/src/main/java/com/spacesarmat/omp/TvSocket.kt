package com.spacesarmat.omp

import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLContext
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
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    /** Client for plain ws:// (system trust for anything else). */
    fun plain(): OkHttpClient = base

    /**
     * Client for the TV's self-signed certificate. The leaf is pinned on first use ([CertPins]); the hostname
     * verifier only lets through [host], so this client cannot be reused for another server.
     */
    fun trustingOnly(host: String): OkHttpClient {
        val tm = CertPins.trustManager(host)
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(tm), SecureRandom())
        return base.newBuilder()
            .sslSocketFactory(ctx.socketFactory, tm)
            .hostnameVerifier { name, _ -> name.equals(host, ignoreCase = true) }
            .connectionSpecs(listOf(ConnectionSpec.MODERN_TLS, ConnectionSpec.COMPATIBLE_TLS))
            .build()
    }
}

/** One address to try: [port] identifies it to the caller (3000 / 3001 for the TV). */
class TvCandidate(val port: Int, val url: String, val client: OkHttpClient)

/**
 * One WebSocket to the TV. Callbacks run on OkHttp threads. [onOpen]/[onFail] fire at most once
 * and only before the socket opened; [onMessage]/[onClosed] only after it opened. After [close]
 * nothing is reported any more. Several candidates can be raced: the first to open wins and the
 * others are cancelled without any report.
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
    private val attempts = mutableListOf<WebSocket>()
    private var failed = 0
    private var total = 0
    private var lastError: String? = null
    private var timer: ScheduledFuture<*>? = null
    private var joinRest: (() -> Unit)? = null

    /** Port of the candidate that opened; valid once [onOpen] fired. */
    @Volatile
    var port: Int = 0
        private set

    /** Single address (pointer socket). */
    fun connect(urls: List<String>, clients: List<OkHttpClient>) {
        race(urls.mapIndexed { i, u -> TvCandidate(0, u, clients[i]) }, null)
    }

    /**
     * Opens all [candidates] at once and keeps the first that opens. With [preferPort] only that
     * candidate starts at first; the rest join after [HEAD_START_MS] or as soon as it fails.
     */
    fun race(candidates: List<TvCandidate>, preferPort: Int?) {
        synchronized(lock) { total = candidates.size }
        if (candidates.isEmpty()) {
            fail(I18n.s("tv.noAddr"))
            return
        }
        val preferred = candidates.firstOrNull { it.port == preferPort }
        val rest = if (preferred == null) candidates else candidates.filter { it !== preferred }
        if (preferred == null || rest.isEmpty()) {
            candidates.forEach { start(it, false) }
            return
        }
        val joined = AtomicBoolean(false)
        val join = { if (joined.compareAndSet(false, true)) rest.forEach { start(it, false) } }
        synchronized(lock) {
            if (finished) return
            joinRest = join
            timer = SCHEDULER.schedule({ join() }, HEAD_START_MS, TimeUnit.MILLISECONDS)
        }
        start(preferred, true)
    }

    private fun start(c: TvCandidate, isPreferred: Boolean) {
        synchronized(lock) { if (finished || opened) return }
        val request = try {
            Request.Builder().url(c.url).build()
        } catch (e: IllegalArgumentException) {
            attemptFailed(e.message, isPreferred)
            return
        }
        val socket = c.client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                var losers: List<WebSocket> = emptyList()
                val won = synchronized(lock) {
                    if (finished || opened) {
                        false
                    } else {
                        ws = webSocket
                        opened = true
                        port = c.port
                        timer?.cancel(false)
                        losers = attempts.filter { it !== webSocket }
                        true
                    }
                }
                if (!won) {
                    webSocket.cancel()
                    return
                }
                losers.forEach { it.cancel() }
                onOpen(this@TvSocket)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (isCurrent(webSocket)) onMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                if (isCurrent(webSocket)) closed(I18n.s("tv.closed"))
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (isCurrent(webSocket)) closed(I18n.s("tv.closed"))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val state = synchronized(lock) {
                    when {
                        opened && ws === webSocket -> 1
                        opened || finished -> 0 // a cancelled loser, or a failure after close
                        else -> 2
                    }
                }
                when (state) {
                    1 -> closed(I18n.s("tv.lost"))
                    2 -> attemptFailed(tvFailText(t), isPreferred)
                }
            }
        })
        val cancelNow = synchronized(lock) {
            attempts.add(socket)
            finished || opened
        }
        if (cancelNow) socket.cancel()
    }

    private fun attemptFailed(error: String?, wasPreferred: Boolean) {
        // A changed certificate must not fall through to ws://3000: that would send the registration
        // in the clear and never show the sheet.
        if (wasPreferred && !tvMayTryOtherPorts(error)) {
            synchronized(lock) {
                timer?.cancel(false)
                if (error != null) lastError = tvPreferReason(lastError, error)
            }
            fail(error ?: I18n.s("tv.noAddr"))
            return
        }
        var join: (() -> Unit)? = null
        val allFailed = synchronized(lock) {
            failed++
            if (error != null) lastError = tvPreferReason(lastError, error)
            if (wasPreferred) {
                timer?.cancel(false)
                join = joinRest
            }
            failed >= total
        }
        join?.invoke()
        if (allFailed) fail(synchronized(lock) { lastError } ?: I18n.s("tv.noAddr"))
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
        val open: WebSocket?
        val others: List<WebSocket>
        synchronized(lock) {
            finished = true
            timer?.cancel(false)
            open = ws
            ws = null
            others = attempts.filter { it !== open }
        }
        others.forEach { it.cancel() }
        open?.close(1000, null)
    }

    private companion object {
        const val HEAD_START_MS = 2000L
        val SCHEDULER: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "tv-socket-timer").also { it.isDaemon = true }
        }
    }
}

/** Failure text for the page: a changed certificate wins over a wrapped OkHttp message. */
internal fun tvFailText(t: Throwable): String {
    CertPins.changedFingerprint(t)?.let { return "cert-changed:$it" }
    var c: Throwable? = t
    while (c != null) {
        val m = c.message
        if (!m.isNullOrBlank()) return m
        c = c.cause
    }
    return t.javaClass.simpleName
}

/** Keeps a certificate-change reason when a later attempt fails for an ordinary reason. */
internal fun tvPreferReason(previous: String?, next: String): String =
    if (previous != null && CertPins.changedFingerprint(previous) != null) previous else next

/** False when [error] is a changed certificate: the plaintext port must not be opened instead. */
internal fun tvMayTryOtherPorts(error: String?): Boolean =
    error == null || CertPins.changedFingerprint(error) == null
