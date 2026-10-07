package com.spacesarmat.omp.box

import com.spacesarmat.omp.install.AesGcmWrapper
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.math.BigInteger
import java.net.Socket
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Principal
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Arrays
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509ExtendedTrustManager

/**
 * The phone's client certificate for the Android TV Remote protocol: an RSA 2048 key and a self-signed X.509 v3
 * certificate (CN=OMP), made once on the phone. The TV remembers the certificate when pairing; the same one is
 * presented on every later connection. The private key is stored only encrypted ([BoxIdentityStore]).
 */
class BoxIdentity(val privateDer: ByteArray, val certDer: ByteArray) {
    val certificate: X509Certificate by lazy {
        CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(certDer)) as X509Certificate
    }

    val publicKey: RSAPublicKey get() = certificate.publicKey as RSAPublicKey

    fun privateKey(): PrivateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(privateDer))

    /** Stored form: 4-byte private length, private DER, certificate DER. */
    fun encode(): ByteArray {
        val out = ByteArray(4 + privateDer.size + certDer.size)
        val n = privateDer.size
        out[0] = (n ushr 24).toByte()
        out[1] = (n ushr 16).toByte()
        out[2] = (n ushr 8).toByte()
        out[3] = n.toByte()
        System.arraycopy(privateDer, 0, out, 4, n)
        System.arraycopy(certDer, 0, out, 4 + n, certDer.size)
        return out
    }

    fun wipe() {
        Arrays.fill(privateDer, 0)
    }

    /**
     * A TLS socket factory presenting this certificate. The TV's own certificate is self-signed, so any server
     * certificate is accepted; the pairing secret binds both public keys, and the TV accepts only a paired client.
     */
    fun socketFactory(): SSLSocketFactory {
        val key = privateKey()
        val chain = arrayOf(certificate)
        val km = object : X509ExtendedKeyManager() {
            override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(ALIAS)
            override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?) = ALIAS
            override fun chooseEngineClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, engine: SSLEngine?) = ALIAS
            override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? = null
            override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?): String? = null
            override fun getCertificateChain(alias: String?) = chain
            override fun getPrivateKey(alias: String?) = key
        }
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(arrayOf(km), arrayOf(AnyServer), SecureRandom())
        return ctx.socketFactory
    }

    private object AnyServer : X509ExtendedTrustManager() {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = throw java.security.cert.CertificateException("server only")
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) = throw java.security.cert.CertificateException("server only")
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) = throw java.security.cert.CertificateException("server only")
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {}
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    companion object {
        private const val ALIAS = "omp"

        fun decode(bytes: ByteArray): BoxIdentity? {
            if (bytes.size < 8) return null
            val n = ((bytes[0].toInt() and 0xFF) shl 24) or ((bytes[1].toInt() and 0xFF) shl 16) or
                ((bytes[2].toInt() and 0xFF) shl 8) or (bytes[3].toInt() and 0xFF)
            if (n <= 0 || n > bytes.size - 5) return null
            return try {
                val id = BoxIdentity(bytes.copyOfRange(4, 4 + n), bytes.copyOfRange(4 + n, bytes.size))
                id.certificate
                id
            } catch (e: Exception) {
                null
            }
        }

        fun generate(now: Date = Date()): BoxIdentity {
            val kp = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair()
            return BoxIdentity(kp.private.encoded, SelfSignedCert.build(kp, "OMP", now))
        }
    }
}

/** A minimal DER encoder for one self-signed X.509 v3 certificate (no extensions), signed SHA256withRSA. */
object SelfSignedCert {
    // 1.2.840.113549.1.1.11 sha256WithRSAEncryption
    private val SHA256_RSA = byteArrayOf(0x2A, 0x86.toByte(), 0x48, 0x86.toByte(), 0xF7.toByte(), 0x0D, 0x01, 0x01, 0x0B)
    // 2.5.4.3 commonName
    private val CN = byteArrayOf(0x55, 0x04, 0x03)

    fun build(kp: KeyPair, commonName: String, now: Date): ByteArray {
        val alg = seq(tlv(0x06, SHA256_RSA), tlv(0x05, ByteArray(0)))
        val name = seq(tlv(0x31, seq(tlv(0x06, CN), tlv(0x0C, commonName.toByteArray(Charsets.UTF_8)))))
        val serial = BigInteger(63, SecureRandom()).add(BigInteger.ONE)
        val validity = seq(utcTime(Date(now.time - DAY_MS)), tlv(0x17, "491231235959Z".toByteArray(Charsets.US_ASCII)))
        val tbs = seq(
            tlv(0xA0, tlv(0x02, byteArrayOf(2))),
            tlv(0x02, serial.toByteArray()),
            alg,
            name,
            validity,
            name,
            kp.public.encoded,
        )
        val sig = Signature.getInstance("SHA256withRSA").run {
            initSign(kp.private)
            update(tbs)
            sign()
        }
        return seq(tbs, alg, tlv(0x03, byteArrayOf(0) + sig))
    }

    private fun utcTime(d: Date): ByteArray {
        val f = SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return tlv(0x17, f.format(d).toByteArray(Charsets.US_ASCII))
    }

    private fun seq(vararg parts: ByteArray): ByteArray = tlv(0x30, concat(*parts))

    private fun concat(vararg parts: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        parts.forEach { out.write(it) }
        return out.toByteArray()
    }

    fun tlv(tag: Int, value: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(tag)
        val n = value.size
        when {
            n < 0x80 -> out.write(n)
            n < 0x100 -> {
                out.write(0x81)
                out.write(n)
            }
            n < 0x10000 -> {
                out.write(0x82)
                out.write(n ushr 8)
                out.write(n and 0xFF)
            }
            else -> {
                out.write(0x83)
                out.write(n ushr 16)
                out.write((n ushr 8) and 0xFF)
                out.write(n and 0xFF)
            }
        }
        out.write(value)
        return out.toByteArray()
    }

    private const val DAY_MS = 24L * 3600 * 1000
}

/**
 * The client certificate and its key, encrypted at rest in [file] (noBackupFilesDir: not backed up or transferred).
 * Made on first use; when it can no longer be decrypted (Keystore key lost) a new one is made and the TV simply
 * asks for a pairing code again.
 */
class BoxIdentityStore(
    private val file: File,
    private val wrapper: AesGcmWrapper,
    private val generate: () -> BoxIdentity = { BoxIdentity.generate() },
) {
    @Synchronized
    fun load(): BoxIdentity {
        if (file.exists()) {
            val plain = wrapper.unwrap(NAME, file.readText(Charsets.US_ASCII))
            if (plain != null) {
                try {
                    BoxIdentity.decode(plain)?.let { return it }
                } finally {
                    Arrays.fill(plain, 0)
                }
            }
        }
        val id = generate()
        val bytes = id.encode()
        try {
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".new")
            tmp.writeText(wrapper.wrap(NAME, bytes), Charsets.US_ASCII)
            if (!tmp.renameTo(file)) {
                file.delete()
                tmp.renameTo(file)
            }
        } finally {
            Arrays.fill(bytes, 0)
        }
        return id
    }

    companion object {
        const val NAME = "box-remote-identity"
    }
}
