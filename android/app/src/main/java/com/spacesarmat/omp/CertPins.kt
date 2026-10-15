package com.spacesarmat.omp

import android.content.Context
import android.content.SharedPreferences
import java.security.MessageDigest
import java.security.cert.X509Certificate

/**
 * TOFU certificate pins (SHA-256 of the leaf DER), keyed by host/IP.
 * First accepted cert is stored; a later different cert is rejected until the pin is cleared.
 */
class CertPins(
    private val read: (String) -> String?,
    private val write: (String, String?) -> Unit,
) {
    constructor(prefs: SharedPreferences) : this(
        read = { prefs.getString(it, null) },
        write = { k, v ->
            val e = prefs.edit()
            if (v == null) e.remove(k) else e.putString(k, v)
            e.apply()
        },
    )

    fun get(host: String): ByteArray? {
        val hex = read(key(host)) ?: return null
        return hexToBytes(hex)
    }

    fun put(host: String, digest: ByteArray) {
        write(key(host), bytesToHex(digest))
    }

    /** Accept [leaf] under TOFU or an existing pin; throws [java.security.cert.CertificateException] on mismatch. */
    fun checkOrRemember(host: String, leaf: X509Certificate) {
        val dig = digest(leaf)
        val expected = get(host)
        if (expected == null) {
            put(host, dig)
            return
        }
        if (!MessageDigest.isEqual(expected, dig)) {
            throw java.security.cert.CertificateException("certificate pin mismatch for $host")
        }
    }

    fun clear(host: String) {
        write(key(host), null)
    }

    companion object {
        fun tv(ctx: Context) = CertPins(ctx.applicationContext.getSharedPreferences("omp-tv-cert", Context.MODE_PRIVATE))
        fun box(ctx: Context) = CertPins(ctx.applicationContext.getSharedPreferences("omp-box-cert", Context.MODE_PRIVATE))

        /** In-memory pins for unit tests (no Android prefs). */
        fun memory(): CertPins {
            val m = LinkedHashMap<String, String>()
            return CertPins(
                read = { m[it] },
                write = { k, v -> if (v == null) m.remove(k) else m[k] = v },
            )
        }

        fun digest(cert: X509Certificate): ByteArray =
            MessageDigest.getInstance("SHA-256").digest(cert.encoded)

        private fun key(host: String) = "pin:" + host.trim().lowercase()

        private fun bytesToHex(b: ByteArray) = b.joinToString("") { "%02x".format(it.toInt() and 0xff) }

        private fun hexToBytes(hex: String): ByteArray? {
            if (hex.length % 2 != 0 || !hex.all { it in '0'..'9' || it in 'a'..'f' }) return null
            return ByteArray(hex.length / 2) { i ->
                hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
            }
        }
    }
}
