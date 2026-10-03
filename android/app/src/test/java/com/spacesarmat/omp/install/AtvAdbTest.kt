package com.spacesarmat.omp.install

import dadb.AdbAuthException
import dadb.AdbConnectException
import java.io.File
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AtvAdbTest {
    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: InstallFailure) {
            return e.code
        }
        fail("no failure")
        return ""
    }

    private fun apk(bytes: ByteArray = ByteArray(4000) { 3 }): TvPackage {
        val f = File(tempDir(), "omp.apk").apply { writeBytes(bytes) }
        return TvPackage(ReleasePackage(Item.OMP, "omp.apk", "0.14.0", "https://github.com/x/omp.apk", sha256(bytes), bytes.size.toLong()), f)
    }

    @Test
    fun connectReadsAndroidVersionAndAbi() {
        val dev = FakeAdb()
        val rec = Recorder()
        val (device, info) = AtvAdbInstaller(FakeAdbConnector(dev)).connect("192.168.1.9", rec, CancelToken())
        assertEquals(dev, device)
        assertEquals(AtvInfo(29, "arm64-v8a"), info)
        assertEquals(listOf("connect:omp"), rec.events)
    }

    @Test
    fun oddPropsAreDropped() {
        val dev = FakeAdb(props = mapOf("ro.build.version.sdk" to "x", "ro.product.cpu.abi" to "arm64; rm -rf"))
        val (_, info) = AtvAdbInstaller(FakeAdbConnector(dev)).connect("192.168.1.9", Recorder(), CancelToken())
        assertEquals(AtvInfo(null, null), info)
    }

    @Test
    fun installStreamsTheApkWithProgress() {
        val dev = FakeAdb()
        val rec = Recorder()
        val p = apk()
        AtvAdbInstaller(FakeAdbConnector(dev)).install(dev, p, rec, CancelToken())
        assertArrayEquals(p.file.readBytes(), dev.installed)
        assertEquals("upload:omp:0", rec.events.first())
        assertTrue(rec.events.contains("upload:omp:100"))
        assertEquals("install:omp", rec.events.last())
    }

    @Test
    fun packageManagerFailuresMapToCodes() {
        fun fails(text: String) = code { AtvAdbInstaller(FakeAdbConnector(FakeAdb())).install(FakeAdb(installResult = text), apk(), Recorder(), CancelToken()) }
        assertEquals(InstallCodes.LOW_SPACE, fails("Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]"))
        assertEquals(InstallCodes.SIGNATURE, fails("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package com.spacesarmat.omp signatures do not match]"))
        assertEquals(InstallCodes.ABI, fails("Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries, res=-113]"))
        assertEquals(InstallCodes.OLD_ANDROID, fails("Failure [INSTALL_FAILED_OLDER_SDK]"))
        assertEquals(InstallCodes.INSTALL_FAILED, fails("Failure [INSTALL_PARSE_FAILED_NOT_APK]"))
    }

    @Test
    fun connectErrorsMapToCodes() {
        fun connecting(e: Exception) = code {
            AtvAdbInstaller(FakeAdbConnector(FakeAdb(shellError = e))).connect("10.0.0.3", Recorder(), CancelToken())
        }
        assertEquals(InstallCodes.ADB_CLOSED, connecting(ConnectException("Connection refused")))
        assertEquals(InstallCodes.ADB_CLOSED, connecting(AdbConnectException("Connection handshake failed", ConnectException("refused"))))
        assertEquals(InstallCodes.UNAUTHORIZED, connecting(AdbAuthException("Device rejected authentication (unauthorized)", null)))
        assertEquals(InstallCodes.UNAUTHORIZED, connecting(AdbConnectException("Connection handshake failed", SocketTimeoutException("Read timed out"))))
        assertEquals(InstallCodes.UNAUTHORIZED, connecting(IOException("closed")))
    }

    @Test
    fun laterErrorsAreTimeoutsOrConnection() {
        assertEquals(InstallCodes.TIMEOUT, AtvAdbInstaller.adbFailure(SocketTimeoutException(), null, connecting = false).code)
        assertEquals(InstallCodes.CONNECTION, AtvAdbInstaller.adbFailure(IOException("Broken pipe"), null, connecting = false).code)
        val cancel = CancelToken().apply { cancel() }
        assertEquals(InstallCodes.CANCELLED, AtvAdbInstaller.adbFailure(IOException("Socket closed"), cancel, connecting = false).code)
    }

    @Test
    fun aFailedConnectClosesTheDevice() {
        val dev = FakeAdb(shellError = SocketTimeoutException())
        code { AtvAdbInstaller(FakeAdbConnector(dev)).connect("10.0.0.3", Recorder(), CancelToken()) }
        assertTrue(dev.closed)
    }
}
