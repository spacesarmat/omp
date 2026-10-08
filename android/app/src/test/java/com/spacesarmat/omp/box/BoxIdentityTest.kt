package com.spacesarmat.omp.box

import com.spacesarmat.omp.install.AesGcmWrapper
import java.io.File
import java.net.InetAddress
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.KeyGenerator
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoxIdentityTest {
    @Test
    fun selfSignedCertificateParsesAndVerifies() {
        val id = BoxIdentity.generate()
        val cert = id.certificate
        cert.verify(cert.publicKey)
        cert.checkValidity()
        assertEquals(3, cert.version)
        assertEquals("CN=OMP", cert.subjectX500Principal.name)
        assertEquals(cert.subjectX500Principal, cert.issuerX500Principal)
        assertEquals("SHA256withRSA", cert.sigAlgName)
        assertEquals(2048, id.publicKey.modulus.bitLength())
    }

    @Test
    fun encodeDecodeRoundTrip() {
        val id = BoxIdentity.generate()
        val back = BoxIdentity.decode(id.encode())!!
        assertArrayEquals(id.privateDer, back.privateDer)
        assertArrayEquals(id.certDer, back.certDer)
        assertNull(BoxIdentity.decode(byteArrayOf(0, 0, 0, 9, 1, 2)))
        assertNull(BoxIdentity.decode(ByteArray(40)))
    }

    @Test
    fun storeKeepsTheIdentityEncryptedAndReusesIt() {
        val dir = File(System.getProperty("java.io.tmpdir"), "box-id-" + System.nanoTime())
        try {
            val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
            var made = 0
            val store = BoxIdentityStore(File(dir, "identity.enc"), AesGcmWrapper { key }) {
                made++
                BoxIdentity.generate()
            }
            val first = store.load()
            val second = store.load()
            assertEquals(1, made)
            assertArrayEquals(first.certDer, second.certDer)
            val raw = File(dir, "identity.enc").readText()
            assertFalse(raw.contains("OMP"))
            // a lost Keystore key: a new identity, the TV asks for a code again
            val other = BoxIdentityStore(File(dir, "identity.enc"), AesGcmWrapper { KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() })
            assertFalse(other.load().certDer.contentEquals(first.certDer))
        } finally {
            dir.deleteRecursively()
        }
    }

    /** A fake TV over real TLS: it requires a client certificate and checks the pairing secret like the real one. */
    @Test
    fun pairingOverTlsWithClientCertificate() {
        val tv = BoxIdentity.generate()
        val phone = BoxIdentity.generate()
        val ks = KeyStore.getInstance("PKCS12").apply {
            load(null)
            setKeyEntry("tv", tv.privateKey(), CharArray(0), arrayOf(tv.certificate))
        }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, CharArray(0)) }
        val seenClient = AtomicReference<RSAPublicKey?>()
        val trustAll = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                seenClient.set(chain?.firstOrNull()?.publicKey as? RSAPublicKey)
            }
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, arrayOf(trustAll), null) }
        val server = ctx.serverSocketFactory.createServerSocket(0, 1, InetAddress.getLoopbackAddress()) as SSLServerSocket
        server.needClientAuth = true
        val code = AtomicReference<String>()
        val received = AtomicReference<ByteArray>()
        val t = Thread {
            (server.accept() as SSLSocket).use { s ->
                val ok = AtvRemoteProtocol.pairingOption() // any status-200 message will do as an answer
                repeat(3) {
                    ProtoFrames.read(s.inputStream)
                    ProtoFrames.write(s.outputStream, ok)
                }
                // the TV «shows» a code made from both keys
                val probe = AtvRemoteProtocol.pairingSecret(seenClient.get()!!, tv.publicKey, "00ABCD")
                code.set("%02X".format(probe[0]) + "ABCD")
                val secret = ProtoMessage(ProtoFrames.read(s.inputStream)).message(40)!!.bytes(1)
                received.set(secret)
                ProtoFrames.write(s.outputStream, ok)
            }
        }
        t.start()
        val dialer = SocketTlsDialer { phone.socketFactory() }
        val pairing = GooglePairing({ _, _ -> dialer.dial("127.0.0.1", server.localPort) }, phone.publicKey, "Test")
        pairing.start("127.0.0.1")
        while (code.get() == null) Thread.sleep(10)
        pairing.finish(code.get())
        t.join(5000)
        server.close()
        assertNotNull(seenClient.get())
        assertEquals(phone.publicKey, seenClient.get())
        assertArrayEquals(AtvRemoteProtocol.pairingSecret(phone.publicKey, tv.publicKey, code.get()), received.get())
        assertTrue(received.get().size == 32)
    }

    @Test
    fun aRefusedPortMeansNoService() {
        val s = java.net.ServerSocket(0)
        val port = s.localPort
        s.close()
        try {
            SocketTlsDialer { BoxIdentity.generate().socketFactory() }.dial("127.0.0.1", port)
            throw AssertionError("connected")
        } catch (e: BoxFailure) {
            assertEquals(BoxCodes.NO_SERVICE, e.code)
        }
    }
}
