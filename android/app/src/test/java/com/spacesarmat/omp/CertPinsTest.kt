package com.spacesarmat.omp

import java.io.ByteArrayInputStream
import java.security.KeyPairGenerator
import java.security.cert.CertificateException
import java.util.Date
import com.spacesarmat.omp.box.SelfSignedCert
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CertPinsTest {
    private fun leaf() = run {
        val kp = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.genKeyPair()
        val der = SelfSignedCert.build(kp, "OMP", Date())
        java.security.cert.CertificateFactory.getInstance("X.509")
            .generateCertificate(ByteArrayInputStream(der)) as java.security.cert.X509Certificate
    }

    @Test
    fun tofuThenMatch() {
        val pins = CertPins.memory()
        val a = leaf()
        pins.checkOrRemember("192.168.1.5", a)
        assertNotNull(pins.get("192.168.1.5"))
        pins.checkOrRemember("192.168.1.5", a)
        assertArrayEquals(CertPins.digest(a), pins.get("192.168.1.5"))
    }

    @Test(expected = CertificateException::class)
    fun mismatchRejected() {
        val pins = CertPins.memory()
        pins.checkOrRemember("10.0.0.1", leaf())
        pins.checkOrRemember("10.0.0.1", leaf())
    }

    @Test
    fun clearRemovesPin() {
        val pins = CertPins.memory()
        pins.checkOrRemember("10.0.0.2", leaf())
        pins.clear("10.0.0.2")
        assertNull(pins.get("10.0.0.2"))
    }
}
