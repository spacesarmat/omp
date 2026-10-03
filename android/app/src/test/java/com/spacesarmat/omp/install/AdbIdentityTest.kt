package com.spacesarmat.omp.install

import java.io.File
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AdbIdentityTest {
    private fun aes(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test
    fun wrapUnwrapIsBoundToTheName() {
        val key = aes()
        val w = AesGcmWrapper { key }
        val packed = w.wrap("adb-identity", "secret".toByteArray())
        assertFalse(packed.contains("secret"))
        assertArrayEquals("secret".toByteArray(), w.unwrap("adb-identity", packed))
        assertNull(w.unwrap("other-name", packed))
        assertNull(AesGcmWrapper { aes() }.unwrap("adb-identity", packed))
        assertNull(w.unwrap("adb-identity", "garbage!!"))
    }

    @Test
    fun aTransientKeyFailureThrowsInsteadOfDroppingTheIdentity() {
        val w = AesGcmWrapper { aes() }
        val packed = w.wrap("n", byteArrayOf(1))
        val broken = AesGcmWrapper { throw java.security.KeyStoreException("busy") }
        try {
            broken.unwrap("n", packed)
            throw AssertionError("no exception")
        } catch (_: java.security.KeyStoreException) {
        }
    }

    @Test
    fun identityIsGeneratedOnceAndStoredEncrypted() {
        val dir = tempDir()
        val file = File(dir, "adb/identity.enc")
        val key = aes()
        var generated = 0
        val store = AdbIdentityStore(file, AesGcmWrapper { key }) {
            generated++
            AdbIdentity.generate(File(dir, "tmp"))
        }
        val first = store.load()
        assertEquals(1, generated)
        assertTrue(file.exists())
        val stored = file.readText()
        assertFalse(stored.contains("PRIVATE KEY"))
        assertFalse(stored.contains("unknown@unknown"))
        // the generator's temporary files are gone
        assertEquals(0, File(dir, "tmp").list()!!.size)
        val second = store.load()
        assertEquals(1, generated)
        assertArrayEquals(first.publicLine, second.publicLine)
        assertArrayEquals(first.privatePem, second.privatePem)
        assertNotNull(second.toKeyPair())
    }

    @Test
    fun aLostKeystoreKeyMeansANewIdentitySilently() {
        val dir = tempDir()
        val file = File(dir, "identity.enc")
        var generated = 0
        val gen = {
            generated++
            AdbIdentity.generate(File(dir, "tmp"))
        }
        val old = AdbIdentityStore(file, AesGcmWrapper { aes() }, gen).load()
        // restore on a new phone: the Keystore key is different
        val fresh = AdbIdentityStore(file, AesGcmWrapper { aes() }, gen).load()
        assertEquals(2, generated)
        assertFalse(old.publicLine.contentEquals(fresh.publicLine))
    }

    @Test
    fun encodeDecodeAndWipe() {
        val id = AdbIdentity("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----".toByteArray(), "QUJD unknown@unknown".toByteArray())
        val back = AdbIdentity.decode(id.encode())!!
        assertArrayEquals(id.privatePem, back.privatePem)
        assertArrayEquals(id.publicLine, back.publicLine)
        assertNull(AdbIdentity.decode("no separator".toByteArray()))
        assertNull(AdbIdentity.decode("junk\u0000pub".toByteArray()))
        back.wipe()
        assertTrue(back.privatePem.all { it == 0.toByte() })
    }
}
