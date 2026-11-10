package com.spacesarmat.omp.audio

import android.content.Intent
import androidx.media3.datasource.DataSpec
import com.spacesarmat.omp.ApkInstallTracker
import com.spacesarmat.omp.ApkInstaller
import com.spacesarmat.omp.CertPins
import com.spacesarmat.omp.tls.TorrServerTrust
import java.io.File
import java.security.KeyStore
import java.security.Security
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AudioRedirectTest {
    companion object {
        @AfterClass
        @JvmStatic
        fun restoreSecurityProviders() {
            Security.removeProvider("Conscrypt")
        }
    }

    @Test
    fun authorizationIsNotForwardedToAnotherOrigin() {
        val first = MockWebServer()
        val second = MockWebServer()
        first.start()
        second.start()
        try {
            val target = second.url("/audio").toString().replace(second.hostName, "127.0.0.1")
            first.enqueue(MockResponse().setResponseCode(302).setHeader("Location", target))
            second.enqueue(MockResponse().setBody(okio.Buffer().write(ByteArray(16))))
            val source = audioHttpFactory("Bearer test-token").createDataSource()
            val url = first.url("/start").toString().replace(first.hostName, "127.0.0.1")
            val data = ByteArray(16)
            source.open(DataSpec(android.net.Uri.parse(url)))
            source.read(data, 0, data.size)
            assertEquals("Bearer test-token", first.takeRequest().getHeader("Authorization"))
            assertNull(second.takeRequest().getHeader("Authorization"))
        } finally {
            first.shutdown()
            second.shutdown()
        }
    }

    @Test
    fun pinnedHttpsServerCanPlay() {
        val ks = KeyStore.getInstance("PKCS12")
        javaClass.classLoader!!.getResourceAsStream("untrusted-site.p12")!!.use {
            ks.load(it, "testpass".toCharArray())
        }
        val leaf = ks.getCertificate(ks.aliases().nextElement()) as java.security.cert.X509Certificate
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
            init(ks, "testpass".toCharArray())
        }
        val ctx = SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
        val server = MockWebServer()
        server.useHttps(ctx.socketFactory, false)
        server.enqueue(MockResponse().setBody(okio.Buffer().write(ByteArray(16))))
        server.start()
        try {
            TorrServerTrust.trust(server.hostName + ":" + server.port, CertPins.fingerprint(leaf))
            val source = audioHttpFactory(null).createDataSource()
            val data = ByteArray(16)
            source.open(DataSpec(android.net.Uri.parse(server.url("/audio").toString())))
            assertEquals(16, source.read(data, 0, data.size))
        } finally {
            server.shutdown()
            TorrServerTrust.reset()
        }
    }

    @Test
    fun anotherPackageDoesNotDeleteTheDownloadedApk() {
        val context = RuntimeEnvironment.getApplication()
        val apk = File.createTempFile("omp-other", ".apk")
        var completed = 0
        val tracker = ApkInstallTracker(context, apk) { completed++ }
        tracker.onReceive(context, Intent(Intent.ACTION_PACKAGE_ADDED).setData(android.net.Uri.parse("package:example.other")))
        assertTrue(apk.exists())
        assertEquals(0, completed)
        apk.delete()
    }

    @Test
    fun packageAddedDeletesTheDownloadedApk() {
        val context = RuntimeEnvironment.getApplication()
        val apk = File.createTempFile("omp-added", ".apk")
        var completed = 0
        val tracker = ApkInstallTracker(context, apk) { completed++ }
        tracker.onReceive(context, Intent(Intent.ACTION_PACKAGE_ADDED).setData(android.net.Uri.parse("package:" + context.packageName)))
        assertFalse(apk.exists())
        assertEquals(1, completed)
    }

    @Test
    fun watchPackageAcceptsOnly2160Player() {
        assertEquals(setOf("tv.p2160.player"), ApkInstaller.watchPackage("tv.p2160.player"))
        assertEquals(setOf("tv.p2160.player.debug"), ApkInstaller.watchPackage(" tv.p2160.player.debug "))
        assertTrue(ApkInstaller.watchPackage("com.example.other").isEmpty())
        assertTrue(ApkInstaller.watchPackage(null).isEmpty())
    }

    @Test
    fun playerPackageDeletesTheApkAndDoesNotRelaunchOmp() {
        val context = RuntimeEnvironment.getApplication()
        val apk = File.createTempFile("p2160", ".apk")
        var completed = 0
        val tracker = ApkInstallTracker(context, apk, { completed++ }, setOf("tv.p2160.player"))
        tracker.onReceive(context, Intent(Intent.ACTION_PACKAGE_ADDED).setData(android.net.Uri.parse("package:tv.p2160.player")))
        assertFalse(apk.exists())
        assertEquals(1, completed)
        assertNull(shadowOf(context).nextStartedActivity)
        apk.delete()
    }

    @Test
    fun packageReplacedDeletesTheDownloadedApk() {
        val context = RuntimeEnvironment.getApplication()
        val apk = File.createTempFile("omp-replaced", ".apk")
        var completed = 0
        val tracker = ApkInstallTracker(context, apk) { completed++ }
        tracker.onReceive(context, Intent(Intent.ACTION_PACKAGE_REPLACED).setData(android.net.Uri.parse("package:" + context.packageName)))
        assertFalse(apk.exists())
        assertEquals(1, completed)
    }

    @Test
    fun manifestReceiverDeletesTheApkAfterProcessReplacement() {
        val context = RuntimeEnvironment.getApplication()
        val apk = File(context.cacheDir, "updates").apply { mkdirs() }.let { File(it, "omp.apk") }
        apk.writeText("pending")
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android:name=\".ApkInstallTracker\""))
        assertTrue(manifest.contains("android.intent.action.MY_PACKAGE_REPLACED"))
        ApkInstallTracker().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))
        assertFalse(apk.exists())
    }
}
