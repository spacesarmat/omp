package com.spacesarmat.omp

import java.io.IOException
import java.security.cert.CertificateException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A changed Samsung certificate must not fall through to the plaintext port that carries the token. */
class SamsungRemoteTest {
    @Test
    fun aChangedCertificateDoesNotOpenThePlainPort() {
        val fp = "ab".repeat(32)
        assertFalse(samsungMayFallback(CertificateException("cert-changed:$fp")))
        assertFalse(samsungMayFallback(IOException("handshake", CertificateException("cert-changed:$fp"))))
    }

    @Test
    fun anOrdinaryFailureMayTryThePlainPort() {
        assertTrue(samsungMayFallback(IOException("connection refused")))
        assertTrue(samsungMayFallback(IllegalStateException("timeout")))
    }
}
