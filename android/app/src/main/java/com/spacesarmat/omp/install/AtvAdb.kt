package com.spacesarmat.omp.install

import dadb.AdbAuthException
import dadb.AdbConnectException
import dadb.AdbTimeoutException
import dadb.Dadb
import dadb.InstallResult
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.Socket
import java.net.SocketTimeoutException
import okio.source

/**
 * Android TV install over adb on the network (port 5555, «Отладка по сети» / ADB over network). The phone has its own
 * adb RSA key (generated once, encrypted with a Keystore key in noBackupFilesDir, see [AdbIdentityStore]); the TV asks «Разрешить отладку?»
 * the first time. The APK is streamed to the package manager (`cmd package install -S`), nothing stays on the TV.
 * Android 11+ «Беспроводная отладка» pairing by code is not supported (no suitable library), see the task report.
 */
object AtvAdbConst {
    const val PORT = 5555
    const val CONNECT_MS = 10_000
    /** Reads wait this long: covers the «Разрешить отладку?» dialog and a slow package install. */
    const val SOCKET_MS = 120_000
}

/** A connected and authorized adb device. */
interface AdbDevice : Closeable {
    fun shell(command: String): String

    /** Streams the APK; null on success, otherwise the package manager's failure text. */
    fun install(input: InputStream, size: Long): String?
}

interface AdbConnector {
    /** Connects and authorizes (the TV may show «Разрешить отладку?» meanwhile). */
    fun connect(ip: String, port: Int, cancel: CancelToken): AdbDevice
}

/** What the box told about itself; [abis] is `ro.product.cpu.abilist` (primary first), the APK is picked by it. */
data class AtvInfo(val sdkInt: Int?, val abi: String?, val abis: List<String> = listOfNotNull(abi))

class AtvAdbInstaller(private val connector: AdbConnector) {
    /** Connects and reads Android version and ABI; the first call is where authorization happens. */
    fun connect(ip: String, progress: ProgressSink, cancel: CancelToken): Pair<AdbDevice, AtvInfo> {
        progress.report(Phase.CONNECT, null, Item.OMP, null)
        val device = connector.connect(ip, AtvAdbConst.PORT, cancel)
        try {
            val sdk = device.shell("getprop ro.build.version.sdk").trim().toIntOrNull()
            val abi = device.shell("getprop ro.product.cpu.abi").trim().takeIf { Regex("^[A-Za-z0-9_-]{1,32}$").matches(it) }
            val list = ApkAbi.parseAbiList(device.shell("getprop ro.product.cpu.abilist"))
            return device to AtvInfo(sdk, abi, list.ifEmpty { listOfNotNull(abi) })
        } catch (e: Exception) {
            try {
                device.close()
            } catch (_: Exception) {
            }
            throw adbFailure(e, cancel, connecting = true)
        }
    }

    fun install(device: AdbDevice, p: TvPackage, progress: ProgressSink, cancel: CancelToken) {
        val version = p.pkg.version
        val size = p.file.length()
        progress.report(Phase.UPLOAD, 0, Item.OMP, version)
        val failure = try {
            p.file.inputStream().use { input ->
                var sent = false
                val counted = CountingInputStream(input, size) { pct ->
                    progress.report(Phase.UPLOAD, pct, Item.OMP, version)
                    // all bytes are on the TV: the package manager installs now
                    if (pct >= 100 && !sent) {
                        sent = true
                        progress.report(Phase.INSTALL, null, Item.OMP, version)
                    }
                }
                device.install(counted, size)
            }
        } catch (e: Exception) {
            throw adbFailure(e, cancel, connecting = false)
        }
        cancel.check()
        if (failure != null) throw installFailure(failure)
    }

    companion object {
        /** Package manager failure text → code. */
        fun installFailure(text: String): InstallFailure {
            val t = text.uppercase()
            return when {
                t.contains("INSUFFICIENT_STORAGE") || soundsLikeNoSpace(text) -> InstallFailure(InstallCodes.LOW_SPACE, text)
                t.contains("UPDATE_INCOMPATIBLE") || t.contains("SIGNATURE") -> InstallFailure(InstallCodes.SIGNATURE, text)
                t.contains("NO_MATCHING_ABIS") -> InstallFailure(InstallCodes.ABI, text)
                t.contains("OLDER_SDK") -> InstallFailure(InstallCodes.OLD_ANDROID, text)
                else -> InstallFailure(InstallCodes.INSTALL_FAILED, text)
            }
        }

        /**
         * adb errors → codes. UNAUTHORIZED only for a real refusal of our key (AdbAuthException); a handshake that
         * times out while connecting means the «Разрешить отладку?» question was not answered (AUTH_TIMEOUT). A TCP
         * connect that times out or has no route → UNREACHABLE, refused → ADB_CLOSED. Later: timeout / connection.
         */
        fun adbFailure(e: Throwable, cancel: CancelToken?, connecting: Boolean): InstallFailure {
            if (cancel?.cancelled == true) return InstallFailure(InstallCodes.CANCELLED, cause = e)
            var c: Throwable? = e
            var timeout = false
            var handshake = false
            var tcpConnect = false
            while (c != null) {
                val m = c.message ?: ""
                when (c) {
                    is InstallFailure -> return c
                    is AdbAuthException -> return InstallFailure(InstallCodes.UNAUTHORIZED, cause = e)
                    is AdbTimeoutException -> return InstallFailure(InstallCodes.TIMEOUT, cause = e)
                    is ConnectException -> return InstallFailure(InstallCodes.ADB_CLOSED, cause = e)
                    is NoRouteToHostException -> return InstallFailure(InstallCodes.UNREACHABLE, cause = e)
                    is SocketTimeoutException -> {
                        if (m.contains("connect", ignoreCase = true)) return InstallFailure(InstallCodes.UNREACHABLE, cause = e)
                        timeout = true
                    }
                    is AdbConnectException -> if (m == HANDSHAKE) handshake = true else tcpConnect = true
                }
                if (m.contains("refused", ignoreCase = true)) return InstallFailure(InstallCodes.ADB_CLOSED, cause = e)
                if (m.contains("unauthorized", ignoreCase = true)) return InstallFailure(InstallCodes.UNAUTHORIZED, cause = e)
                c = c.cause
            }
            if (connecting && tcpConnect) return InstallFailure(InstallCodes.UNREACHABLE, cause = e)
            if (connecting && handshake && timeout) return InstallFailure(InstallCodes.AUTH_TIMEOUT, cause = e)
            return InstallFailure(if (timeout) InstallCodes.TIMEOUT else InstallCodes.CONNECTION, cause = e)
        }

        /** The plain TCP check before adb: refused → ADB_CLOSED, anything else (timeout, no route) → UNREACHABLE. */
        fun probeFailure(e: Throwable): InstallFailure =
            if (e is ConnectException || (e.message ?: "").contains("refused", ignoreCase = true)) {
                InstallFailure(InstallCodes.ADB_CLOSED, cause = e)
            } else {
                InstallFailure(InstallCodes.UNREACHABLE, cause = e)
            }

        private const val HANDSHAKE = "Connection handshake failed"
    }
}

/**
 * adb over dadb with the phone's persistent identity from [identities] (encrypted at rest with a Keystore key).
 * A TCP check comes first so a wrong IP or a sleeping TV is told apart from an unanswered «Разрешить отладку?».
 */
class DadbConnector(private val identities: AdbIdentityStore) : AdbConnector {
    override fun connect(ip: String, port: Int, cancel: CancelToken): AdbDevice {
        val probe = Socket()
        val stop = cancel.onCancel { probe.close() }
        try {
            probe.use { it.connect(InetSocketAddress(ip, port), AtvAdbConst.CONNECT_MS) }
        } catch (e: IOException) {
            cancel.check()
            throw AtvAdbInstaller.probeFailure(e)
        } finally {
            stop.close()
        }
        val id = identities.load()
        val keyPair = try {
            id.toKeyPair()
        } finally {
            id.wipe()
        }
        val dadb = Dadb.create(ip, port, keyPair, AtvAdbConst.CONNECT_MS, AtvAdbConst.SOCKET_MS)
        val hook = cancel.onCancel {
            try {
                dadb.close()
            } catch (_: Exception) {
            }
        }
        return object : AdbDevice {
            override fun shell(command: String): String = dadb.shell(command).output

            override fun install(input: InputStream, size: Long): String? =
                when (val r = dadb.install(input.source(), size)) {
                    is InstallResult.Failure -> r.reason
                    else -> null
                }

            override fun close() {
                hook.close()
                dadb.close()
            }
        }
    }
}
