package com.spacesarmat.omp

import android.content.SharedPreferences
import java.net.Socket
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Trust-on-first-use for a TV or Android TV box certificate. The first leaf seen for a host is remembered
 * (SHA-256); a later leaf with a different fingerprint is refused with `cert-changed:<fingerprint>` and does not
 * replace the pin. [trust] is the only way to change a pin, after the user confirms.
 *
 * One pin per host (the IP), shared by the LG secure socket and the box remote: both are that TV.
 */
object CertPins {
    const val PREFS = "omp-cert-pins"

    interface PinBackend {
        fun get(host: String): String?
        fun put(host: String, fingerprint: String)
    }

    class MemoryPins : PinBackend {
        private val map = ConcurrentHashMap<String, String>()
        override fun get(host: String): String? = map[host]
        override fun put(host: String, fingerprint: String) {
            map[host] = fingerprint
        }
    }

    private class PrefsPins(private val prefs: SharedPreferences) : PinBackend {
        override fun get(host: String): String? = prefs.getString(host, null)
        override fun put(host: String, fingerprint: String) {
            prefs.edit().putString(host, fingerprint).apply()
        }
    }

    @Volatile
    var backend: PinBackend = MemoryPins()

    /** The host a handshake is dialing, for a trust manager that is not bound to one host. */
    val expecting: ThreadLocal<String?> = ThreadLocal()

    private val seen = ConcurrentHashMap<String, String>()
    private val rejected = ConcurrentHashMap<String, String>()

    val FP: Regex = Regex("^[0-9a-f]{64}$")
    private val MAPPED = Regex("""^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$""")

    fun attach(prefs: SharedPreferences) {
        backend = PrefsPins(prefs)
    }

    fun fingerprint(cert: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }

    fun normalize(host: String): String {
        var h = host.trim().lowercase()
        if (h.startsWith("[") && h.endsWith("]") && h.length >= 2) h = h.substring(1, h.length - 1)
        val zone = h.indexOf('%')
        if (zone >= 0) h = h.substring(0, zone)
        val mapped = MAPPED.matchEntire(h)
        if (mapped != null) h = mapped.groupValues[1]
        return h
    }

    /**
     * Accepts [cert] for [host] when there is no pin yet or the pin matches. A different certificate throws
     * [CertificateException] and leaves the stored pin untouched.
     */
    fun checkHost(host: String, cert: X509Certificate) {
        val key = normalize(host)
        if (key.isEmpty()) throw CertificateException("no peer")
        val fp = fingerprint(cert)
        val pin = backend.get(key)
        if (pin == null || pin == fp) {
            seen[key] = fp
            return
        }
        rejected[key] = fp
        throw CertificateException("cert-changed:$fp")
    }

    /** Writes the fingerprint [checkHost] just accepted, only when the host has no pin yet. */
    fun commit(host: String) {
        val key = normalize(host)
        if (key.isEmpty() || backend.get(key) != null) return
        val fp = seen[key] ?: return
        synchronized(this) {
            if (backend.get(key) == null) backend.put(key, fp)
        }
    }

    /** Remembers [fingerprint] for [host], replacing whatever was pinned. The user confirmed the change. */
    fun trust(host: String, fingerprint: String) {
        val key = normalize(host)
        val fp = fingerprint.trim().lowercase()
        if (key.isEmpty() || !FP.matches(fp)) throw IllegalArgumentException("bad fingerprint")
        backend.put(key, fp)
        seen[key] = fp
        rejected.remove(key)
    }

    fun lastRejected(host: String): String? = rejected[normalize(host)]

    fun isChanged(t: Throwable?): Boolean = changedFingerprint(t) != null

    /** The new fingerprint inside a `cert-changed:` failure, walking the cause chain. */
    fun changedFingerprint(t: Throwable?): String? {
        var c = t
        while (c != null) {
            val fromMessage = prefixed(c.message)
            if (fromMessage != null) return fromMessage
            c = c.cause
        }
        return null
    }

    /** `cert-changed:<fp>` or the fingerprint alone (the plugin rejection message). */
    fun changedFingerprint(message: String?): String? {
        prefixed(message)?.let { return it }
        val bare = message?.trim()?.lowercase() ?: return null
        return if (FP.matches(bare)) bare else null
    }

    fun reset() {
        backend = MemoryPins()
        seen.clear()
        rejected.clear()
        expecting.remove()
    }

    /** A trust manager that pins [fixedHost], or the host of the socket / [expecting] when [fixedHost] is null. */
    fun trustManager(fixedHost: String? = null): X509ExtendedTrustManager = TofuTrust(fixedHost)

    private fun prefixed(message: String?): String? {
        if (message == null) return null
        val i = message.indexOf("cert-changed:")
        if (i < 0) return null
        val fp = message.substring(i + "cert-changed:".length).take(64).lowercase()
        return if (FP.matches(fp)) fp else null
    }

    private class TofuTrust(private val fixedHost: String?) : X509ExtendedTrustManager() {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
            throw CertificateException("server only")

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) =
            throw CertificateException("server only")

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
            throw CertificateException("server only")

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            check(chain, fixedHost ?: expecting.get())
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
            val ip = socket?.inetAddress?.hostAddress?.substringBefore('%')
            check(chain, ip?.takeIf { it.isNotBlank() } ?: fixedHost ?: expecting.get())
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
            val peer = engine?.peerHost?.takeIf { it.isNotBlank() }
            check(chain, peer ?: fixedHost ?: expecting.get())
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

        private fun check(chain: Array<out X509Certificate>?, host: String?) {
            if (host.isNullOrBlank()) throw CertificateException("no peer")
            val cert = chain?.firstOrNull() ?: throw CertificateException("empty chain")
            checkHost(host, cert)
        }
    }
}
