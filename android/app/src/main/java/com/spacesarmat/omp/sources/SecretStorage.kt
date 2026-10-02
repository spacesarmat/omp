package com.spacesarmat.omp.sources

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import java.util.Base64
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Stored form of an encrypted value: base64(ivLength · iv · ciphertext+tag). */
object SecretCodec {
    private const val TAG_BYTES = 16

    fun pack(iv: ByteArray, ciphertext: ByteArray): String {
        val out = ByteArray(1 + iv.size + ciphertext.size)
        out[0] = iv.size.toByte()
        System.arraycopy(iv, 0, out, 1, iv.size)
        System.arraycopy(ciphertext, 0, out, 1 + iv.size, ciphertext.size)
        return Base64.getEncoder().encodeToString(out)
    }

    fun unpack(packed: String): Pair<ByteArray, ByteArray>? {
        val bytes = try {
            Base64.getDecoder().decode(packed)
        } catch (e: IllegalArgumentException) {
            return null
        }
        if (bytes.isEmpty()) return null
        val ivLen = bytes[0].toInt() and 0xff
        if (ivLen < 12 || bytes.size < 1 + ivLen + TAG_BYTES) return null
        return Pair(bytes.copyOfRange(1, 1 + ivLen), bytes.copyOfRange(1 + ivLen, bytes.size))
    }
}

/**
 * Small secrets (tracker logins, session cookies): AES-256-GCM with a key that never leaves the Android
 * Keystore; ciphertext in a private SharedPreferences file. The entry name is bound as AAD, so a value
 * cannot be moved to another name. A value that no longer decrypts (key lost) reads as null and is dropped.
 * Values are never logged.
 */
class SecretStorage(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * null when not set. A value that can never be decrypted again (corrupt, key invalidated or replaced) is
     * dropped and reads as null; a transient Keystore failure throws and keeps the value.
     */
    @Synchronized
    fun get(name: String): String? {
        val packed = prefs.getString(name, null) ?: return null
        val parts = SecretCodec.unpack(packed)
        if (parts == null) {
            prefs.edit().remove(name).apply()
            return null
        }
        return try {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, parts.first))
            c.updateAAD(name.toByteArray(Charsets.UTF_8))
            String(c.doFinal(parts.second), Charsets.UTF_8)
        } catch (e: Exception) {
            if (!isPermanent(e)) throw e
            prefs.edit().remove(name).apply()
            null
        }
    }

    private fun isPermanent(e: Exception): Boolean =
        e is AEADBadTagException || e is KeyPermanentlyInvalidatedException || e is UnrecoverableKeyException

    /** Throws when the Keystore is unavailable. */
    @Synchronized
    fun set(name: String, value: String) {
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, key())
        c.updateAAD(name.toByteArray(Charsets.UTF_8))
        val ct = c.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(name, SecretCodec.pack(c.iv, ct)).apply()
    }

    @Synchronized
    fun delete(name: String) {
        prefs.edit().remove(name).apply()
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE)
        ks.load(null)
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    companion object {
        private const val PREFS = "omp-secrets"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "omp-secrets-aes"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
    }
}

/** Cookies of each site as an encrypted entry «cookies:<site>». Save failures keep cookies in memory only. */
class SecretCookieStore(private val secrets: SecretStorage) : CookieStore {
    /** Throws on a transient Keystore failure ([SiteCookieJar] then keeps the site in memory only). */
    override fun load(site: String): String? = secrets.get(PREFIX + site)

    override fun save(site: String, data: String?) {
        try {
            if (data == null) secrets.delete(PREFIX + site) else secrets.set(PREFIX + site, data)
        } catch (e: Exception) {
            // Keystore unavailable: the session lives until the app closes
        }
    }

    companion object {
        const val PREFIX = "cookies:"
    }
}
