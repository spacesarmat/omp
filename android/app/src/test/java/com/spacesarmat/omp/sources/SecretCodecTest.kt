package com.spacesarmat.omp.sources

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SecretCodecTest {
    @Test
    fun packsIvAndCiphertext() {
        val iv = ByteArray(12) { it.toByte() }
        val ct = byteArrayOf(9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7)
        val (iv2, ct2) = SecretCodec.unpack(SecretCodec.pack(iv, ct))!!
        assertArrayEquals(iv, iv2)
        assertArrayEquals(ct, ct2)
    }

    @Test
    fun rejectsGarbage() {
        assertNull(SecretCodec.unpack(""))
        assertNull(SecretCodec.unpack("not base64 !!"))
        assertNull(SecretCodec.unpack("AQ=="))
        assertNull(SecretCodec.unpack(SecretCodec.pack(ByteArray(12), ByteArray(0))))
    }
}
