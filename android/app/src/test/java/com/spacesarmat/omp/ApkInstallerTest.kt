package com.spacesarmat.omp

import android.content.Intent
import java.io.File
import kotlin.io.path.createTempDirectory
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ApkInstallerTest {
    @Test
    fun oversizedDownloadIsRefusedAndRemoved() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("abc"))
        server.start()
        val dir = createTempDirectory("omp-apk-test").toFile()
        try {
            val url = server.url("/").toString().replace(server.hostName, "127.0.0.1")
            val sha = "0".repeat(64)
            assertThrows(UserError::class.java) {
                ApkInstaller.downloadToDir(dir, url, sha, 2) {}
            }
            assertFalse(File(dir, "omp.apk.part").exists())
            assertFalse(File(dir, "omp.apk").exists())
        } finally {
            server.shutdown()
            dir.deleteRecursively()
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
        assertTrue(manifest.contains("android.intent.action.MY_PACKAGE_REPLACED") )
        ApkInstallTracker(context).onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED).setData(android.net.Uri.parse("package:" + context.packageName)))
        assertFalse(apk.exists())
    }
}
