package com.spacesarmat.omp

import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.FakeHttp
import com.spacesarmat.omp.install.InstallCodes
import com.spacesarmat.omp.install.InstallFailure
import com.spacesarmat.omp.install.ReleaseHttp
import com.spacesarmat.omp.install.sha256
import com.spacesarmat.omp.install.tempDir
import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
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
        // only the exact YouROK/TorrServer asset of the pinned tag
        assertNull(TorrServerPin.parse(json.replace("YouROK/TorrServer", "someone/TorrServer")))
        assertNull(TorrServerPin.parse(json.replace("https://github.com/", "https://raw.githubusercontent.com/")))
        assertNull(TorrServerPin.parse(json.replace("download/MatriX.146/", "download/MatriX.140/")))
        assertNull(TorrServerPin.parse(json.replace("TorrServer-android-arm64\"", "TorrServer-android-arm7\"")))
        assertNull(TorrServerPin.parse(json.replace(pin.sha256, "abc")))
        assertNull(TorrServerPin.parse(json.replace("\"size\":${pin.size}", "\"size\":0")))
        assertNull(TorrServerPin.parse(json.replace("MatriX.146\",\"asset", "bad tag\",\"asset")))
        assertNull(TorrServerPin.parse("{"))
    }

    @Test
    fun downloadHopsAreThePinnedUrlAndTheAssetCdnOnly() {
        assertTrue(pin.hopAllowed(url))
        assertTrue(pin.hopAllowed("https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sig=y"))
        assertTrue(pin.hopAllowed("https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/x"))
        assertFalse(pin.hopAllowed("http://release-assets.githubusercontent.com/x"))
        assertFalse(pin.hopAllowed("https://release-assets.githubusercontent.com:8443/x"))
        assertFalse(pin.hopAllowed("https://github.com/YouROK/TorrServer/releases/download/MatriX.146/TorrServer-linux-arm64"))
        assertFalse(pin.hopAllowed("https://raw.githubusercontent.com/YouROK/TorrServer/master/x"))
        assertFalse(pin.hopAllowed("https://evil.example/x"))
    }

    /** The first 1 KB of the real pinned TorrServer-android-arm64 (MatriX.145.1): ELF header and program headers. */
    private fun realHead(): ByteArray = javaClass.classLoader!!.getResourceAsStream("torrserver-arm64-elf-head.bin")!!.use { it.readBytes() }

    @Test
    fun theRealBinaryIsABionicPieWith16KbSegments() {
        val elf = ElfInfo.parse(realHead())!!
        assertEquals(ElfInfo.EM_AARCH64, elf.machine)
        assertEquals("/system/bin/linker64", elf.interp)
        assertEquals(0x4000L, elf.loadAlign)
        assertTrue(elf.fits(4096))
        assertTrue(elf.fits(16384))
        assertFalse(elf.fits(65536))
    }

    @Test
    fun foreignOr4KbAlignedBinariesDoNotFit() {
        val head = realHead()
        // patch every PT_LOAD p_align (phdrs at 0x40, 56 bytes each, 10 of them) to 4 KB
        val bb = java.nio.ByteBuffer.wrap(head).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until 10) {
            val o = 0x40 + i * 56
            if (bb.getInt(o) == 1) bb.putLong(o + 48, 0x1000L)
        }
        val elf = ElfInfo.parse(head)!!
        assertEquals(0x1000L, elf.loadAlign)
        assertTrue(elf.fits(4096))
        assertFalse(elf.fits(16384))
        val x86 = realHead().also { java.nio.ByteBuffer.wrap(it).order(java.nio.ByteOrder.LITTLE_ENDIAN).putShort(18, 62) }
        assertFalse(ElfInfo.parse(x86)!!.fits(4096))
        assertNull(ElfInfo.parse(ByteArray(100)))
        assertNull(ElfInfo.parse(realHead().copyOf(200)))
        val f = File(tempDir(), "bin").apply { writeBytes(realHead()) }
        assertEquals(0x4000L, ElfInfo.read(f)!!.loadAlign)
        assertNull(ElfInfo.read(File(tempDir(), "none")))
    }

    @Test
    fun twoQuickExitsMeanTheServerCannotRunHere() {
        assertEquals(TorrServerBinary.CANNOT_RUN, TorrServerBinary.exitMessage(quick = true, quickBefore = true, crashed = "crash"))
        assertEquals("crash", TorrServerBinary.exitMessage(quick = true, quickBefore = false, crashed = "crash"))
        assertEquals("crash", TorrServerBinary.exitMessage(quick = false, quickBefore = true, crashed = "crash"))
        assertTrue(TorrServerBinary.CANNOT_RUN.contains("используйте TorrServer на компьютере или NAS"))
    }

    /** Serves [body] with Range support; the first [breakAfter] bytes of the first request, then a broken stream. */
    private class RangeHttp(private val body: ByteArray, private var breakAfter: Int?) : ReleaseHttp {
        val offsets = ArrayList<Long>()
        override fun text(url: String, maxBytes: Int, cancel: CancelToken) = throw UnsupportedOperationException()
        override fun stream(url: String, cancel: CancelToken, read: (InputStream, Long) -> Unit) =
            streamFrom(url, 0L, cancel) { i, l, _ -> read(i, l) }

        override fun streamFrom(url: String, offset: Long, cancel: CancelToken, read: (InputStream, Long, Long) -> Unit) {
            offsets.add(offset)
            val rest = body.copyOfRange(offset.toInt(), body.size)
            val cut = breakAfter
            breakAfter = null
            val input: InputStream = if (cut == null) ByteArrayInputStream(rest) else object : InputStream() {
                var pos = 0
                override fun read(): Int {
                    if (pos >= cut) throw java.io.IOException("connection reset")
                    return rest[pos++].toInt() and 0xff
                }
            }
            read(input, rest.size.toLong(), offset)
        }
    }

    @Test
    fun aBrokenDownloadResumesFromTheKeptPartAndIsVerifiedWhole() {
        val dir = tempDir()
        val bin = TorrServerBinary(dir, pin)
        val http = RangeHttp(body, breakAfter = 120_000)
        assertEquals(InstallCodes.NETWORK, code { bin.install(http, CancelToken(), {}) })
        assertEquals(BinaryState.MISSING, bin.state())
        val parts = File(dir, "download").listFiles()!!
        assertEquals(1, parts.size)
        assertEquals(120_000L, parts[0].length())
        val percents = ArrayList<Int>()
        bin.install(http, CancelToken(), { percents.add(it) })
        assertEquals(listOf(0L, 120_000L), http.offsets)
        assertEquals(40, percents.first())
        assertEquals(BinaryState.READY, bin.state())
        assertEquals(sha256(body), sha256(bin.file.readBytes()))
        assertFalse(File(dir, "download").exists())
    }

    @Test
    fun aCorruptKeptPartFailsTheChecksumAndIsDropped() {
        val dir = tempDir()
        val bin = TorrServerBinary(dir, pin)
        val http = RangeHttp(body, breakAfter = 50_000)
        assertEquals(InstallCodes.NETWORK, code { bin.install(http, CancelToken(), {}) })
        val part = File(dir, "download").listFiles()!!.single()
        part.writeBytes(ByteArray(50_000))
        assertEquals(InstallCodes.CHECKSUM, code { bin.install(http, CancelToken(), {}) })
        assertFalse(File(dir, "download").exists())
        // the next try starts from zero and succeeds
        bin.install(http, CancelToken(), {})
        assertEquals(listOf(0L, 50_000L, 0L), http.offsets)
        assertEquals(BinaryState.READY, bin.state())
    }

    @Test
    fun aPartOfAnotherPinIsNotResumed() {
        val dir = tempDir()
        File(dir, "download").mkdirs()
        File(dir, "download/torrserver-0000000000000000.part").writeBytes(ByteArray(1000))
        val http = RangeHttp(body, breakAfter = null)
        TorrServerBinary(dir, pin).install(http, CancelToken(), {})
        assertEquals(listOf(0L), http.offsets)
        assertFalse(File(dir, "download").exists())
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
