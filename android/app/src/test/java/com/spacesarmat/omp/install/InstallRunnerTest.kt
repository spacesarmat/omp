package com.spacesarmat.omp.install

import java.io.File
import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test

class InstallRunnerTest {
    companion object {
        private lateinit var key: ByteArray

        @BeforeClass
        @JvmStatic
        fun makeKey() {
            key = webosKey("Q7W8E9")
        }
    }

    private val ipk = ByteArray(2000) { 9 }
    private val apkBytes = ByteArray(3000) { 4 }
    private val hbc = ByteArray(700) { 5 }
    private val ipkUrl = "https://github.com/spacesarmat/omp/releases/download/v0.14.0/OMP-0.14.0-webOS.ipk"
    private val apkUrl = "https://github.com/spacesarmat/omp/releases/download/v0.14.0/OMP-0.14.0.apk"
    private val hbcBase = "https://github.com/webosbrew/webos-homebrew-channel/releases/download/v0.7.3/"

    private fun feed(url: String, bytes: ByteArray) =
        """{"version":"0.14.0","ipkUrl":"$url","ipkHash":"${sha256(bytes)}","ipkSize":${bytes.size}}""".toByteArray()

    private fun http(hbcOk: Boolean = true): FakeHttp {
        val api = """{"tag_name":"v0.7.3","assets":[{"name":"org.webosbrew.hbchannel_0.7.3_all.ipk","size":${hbc.size},
            "digest":"sha256:${if (hbcOk) sha256(hbc) else "0".repeat(64)}","browser_download_url":"${hbcBase}hbc.ipk"}]}"""
        return FakeHttp(
            mapOf(
                Releases.FEED_WEBOS to feed(ipkUrl, ipk),
                Releases.FEED_ANDROID to feed(apkUrl, apkBytes),
                ipkUrl to ipk,
                apkUrl to apkBytes,
                Releases.HBC_LATEST to api.toByteArray(),
                "${hbcBase}hbc.ipk" to hbc,
            ),
        )
    }

    private fun code(block: () -> Unit): String {
        try {
            block()
        } catch (e: InstallFailure) {
            return e.code
        }
        fail("no failure")
        return ""
    }

    private class Setup(val runner: InstallRunner, val http: FakeHttp, val shell: FakeShell, val adb: FakeAdb, val adbConnector: FakeAdbConnector, val dir: File)

    private fun setup(http: FakeHttp = http(), adb: FakeAdb = FakeAdb(), keyServer: KeyServer = FakeKeyServer(key), shell: FakeShell = FakeShell()): Setup {
        val dir = tempDir()
        val connector = FakeAdbConnector(adb)
        val runner = InstallRunner(Releases(http) { 1 }, ReleaseDownloader(http, dir), LgDevModeInstaller(keyServer, FakeConnector(shell)), AtvAdbInstaller(connector))
        return Setup(runner, http, shell, adb, connector, dir)
    }

    @Test
    fun lgInstallsOmpAndHomebrewChannel() {
        val s = setup()
        val pass = "q7w8e9".toCharArray()
        val rec = Recorder()
        val out = s.runner.run(InstallRequest(InstallRequest.LG, "192.168.1.5", pass, withHbc = true), rec, CancelToken())
        assertEquals(InstallOutcome("0.14.0", hbcVersion = "0.7.3"), out)
        assertEquals(setOf("/media/developer/temp/omp.ipk", "/media/developer/temp/hbchannel.ipk"), s.shell.uploads.keys)
        assertTrue("passphrase wiped", pass.all { it == '\u0000' })
        assertEquals(0, s.dir.list()!!.size)
        assertEquals("connect:omp", rec.events.first())
        assertTrue(rec.events.contains("verify:omp"))
        assertTrue(rec.events.contains("download:hbc:100"))
        // every request went to GitHub
        assertTrue(s.http.requested.all { ReleaseHosts.allowed(it) })
    }

    @Test
    fun wrongPassphraseStopsBeforeAnyDownload() {
        val s = setup()
        val pass = "nope00".toCharArray()
        assertEquals(InstallCodes.WRONG_PASSPHRASE, code { s.runner.run(InstallRequest(InstallRequest.LG, "192.168.1.5", pass, true), Recorder(), CancelToken()) })
        assertTrue(s.http.requested.isEmpty())
        assertTrue(pass.all { it == '\u0000' })
    }

    @Test
    fun homebrewChannelChecksumFailureStillInstallsOmp() {
        val s = setup(http = http(hbcOk = false))
        val out = s.runner.run(InstallRequest(InstallRequest.LG, "192.168.1.5", "Q7W8E9".toCharArray(), true), Recorder(), CancelToken())
        assertEquals("0.14.0", out.version)
        assertNull(out.hbcVersion)
        assertEquals(InstallCodes.CHECKSUM, out.hbcError)
        assertEquals(setOf("/media/developer/temp/omp.ipk"), s.shell.uploads.keys)
        assertEquals(0, s.dir.list()!!.size)
    }

    @Test
    fun lgWithoutHomebrewChannel() {
        val s = setup()
        val out = s.runner.run(InstallRequest(InstallRequest.LG, "192.168.1.5", "Q7W8E9".toCharArray(), false), Recorder(), CancelToken())
        assertEquals(InstallOutcome("0.14.0"), out)
        assertTrue(s.http.requested.none { it.contains("webosbrew") })
    }

    @Test
    fun atvConnectsBeforeDownloading() {
        val s = setup()
        val rec = Recorder()
        val out = s.runner.run(InstallRequest(InstallRequest.ATV, "192.168.1.9", null, false), rec, CancelToken())
        assertEquals(InstallOutcome("0.14.0", sdkInt = 29, abi = "arm64-v8a"), out)
        assertEquals("connect:omp", rec.events.first())
        assertEquals(apkBytes.size, s.adb.installed!!.size)
        assertTrue(s.adb.closed)
        assertEquals(0, s.dir.list()!!.size)
    }

    @Test
    fun atvUnauthorizedDownloadsNothing() {
        val s = setup(adb = FakeAdb(shellError = SocketTimeoutException()))
        assertEquals(InstallCodes.UNAUTHORIZED, code { s.runner.run(InstallRequest(InstallRequest.ATV, "192.168.1.9", null, false), Recorder(), CancelToken()) })
        assertTrue(s.http.requested.isEmpty())
    }

    @Test
    fun cancelledDownloadLeavesNothing() {
        val cancel = CancelToken()
        val h = http()
        h.onStream = { cancel.cancel() }
        val s = setup(http = h)
        assertEquals(InstallCodes.CANCELLED, code { s.runner.run(InstallRequest(InstallRequest.ATV, "192.168.1.9", null, false), Recorder(), cancel) })
        assertEquals(0, s.dir.list()!!.size)
        assertTrue(s.adb.closed)
    }

    @Test
    fun unknownMethod() {
        assertEquals(InstallCodes.BAD_TARGET, code { setup().runner.run(InstallRequest("ftp", "192.168.1.9", null, false), Recorder(), CancelToken()) })
    }

    @Test
    fun genericErrorsAreMapped() {
        assertEquals(InstallCodes.TIMEOUT, failureOf(SocketTimeoutException()).code)
        assertEquals(InstallCodes.UNKNOWN, failureOf(IllegalStateException()).code)
        assertEquals(InstallCodes.CANCELLED, failureOf(IllegalStateException(), CancelToken().apply { cancel() }).code)
    }

    @Test
    fun reminderTimeWindow() {
        val now = 1_000_000_000_000L
        val hour = 3_600_000L
        assertTrue(DevModeReminder.validAt(now + 928 * hour, now))
        assertTrue(!DevModeReminder.validAt(now + 10_000, now))
        assertTrue(!DevModeReminder.validAt(now + 1001 * hour, now))
    }
}
