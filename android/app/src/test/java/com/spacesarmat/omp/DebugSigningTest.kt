package com.spacesarmat.omp

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyStore
import java.security.cert.X509Certificate

/** The committed debug certificate is the shared one Gradle signs debug APKs with. No device. */
class DebugSigningTest {
    @Test
    fun debugBuildsUseTheCommittedAndroidDebugKeystore() {
        val keystore = listOf(File("../debug.keystore"), File("android/debug.keystore"))
            .firstOrNull { it.isFile }
            ?: error("android/debug.keystore not found from ${File(".").absolutePath}")
        val store = KeyStore.getInstance("JKS")
        store.load(keystore.inputStream(), "android".toCharArray())
        assertNotNull(store.getKey("androiddebugkey", "android".toCharArray()))
        val cert = store.getCertificate("androiddebugkey") as X509Certificate
        assertTrue(cert.subjectX500Principal.name, cert.subjectX500Principal.name.contains("CN=Android Debug"))

        val gradle = listOf(File("build.gradle"), File("android/app/build.gradle"))
            .firstOrNull { it.isFile }
            ?: error("app/build.gradle not found")
        val text = gradle.readText()
        assertTrue(text.contains("storeFile rootProject.file(\"debug.keystore\")"))
        assertTrue(text.contains("keyAlias \"androiddebugkey\""))
        assertTrue(text.contains("signingConfig signingConfigs.debug"))
    }
}
