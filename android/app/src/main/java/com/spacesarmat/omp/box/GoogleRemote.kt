package com.spacesarmat.omp.box

import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.interfaces.RSAPublicKey
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/** Error codes of the box channel, passed to the page as the rejection code. */
object BoxCodes {
    /** The box does not answer at all (asleep, wrong address). */
    const val UNREACHABLE = "box-unreachable"
    /** Neither the Google TV remote service nor network debugging is on. */
    const val NO_SERVICE = "box-no-service"
    /** The Google TV remote service does not know this phone: pair by the code on the TV. */
    const val NEED_PAIRING = "box-need-pairing"
    /** The code typed does not match the one on the TV. */
    const val BAD_CODE = "box-bad-code"
    /** The TV declined (pairing cancelled there, or «Разрешить отладку?» answered no). */
    const val REJECTED = "box-rejected"
    /** Port 5555 closed: network debugging is off. */
    const val ADB_CLOSED = "box-adb-closed"
    /** «Разрешить отладку?» was not answered in time. */
    const val AUTH_TIMEOUT = "box-auth-timeout"
    /** No box channel is connected. */
    const val NOT_CONNECTED = "box-not-connected"
    /** Anything else (connection broke). */
    const val FAILED = "box-failed"
}

class BoxFailure(val code: String, cause: Throwable? = null) : Exception(code, cause)

/** One TLS connection to the box; [serverKey] is the TV's certificate key. */
interface TlsLink : Closeable {
    val input: InputStream
    val output: OutputStream
    val serverKey: RSAPublicKey?
    /** Read timeout for later reads (ms, 0 = none). */
    fun readTimeout(ms: Int)
}

fun interface TlsDialer {
    fun dial(ip: String, port: Int): TlsLink
}

/** Real TLS dialer presenting the phone's certificate. */
class SocketTlsDialer(private val factory: () -> SSLSocketFactory) : TlsDialer {
    override fun dial(ip: String, port: Int): TlsLink {
        val plain = Socket()
        try {
            plain.connect(InetSocketAddress(ip, port), CONNECT_MS)
        } catch (e: IOException) {
            plain.close()
            throw connectFailure(e)
        }
        val s: SSLSocket
        try {
            plain.soTimeout = HANDSHAKE_MS
            s = factory().createSocket(plain, ip, port, true) as SSLSocket
            s.startHandshake()
        } catch (e: Exception) {
            plain.close()
            throw e
        }
        val key = try {
            s.session.peerCertificates.firstOrNull()?.publicKey as? RSAPublicKey
        } catch (_: Exception) {
            null
        }
        return object : TlsLink {
            override val input: InputStream = s.inputStream
            override val output: OutputStream = s.outputStream
            override val serverKey: RSAPublicKey? = key
            override fun readTimeout(ms: Int) {
                s.soTimeout = ms
            }
            override fun close() = s.close()
        }
    }

    companion object {
        const val CONNECT_MS = 5_000
        const val HANDSHAKE_MS = 10_000

        /** A refused port means the service is not there; a timeout or no route means the box does not answer. */
        fun connectFailure(e: Throwable): BoxFailure =
            if (e is ConnectException || (e.message ?: "").contains("refused", ignoreCase = true)) {
                BoxFailure(BoxCodes.NO_SERVICE, e)
            } else {
                BoxFailure(BoxCodes.UNREACHABLE, e)
            }
    }
}

/**
 * Pairing with the Google TV remote service (port 6467): [start] asks the TV to show a code, [finish] sends the
 * secret computed from the code. See [AtvRemoteProtocol] for the messages.
 */
class GooglePairing(
    private val dialer: TlsDialer,
    private val clientKey: RSAPublicKey,
    private val clientName: String,
) : Closeable {
    @Volatile
    private var link: TlsLink? = null

    /** Still waiting for a code (a code refused on the phone leaves the TV's dialog open). */
    val open: Boolean get() = link != null

    fun start(ip: String) {
        val l = try {
            dialer.dial(ip, AtvRemoteProtocol.PAIRING_PORT)
        } catch (e: BoxFailure) {
            throw e
        } catch (e: Exception) {
            throw BoxFailure(BoxCodes.FAILED, e)
        }
        link = l
        try {
            l.readTimeout(READ_MS)
            exchange(l, AtvRemoteProtocol.pairingRequest(clientName))
            exchange(l, AtvRemoteProtocol.pairingOption())
            // the code is on the TV now; nothing is read until the user types it
            exchange(l, AtvRemoteProtocol.pairingConfiguration())
        } catch (e: Exception) {
            close()
            throw failure(e)
        }
    }

    /** Sends the secret for [code]; a code that cannot match is refused before anything is sent. */
    fun finish(code: String) {
        val l = link ?: throw BoxFailure(BoxCodes.NOT_CONNECTED)
        val server = l.serverKey ?: throw BoxFailure(BoxCodes.FAILED)
        if (AtvRemoteProtocol.normalizeCode(code) == null) throw BoxFailure(BoxCodes.BAD_CODE)
        val secret = AtvRemoteProtocol.pairingSecret(clientKey, server, code)
        if (!AtvRemoteProtocol.codeMatches(secret, code)) throw BoxFailure(BoxCodes.BAD_CODE)
        try {
            l.readTimeout(READ_MS)
            exchange(l, AtvRemoteProtocol.pairingSecret(secret))
        } catch (e: Exception) {
            throw failure(e)
        } finally {
            close()
        }
    }

    private fun exchange(l: TlsLink, message: ByteArray) {
        ProtoFrames.write(l.output, message)
        val answer = ProtoFrames.read(l.input)
        val status = AtvRemoteProtocol.pairingStatus(answer)
        if (status != AtvRemoteProtocol.STATUS_OK) throw StatusException(status)
    }

    private class StatusException(val status: Int) : IOException("status $status")

    private fun failure(e: Throwable): BoxFailure = when (e) {
        is BoxFailure -> e
        is StatusException -> BoxFailure(if (e.status == AtvRemoteProtocol.STATUS_BAD_SECRET) BoxCodes.BAD_CODE else BoxCodes.REJECTED, e)
        // the TV closes the pairing connection when the user cancels the code dialog
        is EOFException, is SSLException -> BoxFailure(BoxCodes.REJECTED, e)
        is SocketTimeoutException -> BoxFailure(BoxCodes.UNREACHABLE, e)
        else -> BoxFailure(BoxCodes.FAILED, e)
    }

    override fun close() {
        try {
            link?.close()
        } catch (_: Exception) {
        }
        link = null
    }

    companion object {
        const val READ_MS = 10_000
    }
}

/** What a live box channel reports back. */
interface BoxListener {
    fun closed(reason: String)
    fun volume(level: Int, max: Int, muted: Boolean) {}
}

/** A connected channel to the box that injects key presses. */
interface BoxChannel : Closeable {
    val via: String
    val alive: Boolean
    /** Sends one key press (Android KeyEvent code); [long] holds it. */
    fun key(code: Int, long: Boolean)
    /** Types text into the focused field; false when the channel cannot. */
    fun text(text: String): Boolean = false
}

/**
 * The remote channel of the Google TV remote service (port 6466): answers the TV's configure / set-active / ping
 * messages on a reader thread and sends key injections. A TV that does not know the certificate closes the
 * connection before its first message → [BoxCodes.NEED_PAIRING].
 */
class GoogleRemoteChannel private constructor(
    private val link: TlsLink,
    private val listener: BoxListener,
    private val model: String,
    private val vendor: String,
    private val appVersion: String,
) : BoxChannel {
    override val via = VIA
    @Volatile
    private var open = true
    override val alive: Boolean get() = open
    private val firstMessage = CountDownLatch(1)
    private val active = CountDownLatch(1)
    @Volatile
    private var failure: Throwable? = null

    private fun run() {
        try {
            while (open) {
                val m = ProtoFrames.read(link.input)
                firstMessage.countDown()
                when (val msg = AtvRemoteProtocol.parseRemote(m)) {
                    is AtvRemoteProtocol.Incoming.Configure -> send(AtvRemoteProtocol.remoteConfigure(model, vendor, appVersion))
                    is AtvRemoteProtocol.Incoming.SetActive -> {
                        send(AtvRemoteProtocol.remoteSetActive())
                        active.countDown()
                    }
                    is AtvRemoteProtocol.Incoming.Ping -> send(AtvRemoteProtocol.pingResponse(msg.val1))
                    is AtvRemoteProtocol.Incoming.Volume -> listener.volume(msg.level, msg.max, msg.muted)
                    else -> {}
                }
            }
        } catch (e: Throwable) {
            failure = e
        } finally {
            firstMessage.countDown()
            active.countDown()
            val was = open
            shut()
            if (was) listener.closed(failure?.javaClass?.simpleName ?: "closed")
        }
    }

    private fun send(message: ByteArray) {
        synchronized(link) { ProtoFrames.write(link.output, message) }
    }

    override fun key(code: Int, long: Boolean) {
        if (!open) throw BoxFailure(BoxCodes.NOT_CONNECTED)
        try {
            if (long) {
                send(AtvRemoteProtocol.keyInject(code, AtvRemoteProtocol.DIRECTION_START_LONG))
                Thread.sleep(LONG_PRESS_MS)
                send(AtvRemoteProtocol.keyInject(code, AtvRemoteProtocol.DIRECTION_END_LONG))
            } else {
                send(AtvRemoteProtocol.keyInject(code, AtvRemoteProtocol.DIRECTION_SHORT))
            }
        } catch (e: IOException) {
            close()
            throw BoxFailure(BoxCodes.FAILED, e)
        }
    }

    private fun shut() {
        open = false
        try {
            link.close()
        } catch (_: Exception) {
        }
    }

    override fun close() = shut()

    companion object {
        const val VIA = "google"
        const val LONG_PRESS_MS = 700L
        /** The TV pings every few seconds; this long without any message means the connection is gone. */
        const val IDLE_MS = 20_000
        const val FIRST_MESSAGE_MS = 6_000L

        fun connect(
            dialer: TlsDialer,
            ip: String,
            listener: BoxListener,
            model: String,
            vendor: String,
            appVersion: String,
            thread: (Runnable) -> Unit = { Thread(it, "box-google").apply { isDaemon = true }.start() },
        ): GoogleRemoteChannel {
            val link = try {
                dialer.dial(ip, AtvRemoteProtocol.REMOTE_PORT)
            } catch (e: BoxFailure) {
                throw e
            } catch (e: SSLException) {
                // a handshake refused for our certificate (TLS 1.2 checks it during the handshake)
                throw BoxFailure(BoxCodes.NEED_PAIRING, e)
            } catch (e: Exception) {
                throw BoxFailure(BoxCodes.FAILED, e)
            }
            link.readTimeout(IDLE_MS)
            val ch = GoogleRemoteChannel(link, listener, model, vendor, appVersion)
            thread(Runnable { ch.run() })
            ch.firstMessage.await(FIRST_MESSAGE_MS, TimeUnit.MILLISECONDS)
            if (!ch.open) {
                // closed before saying anything: the TV does not know this certificate (TLS 1.3 refuses it after the handshake)
                val f = ch.failure
                throw if (f is SocketTimeoutException) BoxFailure(BoxCodes.UNREACHABLE, f) else BoxFailure(BoxCodes.NEED_PAIRING, f)
            }
            ch.active.await(FIRST_MESSAGE_MS, TimeUnit.MILLISECONDS)
            if (!ch.open) throw BoxFailure(BoxCodes.NEED_PAIRING, ch.failure)
            return ch
        }
    }
}
