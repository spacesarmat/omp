package com.spacesarmat.omp.box

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.interfaces.RSAPublicKey
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AtvRemoteProtocolTest {
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    private fun hexOf(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    /** A short key for the vector (the JDK key factory refuses keys under 512 bits). */
    private fun rsa(modHex: String, exp: Long): RSAPublicKey = object : RSAPublicKey {
        override fun getModulus() = BigInteger(modHex, 16)
        override fun getPublicExponent() = BigInteger.valueOf(exp)
        override fun getAlgorithm() = "RSA"
        override fun getFormat() = "X.509"
        override fun getEncoded() = ByteArray(0)
    }

    @Test
    fun varintsAndFields() {
        assertEquals("ac02", hexOf(ProtoWriter.varintBytes(300)))
        assertEquals("01", hexOf(ProtoWriter.varintBytes(1)))
        assertEquals("c801", hexOf(ProtoWriter.varintBytes(200)))
        val m = ProtoWriter().int(1, 150).string(2, "hi").message(3, ProtoWriter().bool(1, true)).toByteArray()
        assertEquals("08960112026869" + "1a020801", hexOf(m))
        val d = ProtoMessage(m)
        assertEquals(150, d.int(1))
        assertEquals("hi", d.string(2))
        assertEquals(1L, d.message(3)!!.long(1))
        assertNull(d.int(9))
    }

    @Test
    fun framesAreVarintLengthPrefixed() {
        val out = ByteArrayOutputStream()
        val big = ByteArray(200) { 7 }
        ProtoFrames.write(out, byteArrayOf(1, 2, 3))
        ProtoFrames.write(out, big)
        val bytes = out.toByteArray()
        assertEquals("03010203c801", hexOf(bytes.copyOfRange(0, 6)))
        val input = ByteArrayInputStream(bytes)
        assertArrayEquals(byteArrayOf(1, 2, 3), ProtoFrames.read(input))
        assertArrayEquals(big, ProtoFrames.read(input))
    }

    @Test
    fun pairingMessages() {
        // version 2, status 200, pairing_request { service_name "atvremote", client_name "S21" }
        assertEquals(
            "0802" + "10c801" + "5210" + "0a0961747672656d6f7465" + "1203533231",
            hexOf(AtvRemoteProtocol.pairingRequest("S21")),
        )
        // pairing_option { input_encodings { hexadecimal, 6 }, preferred_role input }
        assertEquals("0802" + "10c801" + "a20108" + "0a0408031006" + "1801", hexOf(AtvRemoteProtocol.pairingOption()))
        // pairing_configuration { encoding { hexadecimal, 6 }, client_role input }
        assertEquals("0802" + "10c801" + "f20108" + "0a0408031006" + "1001", hexOf(AtvRemoteProtocol.pairingConfiguration()))
        assertEquals("0802" + "10c801" + "c20204" + "0a02beef", hexOf(AtvRemoteProtocol.pairingSecret(hex("beef"))))
        assertEquals(200, AtvRemoteProtocol.pairingStatus(hex("080210c8015a00")))
        assertEquals(402, AtvRemoteProtocol.pairingStatus(hex("08021092 03".replace(" ", ""))))
    }

    @Test
    fun pairingSecretKnownVector() {
        // SHA-256(9f×32 ‖ 010001 ‖ (a1b2c3d4)×8 ‖ 03 ‖ beef), computed independently (Python hashlib)
        val client = rsa("9f".repeat(32), 65537)
        val server = rsa("a1b2c3d4".repeat(8), 3)
        val secret = AtvRemoteProtocol.pairingSecret(client, server, "62beef")
        assertEquals("629fb8a035032540bcc2d67e76be426aacce97fa2e60d2b81b37c4dea7b4d73b", hexOf(secret))
        assertTrue(AtvRemoteProtocol.codeMatches(secret, "62 BEEF"))
        // a mistyped first pair is caught on the phone
        assertFalse(AtvRemoteProtocol.codeMatches(AtvRemoteProtocol.pairingSecret(client, server, "63beef"), "63beef"))
    }

    @Test
    fun codesAreSixHexDigits() {
        assertEquals("A1B2C3", AtvRemoteProtocol.normalizeCode(" a1b2 c3 "))
        assertNull(AtvRemoteProtocol.normalizeCode("12345"))
        assertNull(AtvRemoteProtocol.normalizeCode("12345G"))
        assertArrayEquals(byteArrayOf(1, 0, 1), AtvRemoteProtocol.unsigned(BigInteger.valueOf(65537)))
        assertArrayEquals(byteArrayOf(0xFF.toByte()), AtvRemoteProtocol.unsigned(BigInteger.valueOf(255)))
    }

    @Test
    fun remoteMessages() {
        // remote_key_inject { key_code 19 (DPAD_UP), direction SHORT }
        assertEquals("52040813" + "1003", hexOf(AtvRemoteProtocol.keyInject(19, AtvRemoteProtocol.DIRECTION_SHORT)))
        assertEquals("520408031001", hexOf(AtvRemoteProtocol.keyInject(3, AtvRemoteProtocol.DIRECTION_START_LONG)))
        assertEquals("4a020805", hexOf(AtvRemoteProtocol.pingResponse(5)))
        assertEquals("120308e304", hexOf(AtvRemoteProtocol.remoteSetActive()))
        val conf = ProtoMessage(AtvRemoteProtocol.remoteConfigure("SM-G998B", "samsung", "0.19.0")).message(1)!!
        assertEquals(AtvRemoteProtocol.FEATURES, conf.int(1))
        val info = conf.message(2)!!
        assertEquals("SM-G998B", info.string(1))
        assertEquals("samsung", info.string(2))
        assertEquals("atvremote", info.string(5))
        assertEquals("0.19.0", info.string(6))
    }

    @Test
    fun parsesWhatTheTvSends() {
        val ping = AtvRemoteProtocol.parseRemote(ProtoWriter().message(8, ProtoWriter().int(1, 42).int(2, 7)).toByteArray())
        assertEquals(42L, (ping as AtvRemoteProtocol.Incoming.Ping).val1)
        assertTrue(AtvRemoteProtocol.parseRemote(ProtoWriter().message(1, ProtoWriter().int(1, 639)).toByteArray()) is AtvRemoteProtocol.Incoming.Configure)
        assertTrue(AtvRemoteProtocol.parseRemote(ProtoWriter().message(2, ProtoWriter().int(1, 622)).toByteArray()) is AtvRemoteProtocol.Incoming.SetActive)
        val vol = AtvRemoteProtocol.parseRemote(
            ProtoWriter().message(50, ProtoWriter().string(3, "box").int(6, 100).int(7, 35).bool(8, true)).toByteArray(),
        ) as AtvRemoteProtocol.Incoming.Volume
        assertEquals(35, vol.level)
        assertEquals(100, vol.max)
        assertTrue(vol.muted)
        assertTrue(AtvRemoteProtocol.parseRemote(ProtoWriter().message(40, ProtoWriter().bool(1, true)).toByteArray()) is AtvRemoteProtocol.Incoming.Started)
        assertTrue(AtvRemoteProtocol.parseRemote(ProtoWriter().message(21, ProtoWriter().int(1, 1)).toByteArray()) is AtvRemoteProtocol.Incoming.Other)
    }
}
