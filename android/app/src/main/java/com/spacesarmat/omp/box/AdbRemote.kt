package com.spacesarmat.omp.box

import com.spacesarmat.omp.install.AdbIdentityStore
import com.spacesarmat.omp.install.AtvAdbConst
import com.spacesarmat.omp.install.AtvAdbInstaller
import com.spacesarmat.omp.install.InstallCodes
import dadb.AdbStream
import dadb.Dadb
import java.io.Closeable
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** Shell lines for `input` on the box. */
object AdbKeyLines {
    /** Printed by the shell after each line; the echo of the command itself shows `OMP''DONE`, never this. */
    const val DONE = "OMPDONE"
    private const val DONE_CMD = "echo OMP''DONE"

    /** Short presses, several in one `input keyevent` (one process start for a burst of arrows). */
    fun keys(codes: List<Int>): String {
        require(codes.isNotEmpty() && codes.all { valid(it) })
        return "input keyevent " + codes.joinToString(" ") + "; " + DONE_CMD
    }

    fun longPress(code: Int): String {
        require(valid(code))
        return "input keyevent --longpress $code; $DONE_CMD"
    }

    /**
     * `input text` for printable ASCII (the tool cannot type anything else): spaces become `%s` (its own escape),
     * the whole argument is single-quoted for the shell (a quote inside as `'\''`). Null when nothing typeable is left.
     */
    fun text(text: String): String? {
        val kept = text.filter { it in ' '..'~' }
        if (kept.isEmpty()) return null
        val arg = kept.replace(" ", "%s").replace("'", "'\\''")
        return "input text '$arg'; $DONE_CMD"
    }

    fun valid(code: Int) = code in 1..400
}

/** The open shell on the box: lines in, a callback for each [AdbKeyLines.DONE] seen in the output. */
interface AdbShellPipe : Closeable {
    fun write(line: String)
}

fun interface AdbShellOpener {
    /** Opens (and authorizes) a shell; [done] is called for each finished line, [closed] once when it ends. */
    fun open(ip: String, done: () -> Unit, closed: () -> Unit): AdbShellPipe
}

/**
 * Keys over adb (network debugging, port 5555): one persistent connection with one open shell; each press is an
 * `input keyevent` line. While a line runs, further presses wait and go together in the next line. A broken shell is
 * reopened once on the next press.
 */
class AdbBoxChannel(
    private val ip: String,
    private val opener: AdbShellOpener,
    private val listener: BoxListener,
    private val lineWaitMs: Long = LINE_WAIT_MS,
) : BoxChannel {
    override val via = VIA
    @Volatile
    private var open = true
    override val alive: Boolean get() = open
    private val queue = LinkedBlockingQueue<Cmd>()
    private val done = Semaphore(0)
    @Volatile
    private var pipe: AdbShellPipe? = null
    private val writer = Thread({ loop() }, "box-adb").apply { isDaemon = true }

    private sealed class Cmd {
        class Key(val code: Int) : Cmd()
        class Long(val code: Int) : Cmd()
        class Text(val line: String) : Cmd()
    }

    /** Opens the shell now (the TV asks «Разрешить отладку?» here the first time). */
    fun start(): AdbBoxChannel {
        pipe = openPipe()
        writer.start()
        return this
    }

    private fun openPipe(): AdbShellPipe {
        done.drainPermits()
        var me: AdbShellPipe? = null
        val p = opener.open(ip, { done.release() }) {
            // a pipe replaced by a reconnect may report its end later: only the current one counts
            if (pipe === me) pipe = null
        }
        me = p
        return p
    }

    override fun key(code: Int, long: Boolean) {
        if (!open) throw BoxFailure(BoxCodes.NOT_CONNECTED)
        if (!AdbKeyLines.valid(code)) throw BoxFailure(BoxCodes.FAILED)
        queue.add(if (long) Cmd.Long(code) else Cmd.Key(code))
    }

    override fun text(text: String): Boolean {
        if (!open) throw BoxFailure(BoxCodes.NOT_CONNECTED)
        val line = AdbKeyLines.text(text) ?: return true
        queue.add(Cmd.Text(line))
        return true
    }

    private fun loop() {
        try {
            while (open) {
                val first = queue.take()
                val line = when (first) {
                    is Cmd.Key -> {
                        // presses that arrived meanwhile go in the same line, up to the next non-key command
                        val codes = arrayListOf(first.code)
                        while (codes.size < MAX_BATCH) {
                            val next = queue.peek() as? Cmd.Key ?: break
                            queue.poll()
                            codes.add(next.code)
                        }
                        AdbKeyLines.keys(codes)
                    }
                    is Cmd.Long -> AdbKeyLines.longPress(first.code)
                    is Cmd.Text -> first.line
                }
                if (!write(line)) return
                // the next line waits until this one has run (or a while, when the marker never comes)
                done.tryAcquire(lineWaitMs, TimeUnit.MILLISECONDS)
            }
        } catch (_: InterruptedException) {
        }
    }

    /** Writes [line]; a broken shell is reopened once. False when the box is gone. */
    private fun write(line: String): Boolean {
        for (attempt in 0..1) {
            try {
                val p = pipe ?: openPipe().also { pipe = it }
                p.write(line)
                return true
            } catch (e: Exception) {
                try {
                    pipe?.close()
                } catch (_: Exception) {
                }
                pipe = null
                if (!open) return false
            }
        }
        shut()
        listener.closed("adb")
        return false
    }

    private fun shut() {
        open = false
        writer.interrupt()
        try {
            pipe?.close()
        } catch (_: Exception) {
        }
        pipe = null
    }

    override fun close() = shut()

    companion object {
        const val VIA = "adb"
        const val LINE_WAIT_MS = 3_000L
        const val MAX_BATCH = 20
    }
}

/**
 * dadb-backed shell: the phone's adb identity ([AdbIdentityStore], shared with the install assistant), a legacy
 * `shell:` stream kept open, its output drained on a thread that watches for [AdbKeyLines.DONE].
 */
class DadbShellOpener(private val identities: AdbIdentityStore) : AdbShellOpener {
    override fun open(ip: String, done: () -> Unit, closed: () -> Unit): AdbShellPipe {
        val probe = Socket()
        try {
            probe.use { it.connect(InetSocketAddress(ip, AtvAdbConst.PORT), AtvAdbConst.CONNECT_MS) }
        } catch (e: IOException) {
            throw boxFailure(AtvAdbInstaller.probeFailure(e).code, e)
        }
        val id = identities.load()
        val keyPair = try {
            id.toKeyPair()
        } finally {
            id.wipe()
        }
        // no read timeout: the shell idles for long; the first open waits for «Разрешить отладку?» (watchdog below)
        val dadb = Dadb.create(ip, AtvAdbConst.PORT, keyPair, AtvAdbConst.CONNECT_MS, 0)
        val watchdog = Thread({
            try {
                Thread.sleep(AUTH_WAIT_MS)
                dadb.close()
            } catch (_: Exception) {
            }
        }, "box-adb-auth").apply { isDaemon = true }
        watchdog.start()
        val stream: AdbStream = try {
            dadb.open("shell:")
        } catch (e: Throwable) {
            val timedOut = !watchdog.isAlive
            watchdog.interrupt()
            try {
                dadb.close()
            } catch (_: Exception) {
            }
            if (timedOut) throw BoxFailure(BoxCodes.AUTH_TIMEOUT, e)
            throw boxFailure(AtvAdbInstaller.adbFailure(e, null, connecting = true).code, e)
        }
        watchdog.interrupt()
        val drain = Thread({
            val tail = StringBuilder()
            val buf = ByteArray(1024)
            try {
                while (true) {
                    val n = stream.source.read(buf)
                    if (n < 0) break
                    for (i in 0 until n) {
                        tail.append((buf[i].toInt() and 0xFF).toChar())
                        if (tail.endsWith(AdbKeyLines.DONE)) {
                            tail.setLength(0)
                            done()
                        } else if (tail.length > 64) {
                            tail.delete(0, tail.length - AdbKeyLines.DONE.length)
                        }
                    }
                }
            } catch (_: Exception) {
            } finally {
                closed()
            }
        }, "box-adb-out").apply { isDaemon = true }
        drain.start()
        return object : AdbShellPipe {
            override fun write(line: String) {
                stream.sink.writeUtf8(line + "\n")
                stream.sink.flush()
            }

            override fun close() {
                try {
                    stream.close()
                } catch (_: Exception) {
                }
                try {
                    dadb.close()
                } catch (_: Exception) {
                }
            }
        }
    }

    companion object {
        const val AUTH_WAIT_MS = 60_000L

        fun boxFailure(installCode: String, e: Throwable): BoxFailure = BoxFailure(
            when (installCode) {
                InstallCodes.ADB_CLOSED -> BoxCodes.ADB_CLOSED
                InstallCodes.UNAUTHORIZED -> BoxCodes.REJECTED
                InstallCodes.AUTH_TIMEOUT -> BoxCodes.AUTH_TIMEOUT
                InstallCodes.UNREACHABLE, InstallCodes.TIMEOUT -> BoxCodes.UNREACHABLE
                else -> BoxCodes.FAILED
            },
            e,
        )
    }
}
