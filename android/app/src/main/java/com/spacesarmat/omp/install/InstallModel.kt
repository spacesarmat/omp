package com.spacesarmat.omp.install

import java.io.Closeable
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Install assistant (phone): shared pieces of the installers. Error codes travel to the page, which shows the Russian
 * text with the next step (mobile/src/install/installer.ts). Nothing here logs: messages may hold addresses.
 */
object InstallCodes {
    /** GitHub (feed or release file) unreachable. */
    const val NETWORK = "network"
    /** The feed or the release is malformed / has no checksum. */
    const val RELEASE = "release"
    /** Downloaded file does not match the published sha256 or size. */
    const val CHECKSUM = "checksum"
    /** A file larger than allowed. */
    const val TOO_BIG = "too-big"
    /** Not enough space on the phone for the download. */
    const val PHONE_SPACE = "phone-space"
    /** LG Key Server (9991) did not answer or gave no key. */
    const val KEY_SERVER = "key-server"
    /** The passphrase does not decrypt the key. */
    const val WRONG_PASSPHRASE = "wrong-passphrase"
    /** SSH 9922 closed: Dev Mode Status off or Developer Mode expired. */
    const val SSH_CLOSED = "ssh-closed"
    /** SSH refused the key (Key Server key changed after a reboot). */
    const val SSH_AUTH = "ssh-auth"
    /** The TV reports too little space. */
    const val LOW_SPACE = "low-space"
    /** The TV install service / package manager refused the package. */
    const val INSTALL_FAILED = "install-failed"
    /** Android: OMP with another signature is installed. */
    const val SIGNATURE = "signature"
    /** Android: the box's CPU is not supported by the APK. */
    const val ABI = "abi"
    /** Android: too old for the APK. */
    const val OLD_ANDROID = "old-android"
    /** adb port 5555 closed. */
    const val ADB_CLOSED = "adb-closed"
    /** adb: the TV refused our key. */
    const val UNAUTHORIZED = "unauthorized"
    /** adb: the «Разрешить отладку?» question was not answered in time. */
    const val AUTH_TIMEOUT = "auth-timeout"
    /** The TV does not answer at all (wrong IP, asleep, filtered): TCP connect timed out or no route. */
    const val UNREACHABLE = "unreachable"
    /** The TV stopped answering. */
    const val TIMEOUT = "timeout"
    /** The connection broke midway. */
    const val CONNECTION = "connection"
    const val CANCELLED = "cancelled"
    /** Bad request from the page (address, method). */
    const val BAD_TARGET = "bad-target"
    /** Another install is running. */
    const val BUSY = "busy"
    const val UNKNOWN = "unknown"
}

/** A failure with an [InstallCodes] code; [detail] is for tests only (may contain TV output), never logged or shown. */
class InstallFailure(val code: String, val detail: String? = null, cause: Throwable? = null) : Exception(code, cause)

/** Phases the page shows: download, verify, connect, upload, install (then done / error). */
enum class Phase(val id: String) {
    DOWNLOAD("download"),
    VERIFY("verify"),
    CONNECT("connect"),
    UPLOAD("upload"),
    INSTALL("install"),
}

/** What is being installed: OMP, or Homebrew Channel on LG. */
enum class Item(val id: String) { OMP("omp"), HBC("hbc") }

/** Progress sink: phase, percent 0..100 within the phase (null = unknown), item, release version. */
fun interface ProgressSink {
    fun report(phase: Phase, percent: Int?, item: Item, version: String?)
}

/**
 * Cancellation for one install: [cancel] sets the flag and runs the hooks (closing a socket or call unblocks the
 * worker); [check] throws [InstallFailure] CANCELLED once cancelled.
 */
class CancelToken {
    @Volatile
    var cancelled = false
        private set
    private val hooks = CopyOnWriteArrayList<() -> Unit>()

    fun cancel() {
        cancelled = true
        for (h in hooks) {
            try {
                h()
            } catch (_: Exception) {
            }
        }
    }

    fun check() {
        if (cancelled) throw InstallFailure(InstallCodes.CANCELLED)
    }

    /** Runs [hook] on cancel while the returned handle is open (immediately if already cancelled). */
    fun onCancel(hook: () -> Unit): Closeable {
        hooks.add(hook)
        if (cancelled) {
            try {
                hook()
            } catch (_: Exception) {
            }
        }
        return Closeable { hooks.remove(hook) }
    }
}

/** Generic I/O failures to codes (after the installers mapped what they know). */
fun failureOf(e: Throwable, cancel: CancelToken? = null): InstallFailure {
    if (cancel?.cancelled == true) return InstallFailure(InstallCodes.CANCELLED, cause = e)
    return when (e) {
        is InstallFailure -> e
        is SocketTimeoutException -> InstallFailure(InstallCodes.TIMEOUT, cause = e)
        is ConnectException, is NoRouteToHostException -> InstallFailure(InstallCodes.CONNECTION, cause = e)
        is UnknownHostException -> InstallFailure(InstallCodes.NETWORK, cause = e)
        is InterruptedIOException -> InstallFailure(InstallCodes.TIMEOUT, cause = e)
        is IOException -> InstallFailure(InstallCodes.CONNECTION, cause = e)
        else -> InstallFailure(InstallCodes.UNKNOWN, cause = e)
    }
}

/** True for text the TV prints when its storage is full. */
fun soundsLikeNoSpace(text: String?): Boolean {
    val t = (text ?: "").lowercase()
    return t.contains("no space") || t.contains("enospc") || t.contains("not enough space") || t.contains("insufficient") ||
        t.contains("disk full") || t.contains("space left")
}
