package com.spacesarmat.omp.install

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.KeyPair
import com.jcraft.jsch.Session
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.File
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.util.Arrays
import java.util.Timer
import kotlin.concurrent.schedule
import org.json.JSONException
import org.json.JSONObject

/**
 * LG Developer Mode install, the way ares-cli / webOS Dev Manager do it: the Key Server (port 9991) gives the SSH
 * private key, encrypted with the passphrase shown in the Developer Mode app; SSH to port 9922 as `prisoner`; the ipk
 * goes to /media/developer/temp by `cat >`; `luna-send-pub` asks com.webos.appInstallService/dev/install and its
 * subscription says «installed» or «failed»; the temp file is removed. The key and passphrase stay in memory for
 * the session only and are wiped afterwards.
 */
object LgDevModeConst {
    const val KEY_SERVER_PORT = 9991
    const val SSH_PORT = 9922
    const val USER = "prisoner"
    const val TEMP_DIR = "/media/developer/temp"
    const val KEY_MAX = 16 * 1024
    const val CONNECT_MS = 10_000
    const val INSTALL_MS = 180_000L
    const val UPLOAD_MS = 300_000L
    const val SHORT_MS = 20_000L
}

/** Key Server: GET http://ip:9991/webos_rsa. */
interface KeyServer {
    fun fetchKey(ip: String, cancel: CancelToken): ByteArray
}

/** The result of one command: exit status (-1 = stopped early or unknown) and up to a few KB of stderr. */
data class ExecResult(val exit: Int, val stderr: String)

/** An SSH session on the TV. */
interface DevModeShell : Closeable {
    /**
     * Runs [command]; streams [stdin] when given (EOF afterwards); passes stdout lines to [onLine] until it returns
     * true (then the channel is closed). Throws [InstallFailure] TIMEOUT after [timeoutMs].
     */
    fun exec(command: String, stdin: InputStream?, timeoutMs: Long, cancel: CancelToken, onLine: (String) -> Boolean = { false }): ExecResult
}

interface DevModeConnector {
    fun connect(ip: String, key: ByteArray, passphrase: ByteArray, cancel: CancelToken): DevModeShell
}

/** Key and passphrase for one install; [close] wipes both. */
class DevModeCredentials(val key: ByteArray, val passphrase: ByteArray) : Closeable {
    override fun close() {
        Arrays.fill(key, 0)
        Arrays.fill(passphrase, 0)
    }
}

object DevModeKey {
    /** True when [key] parses as a private key; false otherwise (Key Server gave something else). */
    fun isKey(key: ByteArray): Boolean = try {
        KeyPair.load(JSch(), key.copyOf(), null).dispose()
        true
    } catch (_: JSchException) {
        false
    } catch (_: RuntimeException) {
        false
    }

    /** True when [passphrase] opens [key] (or the key is not encrypted). */
    fun opens(key: ByteArray, passphrase: ByteArray): Boolean {
        val kp = try {
            KeyPair.load(JSch(), key.copyOf(), null)
        } catch (_: JSchException) {
            return false
        }
        try {
            if (!kp.isEncrypted) return true
            val p = passphrase.copyOf()
            try {
                return kp.decrypt(p)
            } finally {
                Arrays.fill(p, 0)
            }
        } finally {
            kp.dispose()
        }
    }

    /**
     * The passphrase as typed (trimmed), then upper-cased (Developer Mode shows it in capitals; phones often type
     * lower case). Throws WRONG_PASSPHRASE when neither opens the key, KEY_SERVER when it is not a key.
     */
    fun unlock(key: ByteArray, typed: CharArray): DevModeCredentials {
        if (!isKey(key)) {
            Arrays.fill(key, 0)
            throw InstallFailure(InstallCodes.KEY_SERVER)
        }
        // no String copies: trimmed / upper-cased char arrays, UTF-8 bytes, all wiped when not used
        val trimmed = trim(typed)
        val upper = CharArray(trimmed.size) { trimmed[it].uppercaseChar() }
        try {
            val candidates = if (upper.contentEquals(trimmed)) listOf(trimmed) else listOf(trimmed, upper)
            for (c in candidates) {
                if (c.isEmpty()) continue
                val bytes = utf8(c)
                if (opens(key, bytes)) return DevModeCredentials(key, bytes)
                Arrays.fill(bytes, 0)
            }
        } finally {
            Arrays.fill(trimmed, '\u0000')
            Arrays.fill(upper, '\u0000')
        }
        Arrays.fill(key, 0)
        throw InstallFailure(InstallCodes.WRONG_PASSPHRASE)
    }

    private fun trim(chars: CharArray): CharArray {
        var a = 0
        var b = chars.size
        while (a < b && chars[a].isWhitespace()) a++
        while (b > a && chars[b - 1].isWhitespace()) b--
        return chars.copyOfRange(a, b)
    }

    private fun utf8(chars: CharArray): ByteArray {
        val buf = Charsets.UTF_8.encode(java.nio.CharBuffer.wrap(chars))
        val out = ByteArray(buf.remaining())
        buf.get(out)
        if (buf.hasArray()) Arrays.fill(buf.array(), 0)
        return out
    }
}

/** State of the install from one line of the luna-send-pub subscription. */
sealed class LunaState {
    object Pending : LunaState()
    object Installed : LunaState()
    data class Failed(val reason: String?, val noSpace: Boolean) : LunaState()
}

object LunaInstall {
    private val SAFE_PATH = Regex("^/[A-Za-z0-9/._-]+$")

    /** `luna-send-pub -i` keeps the subscription open; one JSON message per line. */
    fun command(path: String): String {
        require(SAFE_PATH.matches(path)) { "unsafe path" }
        val payload = "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$path\",\"subscribe\":true}"
        return "/usr/bin/luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '$payload'"
    }

    /** returnValue false or details.state «…failed…» → Failed; details.state «installed» → Installed; else Pending. */
    fun parse(line: String): LunaState {
        val t = line.trim()
        if (!t.startsWith("{")) return LunaState.Pending
        val o = try {
            JSONObject(t)
        } catch (_: JSONException) {
            return LunaState.Pending
        }
        val details = o.optJSONObject("details")
        val state = (details?.optString("state") ?: "").lowercase()
        val reason = details?.optString("reason")?.takeIf { it.isNotEmpty() }
            ?: o.optString("errorText").takeIf { it.isNotEmpty() }
            ?: details?.opt("errorCode")?.toString()
        if (o.has("returnValue") && !o.optBoolean("returnValue", true)) {
            return LunaState.Failed(reason, soundsLikeNoSpace(reason) || soundsLikeNoSpace(t))
        }
        if (state.contains("fail") || state.contains("error")) {
            return LunaState.Failed(reason, soundsLikeNoSpace(reason) || soundsLikeNoSpace(t))
        }
        if (state == "installed" || state == "install success") return LunaState.Installed
        return LunaState.Pending
    }
}

/** Reports the share of [total] bytes read. */
class CountingInputStream(input: InputStream, private val total: Long, private val percent: (Int) -> Unit) : FilterInputStream(input) {
    private var done = 0L
    private var last = -1

    private fun add(n: Int) {
        if (n <= 0 || total <= 0) return
        done += n
        val p = ((done * 100) / total).toInt().coerceIn(0, 100)
        if (p != last) {
            last = p
            percent(p)
        }
    }

    override fun read(): Int {
        val b = super.read()
        if (b >= 0) add(1)
        return b
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        val n = super.read(b, off, len)
        add(n)
        return n
    }
}

/** One package for the TV: the release and the verified file in the app cache. */
data class TvPackage(val pkg: ReleasePackage, val file: File)

class LgDevModeInstaller(private val keyServer: KeyServer, private val connector: DevModeConnector) {
    /** Key Server + passphrase check (before anything is downloaded). */
    fun unlock(ip: String, passphrase: CharArray, cancel: CancelToken): DevModeCredentials {
        val key = keyServer.fetchKey(ip, cancel)
        cancel.check()
        return DevModeKey.unlock(key, passphrase)
    }

    /**
     * Installs [packages] in order. The first (OMP) must succeed; a later one (Homebrew Channel) failing is returned
     * in the map (item → code) instead of failing the install.
     */
    fun install(ip: String, creds: DevModeCredentials, packages: List<TvPackage>, progress: ProgressSink, cancel: CancelToken): Map<Item, String> {
        val failed = LinkedHashMap<Item, String>()
        progress.report(Phase.CONNECT, null, packages.first().pkg.item, packages.first().pkg.version)
        connector.connect(ip, creds.key, creds.passphrase, cancel).use { shell ->
            shell.exec("mkdir -p " + LgDevModeConst.TEMP_DIR, null, LgDevModeConst.SHORT_MS, cancel)
            for ((i, p) in packages.withIndex()) {
                try {
                    installOne(shell, p, progress, cancel)
                } catch (e: InstallFailure) {
                    if (i == 0 || e.code == InstallCodes.CANCELLED) throw e
                    failed[p.pkg.item] = e.code
                }
            }
        }
        return failed
    }

    private fun installOne(shell: DevModeShell, p: TvPackage, progress: ProgressSink, cancel: CancelToken) {
        val item = p.pkg.item
        val version = p.pkg.version
        val path = LgDevModeConst.TEMP_DIR + "/" + p.pkg.fileName
        try {
            progress.report(Phase.UPLOAD, 0, item, version)
            val up = p.file.inputStream().use { input ->
                val counted = CountingInputStream(input, p.file.length()) { progress.report(Phase.UPLOAD, it, item, version) }
                shell.exec("cat > '$path'", counted, LgDevModeConst.UPLOAD_MS, cancel)
            }
            cancel.check()
            if (up.exit != 0) {
                throw InstallFailure(if (soundsLikeNoSpace(up.stderr)) InstallCodes.LOW_SPACE else InstallCodes.CONNECTION, up.stderr)
            }
            progress.report(Phase.INSTALL, null, item, version)
            var result: LunaState = LunaState.Pending
            shell.exec(LunaInstall.command(path), null, LgDevModeConst.INSTALL_MS, cancel) { line ->
                result = LunaInstall.parse(line)
                result != LunaState.Pending
            }
            cancel.check()
            when (val r = result) {
                is LunaState.Installed -> {}
                is LunaState.Failed -> throw InstallFailure(if (r.noSpace) InstallCodes.LOW_SPACE else InstallCodes.INSTALL_FAILED, r.reason)
                is LunaState.Pending -> throw InstallFailure(InstallCodes.INSTALL_FAILED, "no result")
            }
        } finally {
            // the temp file goes even after a failure or cancel (the session is still open)
            try {
                shell.exec("rm -f '$path'", null, LgDevModeConst.SHORT_MS, CancelToken())
            } catch (_: Exception) {
            }
        }
    }
}

/** Plain HTTP to the TV's Key Server on a home-network address; at most [LgDevModeConst.KEY_MAX] bytes. */
class HttpKeyServer : KeyServer {
    override fun fetchKey(ip: String, cancel: CancelToken): ByteArray {
        val conn = try {
            URL("http://$ip:${LgDevModeConst.KEY_SERVER_PORT}/webos_rsa").openConnection() as HttpURLConnection
        } catch (e: IOException) {
            throw InstallFailure(InstallCodes.KEY_SERVER, cause = e)
        }
        val hook = cancel.onCancel { conn.disconnect() }
        try {
            conn.connectTimeout = LgDevModeConst.CONNECT_MS
            conn.readTimeout = LgDevModeConst.CONNECT_MS
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            if (conn.responseCode != 200) throw InstallFailure(InstallCodes.KEY_SERVER, "HTTP ${conn.responseCode}")
            val bytes = conn.inputStream.use { it.readNBytesCompat(LgDevModeConst.KEY_MAX + 1) }
            if (bytes.size > LgDevModeConst.KEY_MAX || bytes.isEmpty()) throw InstallFailure(InstallCodes.KEY_SERVER)
            return bytes
        } catch (e: IOException) {
            cancel.check()
            throw InstallFailure(InstallCodes.KEY_SERVER, cause = e)
        } finally {
            hook.close()
            conn.disconnect()
        }
    }
}

/** JSch errors to codes: refused → SSH_CLOSED, «Auth fail» → SSH_AUTH, timeouts → TIMEOUT. */
fun sshFailure(e: Throwable): InstallFailure {
    var c: Throwable? = e
    while (c != null) {
        when (c) {
            is InstallFailure -> return c
            is ConnectException, is NoRouteToHostException -> return InstallFailure(InstallCodes.SSH_CLOSED, cause = e)
            is SocketTimeoutException -> return InstallFailure(InstallCodes.TIMEOUT, cause = e)
        }
        val m = c.message?.lowercase() ?: ""
        if (m.contains("auth fail") || m.contains("auth cancel") || m.contains("userauth fail")) return InstallFailure(InstallCodes.SSH_AUTH, cause = e)
        if (m.contains("connection refused")) return InstallFailure(InstallCodes.SSH_CLOSED, cause = e)
        if (m.contains("timeout") || m.contains("timed out")) return InstallFailure(InstallCodes.TIMEOUT, cause = e)
        c = c.cause
    }
    return InstallFailure(InstallCodes.CONNECTION, cause = e)
}

/** SSH over JSch. webOS runs an old sshd: ssh-rsa host keys / signatures and SHA-1 key exchange are allowed. */
class JschConnector : DevModeConnector {
    override fun connect(ip: String, key: ByteArray, passphrase: ByteArray, cancel: CancelToken): DevModeShell {
        val jsch = JSch()
        val session: Session
        // JSch keeps its own copies (dropped by removeAllIdentity in close); ours are wiped right away
        val keyCopy = key.copyOf()
        val passCopy = passphrase.copyOf()
        try {
            jsch.addIdentity("webos", keyCopy, null, passCopy)
            session = jsch.getSession(LgDevModeConst.USER, ip, LgDevModeConst.SSH_PORT)
        } catch (e: JSchException) {
            forget(jsch)
            throw sshFailure(e)
        } finally {
            Arrays.fill(keyCopy, 0)
            Arrays.fill(passCopy, 0)
        }
        // the TV's host key cannot be known in advance (it changes with Developer Mode); kept in memory only
        session.setConfig("StrictHostKeyChecking", "no")
        session.setConfig("PreferredAuthentications", "publickey")
        session.setConfig("server_host_key", append(session.getConfig("server_host_key"), "ssh-rsa"))
        session.setConfig("PubkeyAcceptedAlgorithms", append(session.getConfig("PubkeyAcceptedAlgorithms"), "ssh-rsa"))
        session.setConfig("kex", append(session.getConfig("kex"), "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"))
        val hook = cancel.onCancel { session.disconnect() }
        try {
            session.connect(LgDevModeConst.CONNECT_MS)
        } catch (e: JSchException) {
            hook.close()
            session.disconnect()
            forget(jsch)
            cancel.check()
            throw sshFailure(e)
        }
        // from here a cancel closes only the running command, so the temp file can still be removed
        hook.close()
        return JschShell(jsch, session)
    }

    private fun append(list: String?, vararg extra: String): String {
        val items = (list ?: "").split(',').filter { it.isNotBlank() }.toMutableList()
        for (x in extra) if (x !in items) items.add(x)
        return items.joinToString(",")
    }
}

/** Drops the decrypted identity JSch holds. */
private fun forget(jsch: JSch) {
    try {
        jsch.removeAllIdentity()
    } catch (_: Exception) {
    }
}

private class JschShell(private val jsch: JSch, private val session: Session) : DevModeShell {
    override fun exec(command: String, stdin: InputStream?, timeoutMs: Long, cancel: CancelToken, onLine: (String) -> Boolean): ExecResult {
        cancel.check()
        val ch = try {
            session.openChannel("exec") as ChannelExec
        } catch (e: JSchException) {
            throw sshFailure(e)
        }
        val err = LimitedBuffer(4096)
        ch.setCommand(command)
        ch.setErrStream(err, true)
        val timedOut = java.util.concurrent.atomic.AtomicBoolean(false)
        val timer = Timer(true)
        timer.schedule(timeoutMs) {
            timedOut.set(true)
            ch.disconnect()
        }
        val stop = cancel.onCancel { ch.disconnect() }
        try {
            val out = ch.inputStream
            ch.connect(LgDevModeConst.CONNECT_MS)
            if (stdin != null) {
                ch.outputStream.use { o ->
                    val buf = ByteArray(32 * 1024)
                    while (true) {
                        cancel.check()
                        val n = stdin.read(buf)
                        if (n < 0) break
                        o.write(buf, 0, n)
                    }
                    o.flush()
                }
            }
            var stopped = false
            out.bufferedReader(Charsets.UTF_8).use { r ->
                while (true) {
                    val line = r.readLine() ?: break
                    if (onLine(line)) {
                        stopped = true
                        break
                    }
                }
            }
            if (stopped) return ExecResult(-1, err.text())
            // the exit status arrives right after EOF
            val until = System.currentTimeMillis() + 3000
            while (!ch.isClosed && System.currentTimeMillis() < until) Thread.sleep(20)
            cancel.check()
            if (timedOut.get()) throw InstallFailure(InstallCodes.TIMEOUT)
            return ExecResult(ch.exitStatus, err.text())
        } catch (e: InstallFailure) {
            throw e
        } catch (e: Exception) {
            cancel.check()
            if (timedOut.get()) throw InstallFailure(InstallCodes.TIMEOUT, cause = e)
            throw sshFailure(e)
        } finally {
            timer.cancel()
            stop.close()
            ch.disconnect()
        }
    }

    override fun close() {
        try {
            session.disconnect()
        } finally {
            forget(jsch)
        }
    }
}

/** Keeps the first [max] bytes written. */
private class LimitedBuffer(private val max: Int) : java.io.OutputStream() {
    private val buf = ByteArrayOutputStream()
    @Synchronized
    override fun write(b: Int) {
        if (buf.size() < max) buf.write(b)
    }
    @Synchronized
    override fun write(b: ByteArray, off: Int, len: Int) {
        val n = minOf(len, max - buf.size())
        if (n > 0) buf.write(b, off, n)
    }
    @Synchronized
    fun text(): String = buf.toString("UTF-8")
}
