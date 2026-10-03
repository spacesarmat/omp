package com.spacesarmat.omp.install

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import com.spacesarmat.omp.sources.SecretCodec
import dadb.AdbKeyPair
import java.io.File
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.UnrecoverableKeyException
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Arrays
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-GCM wrap/unwrap of a small secret with its name as AAD. On the device the key lives in the Android Keystore
 * ([keystoreKey]); tests pass a software key. [unwrap] returns null when the value can never be decrypted again
 * (corrupt, key lost or replaced — e.g. after a restore on a new phone) and throws on a transient failure.
 */
class AesGcmWrapper(private val key: () -> SecretKey) {
    fun wrap(name: String, plain: ByteArray): String {
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, key())
        c.updateAAD(name.toByteArray(Charsets.UTF_8))
        return SecretCodec.pack(c.iv, c.doFinal(plain))
    }

    fun unwrap(name: String, packed: String): ByteArray? {
        val parts = SecretCodec.unpack(packed.trim()) ?: return null
        return try {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, parts.first))
            c.updateAAD(name.toByteArray(Charsets.UTF_8))
            c.doFinal(parts.second)
        } catch (e: Exception) {
            if (e is AEADBadTagException || e is UnrecoverableKeyException || isInvalidated(e)) null else throw e
        }
    }

    private fun isInvalidated(e: Exception): Boolean = e is KeyPermanentlyInvalidatedException

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val KEYSTORE = "AndroidKeyStore"

        /** AES-256 key [alias] in the Android Keystore, created on first use; it never leaves the Keystore. */
        fun keystoreKey(alias: String): SecretKey {
            val ks = KeyStore.getInstance(KEYSTORE)
            ks.load(null)
            (ks.getKey(alias, null) as? SecretKey)?.let { return it }
            val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
            gen.init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            return gen.generateKey()
        }
    }
}

/**
 * The phone's adb identity: the RSA private key as PKCS#8 DER and the adb public key line («base64 omp@phone»).
 * Generated in memory; the private key is written only encrypted ([AdbIdentityStore]).
 */
class AdbIdentity(val privateDer: ByteArray, val publicLine: ByteArray) {
    /** dadb key pair; the public key goes over the wire NUL-terminated, as dadb's own reader does. */
    fun toKeyPair(): AdbKeyPair {
        val key: PrivateKey = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(privateDer))
        return AdbKeyPair(key, publicLine.copyOf(publicLine.size + 1))
    }

    fun wipe() {
        Arrays.fill(privateDer, 0)
    }

    /** Stored form: «private DER» NUL-separated from «public line» (the line never contains NUL). */
    fun encode(): ByteArray {
        val out = ByteArray(privateDer.size + 1 + publicLine.size)
        System.arraycopy(privateDer, 0, out, 0, privateDer.size)
        System.arraycopy(publicLine, 0, out, privateDer.size + 1, publicLine.size)
        return out
    }

    companion object {
        private const val USER = " omp@phone"

        /** The public line is after the last NUL (DER may contain zero bytes, the base64 line never does). */
        fun decode(bytes: ByteArray): AdbIdentity? {
            val i = bytes.lastIndexOf(0.toByte())
            if (i <= 0 || i == bytes.size - 1) return null
            // PKCS#8 DER is a SEQUENCE; anything else (e.g. an earlier PEM form) means «make a new identity»
            if (bytes[0] != 0x30.toByte()) return null
            return AdbIdentity(bytes.copyOfRange(0, i), bytes.copyOfRange(i + 1, bytes.size))
        }

        /** A new RSA 2048 identity, entirely in memory. */
        fun generate(): AdbIdentity {
            val kp = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair()
            val pub = kp.public as RSAPublicKey
            val line = Base64.getEncoder().encodeToString(adbPublicKey(pub)) + USER
            return AdbIdentity(kp.private.encoded, line.toByteArray(Charsets.US_ASCII))
        }

        /**
         * adb's RSA public key format (AOSP adb `RSA_to_RSAPublicKey`, dadb `convertRsaPublicKeyToAdbFormat`):
         * little-endian words — word count 64, n0inv = -1/n mod 2^32, modulus, rr = 2^4096 mod n, exponent.
         */
        fun adbPublicKey(pub: RSAPublicKey): ByteArray {
            val words = 64
            val r32 = BigInteger.ZERO.setBit(32)
            var n = pub.modulus
            val r = BigInteger.ZERO.setBit(words * 32)
            var rr = r.modPow(BigInteger.valueOf(2), n)
            val n0inv = n.remainder(r32).modInverse(r32)
            val buf = ByteBuffer.allocate(4 + 4 + words * 4 + words * 4 + 4).order(ByteOrder.LITTLE_ENDIAN)
            buf.putInt(words)
            buf.putInt(n0inv.negate().toInt())
            for (i in 0 until words) {
                val qr = n.divideAndRemainder(r32)
                n = qr[0]
                buf.putInt(qr[1].toInt())
            }
            for (i in 0 until words) {
                val qr = rr.divideAndRemainder(r32)
                rr = qr[0]
                buf.putInt(qr[1].toInt())
            }
            buf.putInt(pub.publicExponent.toInt())
            return buf.array()
        }
    }
}

/**
 * The adb identity encrypted at rest in [file] (in noBackupFilesDir, also excluded from backups and device
 * transfer). Created on first use; when it can no longer be decrypted (Keystore key lost after a restore) a new one
 * is made silently — the TV just asks «Разрешить отладку?» again.
 */
class AdbIdentityStore(
    private val file: File,
    private val wrapper: AesGcmWrapper,
    private val generate: () -> AdbIdentity,
) {
    @Synchronized
    fun load(): AdbIdentity {
        if (file.exists()) {
            val plain = wrapper.unwrap(NAME, file.readText(Charsets.US_ASCII))
            if (plain != null) {
                try {
                    AdbIdentity.decode(plain)?.let { return it }
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
        const val NAME = "adb-identity"
    }
}
