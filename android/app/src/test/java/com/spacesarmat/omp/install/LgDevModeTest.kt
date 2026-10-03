package com.spacesarmat.omp.install

import com.jcraft.jsch.JSchException
import java.io.File
import java.net.ConnectException
import java.net.SocketTimeoutException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.BeforeClass
import org.junit.Test

class LgDevModeTest {
    companion object {
        private lateinit var key: ByteArray

        @BeforeClass
        @JvmStatic
        fun makeKey() {
            key = webosKey("A1B2C3")
        }
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

    private fun pkg(item: Item, name: String, bytes: ByteArray): TvPackage {
        val f = File(tempDir(), name).apply { writeBytes(bytes) }
        return TvPackage(ReleasePackage(item, name, "1.0", "https://github.com/x/$name", sha256(bytes), bytes.size.toLong()), f)
    }

    @Test
    fun theKeyIsAnEncryptedPem() {
        val text = String(key)
        assertTrue(text.contains("DEK-Info: AES-128-CBC,"))
        assertTrue(DevModeKey.isKey(key))
        assertFalse(DevModeKey.opens(key, "WRONG1".toByteArray()))
        assertTrue(DevModeKey.opens(key, "A1B2C3".toByteArray()))
    }

    @Test
    fun unlockAcceptsTheTypedOrUpperCasedPassphrase() {
        DevModeKey.unlock(key.copyOf(), " A1B2C3 ".toCharArray()).use { assertEquals("A1B2C3", String(it.passphrase)) }
        DevModeKey.unlock(key.copyOf(), "a1b2c3".toCharArray()).use { assertEquals("A1B2C3", String(it.passphrase)) }
    }

    @Test
    fun wrongPassphraseAndNonKeys() {
        assertEquals(InstallCodes.WRONG_PASSPHRASE, code { DevModeKey.unlock(key.copyOf(), "ZZZZZZ".toCharArray()) })
        assertEquals(InstallCodes.WRONG_PASSPHRASE, code { DevModeKey.unlock(key.copyOf(), "   ".toCharArray()) })
        assertEquals(InstallCodes.KEY_SERVER, code { DevModeKey.unlock("<html>Not found</html>".toByteArray(), "A1B2C3".toCharArray()) })
    }

    @Test
    fun credentialsAreWipedOnClose() {
        val c = DevModeKey.unlock(key.copyOf(), "A1B2C3".toCharArray())
        c.close()
        assertTrue(c.key.all { it == 0.toByte() })
        assertTrue(c.passphrase.all { it == 0.toByte() })
    }

    @Test
    fun lunaOutputParser() {
        assertEquals(LunaState.Pending, LunaInstall.parse("""{"returnValue":true,"ticket":"1","subscribed":true}"""))
        assertEquals(LunaState.Pending, LunaInstall.parse("""{"ticket":"1","statusValue":21,"details":{"progress":40,"state":"installing"}}"""))
        assertEquals(LunaState.Installed, LunaInstall.parse("""{"ticket":"1","statusValue":30,"details":{"packageId":"x","state":"installed"}}"""))
        assertEquals(
            LunaState.Failed("Package is invalid", false),
            LunaInstall.parse("""{"statusValue":31,"details":{"errorCode":-1,"reason":"Package is invalid","state":"install failed"}}"""),
        )
        assertEquals(LunaState.Failed("no space left on device", true), LunaInstall.parse("""{"details":{"state":"failed","reason":"no space left on device"}}"""))
        assertEquals(LunaState.Failed("-5", false), LunaInstall.parse("""{"details":{"state":"FAILED","errorCode":-5}}"""))
        assertEquals(LunaState.Failed("Denied method call", false), LunaInstall.parse("""{"returnValue":false,"errorText":"Denied method call"}"""))
        assertEquals(LunaState.Pending, LunaInstall.parse("** Message: serviceResponse Handling"))
        assertEquals(LunaState.Pending, LunaInstall.parse("{broken"))
    }

    @Test
    fun lunaCommandUsesTheDevInstallService() {
        assertEquals(
            "/usr/bin/luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' " +
                "'{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"/media/developer/temp/omp.ipk\",\"subscribe\":true}'",
            LunaInstall.command("/media/developer/temp/omp.ipk"),
        )
    }

    @Test
    fun installsOmpThenHomebrewChannelAndCleansUp() {
        val shell = FakeShell()
        val connector = FakeConnector(shell)
        val inst = LgDevModeInstaller(FakeKeyServer(key), connector)
        val omp = pkg(Item.OMP, "omp.ipk", ByteArray(1000) { 1 })
        val hbc = pkg(Item.HBC, "hbchannel.ipk", ByteArray(500) { 2 })
        val rec = Recorder()
        val creds = inst.unlock("192.168.1.5", "a1b2c3".toCharArray(), CancelToken())
        val failed = inst.install("192.168.1.5", creds, listOf(omp, hbc), rec, CancelToken())
        assertTrue(failed.isEmpty())
        assertEquals("A1B2C3", connector.passphrase)
        assertEquals(
            listOf(
                "mkdir -p /media/developer/temp",
                "cat > '/media/developer/temp/omp.ipk'",
                LunaInstall.command("/media/developer/temp/omp.ipk"),
                "rm -f '/media/developer/temp/omp.ipk'",
                "cat > '/media/developer/temp/hbchannel.ipk'",
                LunaInstall.command("/media/developer/temp/hbchannel.ipk"),
                "rm -f '/media/developer/temp/hbchannel.ipk'",
            ),
            shell.commands,
        )
        assertArrayEquals(omp.file.readBytes(), shell.uploads["/media/developer/temp/omp.ipk"])
        assertArrayEquals(hbc.file.readBytes(), shell.uploads["/media/developer/temp/hbchannel.ipk"])
        assertTrue(shell.closed)
        assertEquals("connect:omp", rec.events.first())
        assertTrue(rec.events.contains("upload:omp:100"))
        assertTrue(rec.events.contains("install:omp"))
        assertTrue(rec.events.contains("install:hbc"))
        creds.close()
    }

    @Test
    fun ompFailureFailsAndStillRemovesTheTempFile() {
        val shell = FakeShell(luna = { listOf("""{"details":{"state":"install failed","reason":"bad"}}""") })
        val inst = LgDevModeInstaller(FakeKeyServer(key), FakeConnector(shell))
        val omp = pkg(Item.OMP, "omp.ipk", ByteArray(10))
        val creds = DevModeKey.unlock(key.copyOf(), "A1B2C3".toCharArray())
        assertEquals(InstallCodes.INSTALL_FAILED, code { inst.install("10.0.0.2", creds, listOf(omp), Recorder(), CancelToken()) })
        assertEquals("rm -f '/media/developer/temp/omp.ipk'", shell.commands.last())
        assertTrue(shell.closed)
    }

    @Test
    fun homebrewChannelFailureIsReportedNotThrown() {
        val shell = FakeShell(luna = { path ->
            if (path.endsWith("hbchannel.ipk")) listOf("""{"returnValue":false,"errorText":"x"}""") else listOf("""{"details":{"state":"installed"}}""")
        })
        val inst = LgDevModeInstaller(FakeKeyServer(key), FakeConnector(shell))
        val creds = DevModeKey.unlock(key.copyOf(), "A1B2C3".toCharArray())
        val failed = inst.install("10.0.0.2", creds, listOf(pkg(Item.OMP, "omp.ipk", ByteArray(3)), pkg(Item.HBC, "hbchannel.ipk", ByteArray(3))), Recorder(), CancelToken())
        assertEquals(mapOf(Item.HBC to InstallCodes.INSTALL_FAILED), failed)
    }

    @Test
    fun lowSpaceFromUploadOrInstall() {
        val full = FakeShell(catExit = 1, catStderr = "cat: write error: No space left on device")
        val creds = DevModeKey.unlock(key.copyOf(), "A1B2C3".toCharArray())
        assertEquals(
            InstallCodes.LOW_SPACE,
            code { LgDevModeInstaller(FakeKeyServer(key), FakeConnector(full)).install("10.0.0.2", creds, listOf(pkg(Item.OMP, "omp.ipk", ByteArray(3))), Recorder(), CancelToken()) },
        )
        val lunaFull = FakeShell(luna = { listOf("""{"details":{"state":"install failed","reason":"Not enough space"}}""") })
        assertEquals(
            InstallCodes.LOW_SPACE,
            code { LgDevModeInstaller(FakeKeyServer(key), FakeConnector(lunaFull)).install("10.0.0.2", creds, listOf(pkg(Item.OMP, "omp.ipk", ByteArray(3))), Recorder(), CancelToken()) },
        )
    }

    @Test
    fun noResultFromTheInstallServiceIsAFailure() {
        val shell = FakeShell(luna = { listOf("""{"returnValue":true,"subscribed":true}""") })
        val creds = DevModeKey.unlock(key.copyOf(), "A1B2C3".toCharArray())
        assertEquals(
            InstallCodes.INSTALL_FAILED,
            code { LgDevModeInstaller(FakeKeyServer(key), FakeConnector(shell)).install("10.0.0.2", creds, listOf(pkg(Item.OMP, "omp.ipk", ByteArray(3))), Recorder(), CancelToken()) },
        )
    }

    @Test
    fun cancelDuringInstallStillRemovesTheFile() {
        val cancel = CancelToken()
        val shell = FakeShell()
        shell.onCommand = { if (it.startsWith("/usr/bin/luna-send-pub")) cancel.cancel() }
        val creds = DevModeKey.unlock(key.copyOf(), "A1B2C3".toCharArray())
        assertEquals(
            InstallCodes.CANCELLED,
            code { LgDevModeInstaller(FakeKeyServer(key), FakeConnector(shell)).install("10.0.0.2", creds, listOf(pkg(Item.OMP, "omp.ipk", ByteArray(3)), pkg(Item.HBC, "hbchannel.ipk", ByteArray(3))), Recorder(), cancel) },
        )
        assertEquals("rm -f '/media/developer/temp/omp.ipk'", shell.commands.last())
        assertFalse(shell.commands.any { it.contains("hbchannel") })
    }

    @Test
    fun keyServerErrorsComeFromTheFetch() {
        val inst = LgDevModeInstaller(FakeKeyServer(null), FakeConnector(FakeShell()))
        assertEquals(InstallCodes.KEY_SERVER, code { inst.unlock("10.0.0.2", "A1B2C3".toCharArray(), CancelToken()) })
    }

    @Test
    fun sshErrorsMapToCodes() {
        assertEquals(InstallCodes.SSH_CLOSED, sshFailure(JSchException("session is down", ConnectException("Connection refused"))).code)
        assertEquals(InstallCodes.SSH_AUTH, sshFailure(JSchException("Auth fail for methods 'publickey'")).code)
        assertEquals(InstallCodes.TIMEOUT, sshFailure(JSchException("timeout: socket is not established", SocketTimeoutException())).code)
        assertEquals(InstallCodes.TIMEOUT, sshFailure(JSchException("timeout: socket is not established")).code)
        assertEquals(InstallCodes.CONNECTION, sshFailure(JSchException("Algorithm negotiation fail")).code)
    }

    @Test
    fun countingStreamReportsPercent() {
        val got = ArrayList<Int>()
        CountingInputStream(ByteArray(200).inputStream(), 200) { got.add(it) }.use { s ->
            val buf = ByteArray(50)
            while (s.read(buf) >= 0) Unit
        }
        assertEquals(listOf(25, 50, 75, 100), got)
    }
}
