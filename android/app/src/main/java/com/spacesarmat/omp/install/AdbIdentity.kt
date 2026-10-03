package com.spacesarmat.omp.install

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import com.spacesarmat.omp.sources.SecretCodec
import dadb.AdbKeyPair
import java.io.File
import java.security.KeyFactory
import java.security.KeyStore
import java.security.PrivateKey
import java.security.UnrecoverableKeyException
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

/** The phone's adb identity: PKCS#8 PEM private key and the adb public key line («base64 user@host»). */
class AdbIdentity(val privatePem: ByteArray, val publicLine: ByteArray) {
    /** dadb key pair; the public key goes over the wire NUL-terminated, as dadb's own reader does. */
    fun toKeyPair(): AdbKeyPair {
        val text = String(privatePem, Charsets.US_ASCII)
        val body = text.lines().filter { it.isNotBlank() && !it.startsWith("-----") }.joinToString("")
        val der = Base64.getDecoder().decode(body)
        val key: PrivateKey = try {
            KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(der))
        } finally {
            Arrays.fill(der, 0)
        }
        return AdbKeyPair(key, publicLine.copyOf(publicLine.size + 1))
    }

    fun wipe() {
        Arrays.fill(privatePem, 0)
    }

    /** Stored form: «private PEM» NUL «public line». */
    fun encode(): ByteArray {
        val out = ByteArray(privatePem.size + 1 + publicLine.size)
        System.arraycopy(privatePem, 0, out, 0, privatePem.size)
        System.arraycopy(publicLine, 0, out, privatePem.size + 1, publicLine.size)
        return out
    }

    companion object {
        fun decode(bytes: ByteArray): AdbIdentity? {
            val i = bytes.indexOf(0.toByte())
            if (i <= 0 || i == bytes.size - 1) return null
            val prv = bytes.copyOfRange(0, i)
            val pub = bytes.copyOfRange(i + 1, bytes.size)
            if (!String(prv, Charsets.US_ASCII).contains("PRIVATE KEY")) {
                Arrays.fill(prv, 0)
                return null
            }
            return AdbIdentity(prv, pub)
        }

        /** A new identity through dadb's generator; the temporary files are deleted right away. */
        fun generate(tmpDir: File): AdbIdentity {
            tmpDir.mkdirs()
            val prv = File.createTempFile("adbkey", ".tmp", tmpDir)
            val pub = File.createTempFile("adbkey", ".pub", tmpDir)
            try {
                AdbKeyPair.generate(prv, pub)
                return AdbIdentity(prv.readBytes(), pub.readBytes())
            } finally {
                prv.delete()
                pub.delete()
            }
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
