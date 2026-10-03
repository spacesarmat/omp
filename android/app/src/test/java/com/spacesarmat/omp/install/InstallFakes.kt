package com.spacesarmat.omp.install

import com.jcraft.jsch.JSch
import com.jcraft.jsch.KeyPair
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Serves fixed bodies per URL; records every request. */
class FakeHttp(private val bodies: Map<String, ByteArray>, private val lengthOverride: Long? = null) : ReleaseHttp {
    val requested = ArrayList<String>()
    var onStream: (() -> Unit)? = null

    private fun body(url: String): ByteArray {
        requested.add(url)
        val key = bodies.keys.firstOrNull { url == it || url.startsWith("$it?") } ?: throw InstallFailure(InstallCodes.NETWORK, "404 $url")
        return bodies.getValue(key)
    }

    override fun text(url: String, maxBytes: Int, cancel: CancelToken): String = String(body(url), Charsets.UTF_8)

    override fun stream(url: String, cancel: CancelToken, read: (InputStream, Long) -> Unit) {
        val b = body(url)
        onStream?.invoke()
        read(ByteArrayInputStream(b), lengthOverride ?: b.size.toLong())
    }
}

/**
 * An encrypted webOS-style key: PKCS#1 RSA PEM, «Proc-Type: 4,ENCRYPTED», «DEK-Info: AES-128-CBC,<iv>», key from
 * OpenSSL's EVP_BytesToKey(MD5, passphrase, iv[0..8]) — the format the LG Key Server serves.
 */
fun webosKey(passphrase: String): ByteArray {
    val kp = KeyPair.genKeyPair(JSch(), KeyPair.RSA, 2048)
    val plain = ByteArrayOutputStream().also { kp.writePrivateKey(it) }.toString("US-ASCII")
    kp.dispose()
    val body = plain.lines().filter { it.isNotBlank() && !it.startsWith("-----") }.joinToString("")
    val der = Base64.getDecoder().decode(body)
    val iv = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val md5 = MessageDigest.getInstance("MD5")
    md5.update(passphrase.toByteArray())
    md5.update(iv, 0, 8)
    val aesKey = md5.digest() // 16 bytes = AES-128
    val c = Cipher.getInstance("AES/CBC/PKCS5Padding")
    c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(aesKey, "AES"), IvParameterSpec(iv))
    val enc = Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(c.doFinal(der))
    val ivHex = iv.joinToString("") { "%02X".format(it) }
    return ("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,$ivHex\n\n$enc\n-----END RSA PRIVATE KEY-----\n")
        .toByteArray(Charsets.US_ASCII)
}

class FakeKeyServer(private val key: ByteArray?) : KeyServer {
    var calls = 0
    override fun fetchKey(ip: String, cancel: CancelToken): ByteArray {
        calls++
        return key?.copyOf() ?: throw InstallFailure(InstallCodes.KEY_SERVER)
    }
}

/** Scripted SSH: luna output per uploaded file name; records commands and uploads. */
class FakeShell(
    private val luna: (String) -> List<String> = { listOf("""{"returnValue":true,"subscribed":true}""", """{"details":{"state":"installed"}}""") },
    private val catExit: Int = 0,
    private val catStderr: String = "",
) : DevModeShell {
    val commands = ArrayList<String>()
    val uploads = LinkedHashMap<String, ByteArray>()
    var closed = false
    var onCommand: ((String) -> Unit)? = null

    override fun exec(command: String, stdin: InputStream?, timeoutMs: Long, cancel: CancelToken, onLine: (String) -> Boolean): ExecResult {
        commands.add(command)
        onCommand?.invoke(command)
        cancel.check()
        if (command.startsWith("cat > ")) {
            uploads[command.substringAfter("'").substringBefore("'")] = stdin!!.readBytes()
            return ExecResult(catExit, catStderr)
        }
        if (command.startsWith("luna-send-pub")) {
            val path = Regex("\"ipkUrl\":\"([^\"]+)\"").find(command)!!.groupValues[1].replace("\\/", "/")
            for (l in luna(path)) if (onLine(l)) return ExecResult(-1, "")
            return ExecResult(0, "")
        }
        return ExecResult(0, "")
    }

    override fun close() {
        closed = true
    }
}

class FakeConnector(val shell: FakeShell, private val fail: InstallFailure? = null) : DevModeConnector {
    var key: ByteArray? = null
    var passphrase: String? = null
    override fun connect(ip: String, key: ByteArray, passphrase: ByteArray, cancel: CancelToken): DevModeShell {
        this.key = key.copyOf()
        this.passphrase = String(passphrase)
        if (fail != null) throw fail
        return shell
    }
}

class FakeAdb(
    private val props: Map<String, String> = mapOf("ro.build.version.sdk" to "29", "ro.product.cpu.abi" to "arm64-v8a"),
    private val installResult: String? = null,
    private val shellError: Exception? = null,
) : AdbDevice {
    var installed: ByteArray? = null
    var closed = false
    override fun shell(command: String): String {
        if (shellError != null) throw shellError
        return props[command.removePrefix("getprop ")] ?: ""
    }

    override fun install(input: InputStream, size: Long): String? {
        installed = input.readBytes()
        return installResult
    }

    override fun close() {
        closed = true
    }
}

class FakeAdbConnector(private val device: FakeAdb) : AdbConnector {
    var connects = 0
    override fun connect(ip: String, port: Int, cancel: CancelToken): AdbDevice {
        connects++
        return device
    }
}

/** Records the progress events as «phase:item[:percent]». */
class Recorder : ProgressSink {
    val events = ArrayList<String>()
    override fun report(phase: Phase, percent: Int?, item: Item, version: String?) {
        events.add(phase.id + ":" + item.id + (if (percent != null) ":$percent" else ""))
    }
}

fun tempDir(): File = kotlin.io.path.createTempDirectory("omp-install").toFile().apply { deleteOnExit() }
