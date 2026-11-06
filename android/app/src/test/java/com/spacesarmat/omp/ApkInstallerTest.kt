package com.spacesarmat.omp

import java.io.File
import kotlin.io.path.createTempDirectory
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertThrows
import org.junit.Assert.assertFalse
import org.junit.Test

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
}
