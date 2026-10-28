package com.spacesarmat.omp.tls

import android.content.Context
import android.content.SharedPreferences
import com.spacesarmat.omp.CertPins
import java.net.Socket
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSession
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager

/**
 * A TorrServer with a self-signed certificate (its own HTTPS on 8091, a home proxy), trusted only after the user
 * accepted its fingerprint. The system trust always decides first: a certificate it accepts never touches a pin.
 * One that it refuses passes only when its leaf SHA-256 is the one pinned for exactly that host:port; there is no
 * trust-all and no first-use pinning without the user. A different leaf for a pinned host:port is refused as
 * `torrserver-cert-changed:<fp>`, a host:port without a pin as `torrserver-cert-untrusted:<fp>`; [lastSeen] keeps the
 * leaf for the dialog.
 *
 * The same trust is the process default of HttpsURLConnection ([install]): Media3's DefaultHttpDataSource (2160 Player,
 * the audiobook player), the /cache and preload requests and the page's native requests ([client]) all go through it.
 */
object TorrServerTrust {
    const val PREFS = "omp-torrserver-pins"
    const val UNTRUSTED = "torrserver-cert-untrusted:"
    const val CHANGED = "torrserver-cert-changed:"

    interface PinBackend {
        fun get(key: String): String?
        fun put(key: String, fingerprint: String)
        fun remove(key: String)
        fun all(): Map<String, String>
    }

    class MemoryPins : PinBackend {
        private val map = ConcurrentHashMap<String, String>()
        override fun get(key: String): String? = map[key]
        override fun put(key: String, fingerprint: String) {
            map[key] = fingerprint
        }
        override fun remove(key: String) {
            map.remove(key)
        }
        override fun all(): Map<String, String> = HashMap(map)
    }

    private class PrefsPins(private val prefs: SharedPreferences) : PinBackend {
        override fun get(key: String): String? = prefs.getString(key, null)
        override fun put(key: String, fingerprint: String) {
            prefs.edit().putString(key, fingerprint).apply()
        }
        override fun remove(key: String) {
            prefs.edit().remove(key).apply()
        }
        override fun all(): Map<String, String> =
            prefs.all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()
    }

    /** The leaf a refused handshake presented, for the dialog. */
    data class Seen(val fingerprint: String, val subject: String, val issuer: String, val notAfter: Long)

    @Volatile
    var backend: PinBackend = MemoryPins()

    private val seen = ConcurrentHashMap<String, Seen>()

    @Volatile
    private var installed = false

    /** The platform's trust (network security config included); replaced in JVM tests. */
    @Volatile
    var system: X509ExtendedTrustManager = platformTrust()

    /** «host:port», lower case, IPv6 without brackets and zone; the port is the URL's or the scheme's default. */
    fun key(host: String, port: Int): String = CertPins.normalize(host) + ":" + port

    fun attach(prefs: SharedPreferences) {
        backend = PrefsPins(prefs)
    }

    /**
     * Pins and the process default of HttpsURLConnection (idempotent). Called by every entry point that can play or
     * fetch from TorrServer: the activity with the page, the player activity and the audiobook service.
     */
    @Synchronized
    fun install(prefs: SharedPreferences) {
        attach(prefs)
        if (installed) return
        val platformVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
        HttpsURLConnection.setDefaultSSLSocketFactory(socketFactory())
        HttpsURLConnection.setDefaultHostnameVerifier(verifier(platformVerifier))
        installed = true
    }

    fun install(ctx: Context) {
        install(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE))
    }

    /** The host:port values the user trusted. */
    fun pinned(): List<String> = backend.all().keys.sorted()

    fun isPinned(host: String, port: Int): Boolean = backend.get(key(host, port)) != null

    /** An https URL whose host:port has a pin (a self-signed TorrServer the user trusted). */
    fun isPinnedUrl(url: String): Boolean {
        val u = try {
            java.net.URI(url)
        } catch (_: Exception) {
            return false
        }
        if (!"https".equals(u.scheme, ignoreCase = true)) return false
        val host = u.host ?: return false
        return isPinned(host, if (u.port > 0) u.port else 443)
    }

    /** The user accepted [fingerprint] for [hostPort] («host:port»). */
    fun trust(hostPort: String, fingerprint: String) {
        val k = normalizeKey(hostPort) ?: throw IllegalArgumentException("bad host")
        val fp = fingerprint.trim().lowercase()
        if (!CertPins.FP.matches(fp)) throw IllegalArgumentException("bad fingerprint")
        backend.put(k, fp)
        seen.remove(k)
    }

    fun forget(hostPort: String) {
        normalizeKey(hostPort)?.let { backend.remove(it) }
    }

    fun lastSeen(hostPort: String): Seen? = normalizeKey(hostPort)?.let { seen[it] }

    /** «host:port» as typed by the page (IPv6 in brackets allowed), normalized; null when it is not one. */
    fun normalizeKey(hostPort: String): String? {
        val s = hostPort.trim()
        val colon = s.lastIndexOf(':')
        if (colon <= 0) return null
        val port = s.substring(colon + 1).toIntOrNull() ?: return null
        if (port !in 1..65535) return null
        val host = s.substring(0, colon)
        if (host.isBlank()) return null
        return key(host, port)
    }

    /**
     * The decision for a chain the system refused ([systemError]): the pinned leaf passes, anything else throws with
     * the leaf's fingerprint in the message.
     */
    fun checkPinned(host: String?, port: Int, chain: Array<out X509Certificate>?, systemError: CertificateException) {
        val leaf = chain?.firstOrNull() ?: throw systemError
        if (host.isNullOrBlank() || port <= 0) throw systemError
        val k = key(host, port)
        val fp = CertPins.fingerprint(leaf)
        val pin = backend.get(k)
        if (pin != null && pin == fp) return
        seen[k] = Seen(fp, leaf.subjectX500Principal.name, leaf.issuerX500Principal.name, leaf.notAfter.time)
        throw CertificateException((if (pin == null) UNTRUSTED else CHANGED) + fp, systemError)
    }

    /** The pinned leaf of [session] for [hostname]: the host name check a self-signed certificate cannot pass. */
    fun pinnedSession(hostname: String?, session: SSLSession?): Boolean {
        if (hostname.isNullOrBlank() || session == null) return false
        val pin = backend.get(key(hostname, session.peerPort)) ?: return false
        val leaf = try {
            session.peerCertificates.firstOrNull() as? X509Certificate
        } catch (_: Exception) {
            null
        } ?: return false
        return CertPins.fingerprint(leaf) == pin
    }

    /** The platform's verifier first; a pinned leaf for that host:port passes too. */
    fun verifier(platform: HostnameVerifier): HostnameVerifier = HostnameVerifier { hostname, session ->
        platform.verify(hostname, session) || pinnedSession(hostname, session)
    }

    fun trustManager(): X509ExtendedTrustManager = Composite()

    fun socketFactory(): SSLSocketFactory {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(trustManager()), SecureRandom())
        return ctx.socketFactory
    }

    /** The `torrserver-cert-…:<fp>` failure inside [t] (the cause chain): kind and fingerprint, or null. */
    fun failureOf(t: Throwable?): Pair<String, String>? {
        var c = t
        while (c != null) {
            val m = c.message
            if (m != null) {
                for (kind in arrayOf(UNTRUSTED, CHANGED)) {
                    val i = m.indexOf(kind)
                    if (i >= 0) {
                        val fp = m.substring(i + kind.length).take(64).lowercase()
                        if (CertPins.FP.matches(fp)) return (if (kind == UNTRUSTED) "untrusted" else "changed") to fp
                    }
                }
            }
            c = c.cause
        }
        return null
    }

    fun reset() {
        backend = MemoryPins()
        seen.clear()
    }

    private fun platformTrust(): X509ExtendedTrustManager {
        val f = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        f.init(null as KeyStore?)
        val tm = f.trustManagers.filterIsInstance<X509TrustManager>().first()
        return tm as? X509ExtendedTrustManager ?: Adapted(tm)
    }

    /** A plain X509TrustManager as an extended one (the socket and engine are not needed by it). */
    private class Adapted(private val tm: X509TrustManager) : X509ExtendedTrustManager() {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = tm.checkClientTrusted(chain, authType)
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = tm.checkServerTrusted(chain, authType)
        override fun getAcceptedIssuers(): Array<X509Certificate> = tm.acceptedIssuers
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) = tm.checkClientTrusted(chain, authType)
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) = tm.checkServerTrusted(chain, authType)
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) = tm.checkClientTrusted(chain, authType)
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) = tm.checkServerTrusted(chain, authType)
    }

    /** System first, then the pin of the peer's host:port. */
    private class Composite : X509ExtendedTrustManager() {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
            system.checkClientTrusted(chain, authType)

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) =
            system.checkClientTrusted(chain, authType, socket)

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
            system.checkClientTrusted(chain, authType, engine)

        override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            // no peer to read a host:port from: the system alone
            system.checkServerTrusted(chain, authType)
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
            try {
                system.checkServerTrusted(chain, authType, socket)
            } catch (e: CertificateException) {
                val ssl = socket as? SSLSocket
                val session = try {
                    ssl?.handshakeSession
                } catch (_: Exception) {
                    null
                }
                // the host name the connection dialed (no reverse lookup); no session: the system's answer stands
                checkPinned(session?.peerHost, session?.peerPort ?: -1, chain, e)
            }
        }

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
            try {
                system.checkServerTrusted(chain, authType, engine)
            } catch (e: CertificateException) {
                checkPinned(engine?.peerHost, engine?.peerPort ?: -1, chain, e)
            }
        }
    }
}
