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
            AdbIdentity.generate()
        }
        val first = store.load()
        assertEquals(1, generated)
        assertTrue(file.exists())
        val stored = file.readText()
        assertFalse(stored.contains("PRIVATE KEY"))
        assertFalse(stored.contains("omp@phone"))
        // nothing but the encrypted file is written
        assertEquals(listOf("identity.enc"), File(dir, "adb").list()!!.toList())
        assertEquals(listOf("adb"), dir.list()!!.toList())
        val second = store.load()
        assertEquals(1, generated)
        assertArrayEquals(first.publicLine, second.publicLine)
        assertArrayEquals(first.privateDer, second.privateDer)
        assertNotNull(second.toKeyPair())
    }

    @Test
    fun aLostKeystoreKeyMeansANewIdentitySilently() {
        val dir = tempDir()
        val file = File(dir, "identity.enc")
        var generated = 0
        val gen = {
            generated++
            AdbIdentity.generate()
        }
        val old = AdbIdentityStore(file, AesGcmWrapper { aes() }, gen).load()
        // restore on a new phone: the Keystore key is different
        val fresh = AdbIdentityStore(file, AesGcmWrapper { aes() }, gen).load()
        assertEquals(2, generated)
        assertFalse(old.publicLine.contentEquals(fresh.publicLine))
    }

    @Test
    fun encodeDecodeAndWipe() {
        val id = AdbIdentity.generate()
        val back = AdbIdentity.decode(id.encode())!!
        assertArrayEquals(id.privateDer, back.privateDer)
        assertArrayEquals(id.publicLine, back.publicLine)
        assertNull(AdbIdentity.decode("no separator".toByteArray()))
        // the PEM form of an earlier build is not accepted: a new identity is made
        assertNull(AdbIdentity.decode("-----BEGIN PRIVATE KEY-----\u0000QUJD omp@phone".toByteArray()))
        back.wipe()
        assertTrue(back.privateDer.all { it == 0.toByte() })
    }

    @Test
    fun publicKeyLineMatchesDadbForTheSameKey() {
        // dadb writes a key pair to files (test only); our encoder must give the same adb public key for that key
        val dir = tempDir()
        val prv = File(dir, "adbkey")
        val pub = File(dir, "adbkey.pub")
        dadb.AdbKeyPair.generate(prv, pub)
        val body = prv.readText().lines().filter { it.isNotBlank() && !it.startsWith("-----") }.joinToString("")
        val key = java.security.KeyFactory.getInstance("RSA")
            .generatePrivate(java.security.spec.PKCS8EncodedKeySpec(java.util.Base64.getDecoder().decode(body))) as java.security.interfaces.RSAPrivateCrtKey
        val rsaPub = java.security.KeyFactory.getInstance("RSA")
            .generatePublic(java.security.spec.RSAPublicKeySpec(key.modulus, key.publicExponent)) as java.security.interfaces.RSAPublicKey
        val ours = java.util.Base64.getEncoder().encodeToString(AdbIdentity.adbPublicKey(rsaPub))
        assertEquals(pub.readText().substringBefore(' '), ours)
    }

    @Test
    fun aGeneratedIdentityIsAcceptedByDadb() {
        val id = AdbIdentity.generate()
        val line = String(id.publicLine, Charsets.US_ASCII)
        assertTrue(line.endsWith(" omp@phone"))
        assertEquals(524, java.util.Base64.getDecoder().decode(line.substringBefore(' ')).size)
        // dadb takes the key pair (the private key parses as PKCS#8 RSA)
        val pair = id.toKeyPair()
        assertNotNull(pair)
    }
}
