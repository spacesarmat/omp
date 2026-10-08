package com.spacesarmat.omp.box

import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.security.interfaces.RSAPublicKey
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Which box services answer: the Google TV remote service (6466 and 6467) and adb over the network (5555). */
data class BoxProbe(val google: Boolean, val adb: Boolean)

fun interface PortCheck {
    fun open(ip: String, port: Int, timeoutMs: Int): Boolean
}

object TcpPortCheck : PortCheck {
    override fun open(ip: String, port: Int, timeoutMs: Int): Boolean = try {
        Socket().use { it.connect(InetSocketAddress(ip, port), timeoutMs) }
        true
    } catch (_: IOException) {
        false
    }
}

/**
 * The phone's channel to a whole Android TV box (system keys, Home, volume, other apps), next to OMP's own control
 * channel: Google TV remote protocol or adb, one at a time. The page picks the transport; this only connects it,
 * pairs and sends keys.
 */
class BoxRemote(
    private val dialer: () -> TlsDialer,
    private val clientKey: () -> RSAPublicKey,
    private val adb: AdbShellOpener,
    private val device: DeviceInfo,
    private val events: Events,
    private val ports: PortCheck = TcpPortCheck,
) {
    class DeviceInfo(val name: String, val model: String, val vendor: String, val appVersion: String)

    interface Events {
        fun closed(via: String)
        fun volume(level: Int, max: Int, muted: Boolean)
    }

    private val lock = Any()
    private var channel: BoxChannel? = null
    private var channelIp: String? = null
    private var pairing: GooglePairing? = null

    fun probe(ip: String): BoxProbe {
        val pool = Executors.newFixedThreadPool(3)
        try {
            val g1 = pool.submit(Callable { ports.open(ip, AtvRemoteProtocol.REMOTE_PORT, PROBE_MS) })
            val g2 = pool.submit(Callable { ports.open(ip, AtvRemoteProtocol.PAIRING_PORT, PROBE_MS) })
            val a = pool.submit(Callable { ports.open(ip, ADB_PORT, PROBE_MS) })
            return BoxProbe(google = g1.get() && g2.get(), adb = a.get())
        } finally {
            pool.shutdownNow()
            pool.awaitTermination(1, TimeUnit.SECONDS)
        }
    }

    /** The channel that is up for [ip], if any. */
    fun current(ip: String): String? = synchronized(lock) {
        channel?.takeIf { it.alive && channelIp == ip }?.via
    }

    /** Connects [via] ("google" / "adb"); an open channel to the same box and transport is kept. */
    fun connect(ip: String, via: String): String {
        synchronized(lock) {
            val c = channel
            if (c != null && c.alive && channelIp == ip && c.via == via) return via
        }
        disconnect()
        val listener = object : BoxListener {
            override fun closed(reason: String) {
                lateinit var me: BoxChannel
                synchronized(lock) {
                    me = channel ?: return
                    if (me.alive) return
                    channel = null
                    channelIp = null
                }
                events.closed(me.via)
            }

            override fun volume(level: Int, max: Int, muted: Boolean) = events.volume(level, max, muted)
        }
        val ch: BoxChannel = when (via) {
            GoogleRemoteChannel.VIA -> GoogleRemoteChannel.connect(dialer(), ip, listener, device.model, device.vendor, device.appVersion)
            AdbBoxChannel.VIA -> AdbBoxChannel(ip, adb, listener).start()
            else -> throw BoxFailure(BoxCodes.FAILED)
        }
        synchronized(lock) {
            channel = ch
            channelIp = ip
        }
        return via
    }

    /** Google: asks the TV to show a pairing code. */
    fun pairStart(ip: String) {
        val p = GooglePairing(dialer(), clientKey(), device.name)
        synchronized(lock) {
            pairing?.close()
            pairing = p
        }
        try {
            p.start(ip)
        } catch (e: Exception) {
            synchronized(lock) { if (pairing === p) pairing = null }
            throw e
        }
    }

    /** Google: sends the code; on success the remote channel is connected. */
    fun pairFinish(ip: String, code: String): String {
        val p = synchronized(lock) { pairing } ?: throw BoxFailure(BoxCodes.NOT_CONNECTED)
        try {
            p.finish(code)
        } finally {
            // a code refused on the phone keeps the TV's code on screen: the user may type it again
            if (!p.open) synchronized(lock) { if (pairing === p) pairing = null }
        }
        return connect(ip, GoogleRemoteChannel.VIA)
    }

    fun pairCancel() {
        synchronized(lock) {
            pairing?.close()
            pairing = null
        }
    }

    private fun live(): BoxChannel = synchronized(lock) { channel?.takeIf { it.alive } } ?: throw BoxFailure(BoxCodes.NOT_CONNECTED)

    fun key(code: Int, long: Boolean) = live().key(code, long)

    fun text(text: String): Boolean = live().text(text)

    fun disconnect() {
        val c = synchronized(lock) {
            channel.also {
                channel = null
                channelIp = null
            }
        }
        try {
            c?.close()
        } catch (_: Exception) {
        }
    }

    companion object {
        const val ADB_PORT = 5555
        const val PROBE_MS = 2_000
    }
}
