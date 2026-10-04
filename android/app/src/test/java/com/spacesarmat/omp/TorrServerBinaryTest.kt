package com.spacesarmat.omp

import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.FakeHttp
import com.spacesarmat.omp.install.InstallCodes
import com.spacesarmat.omp.install.InstallFailure
import com.spacesarmat.omp.install.sha256
import com.spacesarmat.omp.install.tempDir
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** On-demand TorrServer binary: pin parsing, verified install, executable bit, version marker, ABI and launch rules. */
class TorrServerBinaryTest {
    private val url = "https://github.com/YouROK/TorrServer/releases/download/MatriX.146/TorrServer-android-arm64"
    private val body = ByteArray(300_000) { (it % 251).toByte() }
    private val pin = TorrServerPin("MatriX.146", url, sha256(body), body.size.toLong())

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: InstallFailure) {
            return e.code
        }
        fail("no failure")
        return ""
    }

    @Test
    fun parsesThePinAndRefusesForeignOrBrokenOnes() {
        val json = """{"tag":"MatriX.146","asset":"TorrServer-android-arm64","url":"$url","sha256":"${pin.sha256}","size":${pin.size}}"""
        assertEquals(pin, TorrServerPin.parse(json))
        assertNull(TorrServerPin.parse(json.replace("https://github.com", "http://github.com")))
        assertNull(TorrServerPin.parse(json.replace("https://github.com", "https://evil.example")))
        assertNull(TorrServerPin.parse(json.replace(pin.sha256, "abc")))
        assertNull(TorrServerPin.parse(json.replace("\"size\":${pin.size}", "\"size\":0")))
        assertNull(TorrServerPin.parse(json.replace("MatriX.146\",\"asset", "bad tag\",\"asset")))
        assertNull(TorrServerPin.parse("{"))
    }

    @Test
    fun theCommittedPinParses() {
        val text = listOf(File("src/main/res/raw/torrserver.json"), File("app/src/main/res/raw/torrserver.json")).first { it.isFile }.readText()
        val p = TorrServerPin.parse(text)
        assertNotNull(p)
        assertTrue(p!!.url.endsWith("/" + p.tag + "/TorrServer-android-arm64"))
    }

    @Test
    fun installsVerifiedReadOnlyExecutableWithMarker() {
        val dir = tempDir()
        val bin = TorrServerBinary(dir, pin)
        assertEquals(BinaryState.MISSING, bin.state())
        assertFalse(bin.runnable())
        val http = FakeHttp(mapOf(url to body))
        val percents = ArrayList<Int>()
        var verified = false
        bin.install(http, CancelToken(), { percents.add(it) }, { verified = true })
        assertEquals(listOf(url), http.requested)
        assertEquals(100, percents.last())
        assertTrue(verified)
        assertEquals(BinaryState.READY, bin.state())
        assertTrue(bin.runnable())
        assertTrue(bin.file.isFile)
        assertTrue(bin.file.canExecute())
        assertFalse(bin.file.canWrite())
        assertEquals(sha256(body), sha256(bin.file.readBytes()))
        // nothing left but the binary and its marker
        assertEquals(setOf(TorrServerBinary.NAME, TorrServerBinary.MARKER), dir.list()!!.toSet())
    }

    @Test
    fun aWrongChecksumOrSizeLeavesNothingBehind() {
        val dir = tempDir()
        val bin = TorrServerBinary(dir, pin)
        val bad = body.copyOf().also { it[10] = (it[10] + 1).toByte() }
        assertEquals(InstallCodes.CHECKSUM, code { bin.install(FakeHttp(mapOf(url to bad)), CancelToken(), {}) })
        assertEquals(BinaryState.MISSING, bin.state())
        assertFalse(bin.file.exists())
        val longer = body + byteArrayOf(1)
        assertEquals(InstallCodes.TOO_BIG, code { bin.install(FakeHttp(mapOf(url to longer)), CancelToken(), {}) })
        val shorter = body.copyOf(body.size - 1)
        assertEquals(InstallCodes.CHECKSUM, code { bin.install(FakeHttp(mapOf(url to shorter)), CancelToken(), {}) })
        assertEquals(BinaryState.MISSING, bin.state())
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test
    fun cancellingStopsTheDownload() {
        val dir = tempDir()
        val bin = TorrServerBinary(dir, pin)
        val cancel = CancelToken()
        val http = FakeHttp(mapOf(url to body)).apply { onStream = { cancel.cancel() } }
        assertEquals(InstallCodes.CANCELLED, code { bin.install(http, cancel, {}) })
        assertEquals(BinaryState.MISSING, bin.state())
        assertTrue(dir.list()!!.isEmpty())
    }

    @Test
    fun aChangedPinMakesTheOldBinaryOutdatedAndAnUpdateReplacesIt() {
        val dir = tempDir()
        TorrServerBinary(dir, pin).install(FakeHttp(mapOf(url to body)), CancelToken(), {})
        val newBody = ByteArray(200_000) { (it % 13).toByte() }
        val newUrl = url.replace("MatriX.146", "MatriX.147")
        val newer = TorrServerBinary(dir, TorrServerPin("MatriX.147", newUrl, sha256(newBody), newBody.size.toLong()))
        assertEquals(BinaryState.OUTDATED, newer.state())
        // the old verified binary still runs until the update
        assertTrue(newer.runnable())
        newer.install(FakeHttp(mapOf(newUrl to newBody)), CancelToken(), {})
        assertEquals(BinaryState.READY, newer.state())
        assertEquals(sha256(newBody), sha256(newer.file.readBytes()))
        assertEquals(BinaryState.OUTDATED, TorrServerBinary(dir, pin).state())
    }

    @Test
    fun aMissingOrMismatchedMarkerMeansMissing() {
        val dir = tempDir()
        val bin = TorrServerBinary(dir, pin)
        bin.install(FakeHttp(mapOf(url to body)), CancelToken(), {})
        File(dir, TorrServerBinary.MARKER).writeText("{broken")
        assertEquals(BinaryState.MISSING, bin.state())
        File(dir, TorrServerBinary.MARKER).writeText("""{"tag":"MatriX.146","sha256":"${pin.sha256}","size":5}""")
        assertEquals(BinaryState.MISSING, bin.state())
        File(dir, TorrServerBinary.MARKER).delete()
        assertEquals(BinaryState.MISSING, bin.state())
    }

    @Test
    fun supportedOnlyWithArm64() {
        assertTrue(TorrServerBinary.supported(listOf("arm64-v8a", "armeabi-v7a", "armeabi")))
        // a 32-bit APK on an arm64 phone lists arm64 too
        assertTrue(TorrServerBinary.supported(listOf("armeabi-v7a", "arm64-v8a")))
        assertFalse(TorrServerBinary.supported(listOf("armeabi-v7a", "armeabi")))
        assertFalse(TorrServerBinary.supported(listOf("x86_64", "x86")))
        assertFalse(TorrServerBinary.supported(emptyList()))
    }

    @Test
    fun startsThroughTheSystemLinkerOnAndroid10AndNewer() {
        val args = listOf("--port", "8090")
        assertEquals(listOf("/system/bin/linker64", "/data/ts", "--port", "8090"), TorrServerBinary.command(29, "/data/ts", args))
        assertEquals(listOf("/system/bin/linker64", "/data/ts", "--port", "8090"), TorrServerBinary.command(36, "/data/ts", args))
        assertEquals(listOf("/data/ts", "--port", "8090"), TorrServerBinary.command(28, "/data/ts", args))
        assertEquals(listOf("/data/ts", "--port", "8090"), TorrServerBinary.command(26, "/data/ts", args))
    }

    @Test
    fun downloadErrorsSayWhatToDoNext() {
        assertTrue(TorrServerBinary.downloadError(InstallCodes.NETWORK, 61).contains("Проверьте интернет"))
        assertTrue(TorrServerBinary.downloadError(InstallCodes.CHECKSUM, 61).contains("Повторите загрузку"))
        assertTrue(TorrServerBinary.downloadError(InstallCodes.PHONE_SPACE, 61).contains("61 МБ"))
        assertEquals("Загрузка отменена", TorrServerBinary.downloadError(InstallCodes.CANCELLED, 61))
        assertTrue(TorrServerBinary.downloadError(InstallCodes.UNKNOWN, 61).contains("Повторите"))
    }
}
