package com.spacesarmat.omp.box

import java.io.IOException
import java.io.PipedInputStream
import java.io.PipedOutputStream
import java.security.interfaces.RSAPublicKey
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BoxChannelTest {
    private fun waitFor(what: () -> Boolean) {
        val end = System.currentTimeMillis() + 5000
        while (!what()) {
            if (System.currentTimeMillis() > end) throw AssertionError("timed out")
            Thread.sleep(5)
        }
    }

    @Test
    fun adbLinesAndEscaping() {
        assertEquals("input keyevent 19; echo OMP''DONE", AdbKeyLines.keys(listOf(19)))
        assertEquals("input keyevent 19 19 22; echo OMP''DONE", AdbKeyLines.keys(listOf(19, 19, 22)))
        assertEquals("input keyevent --longpress 3; echo OMP''DONE", AdbKeyLines.longPress(3))
        assertEquals("input text 'hello%sworld'; echo OMP''DONE", AdbKeyLines.text("hello world"))
        assertEquals("input text 'it'\\''s;%s\$(rm)'; echo OMP''DONE", AdbKeyLines.text("it's; \$(rm)"))
        // only printable ASCII can be typed by `input text`
        assertEquals("input text 'ok'; echo OMP''DONE", AdbKeyLines.text("окok\n"))
        assertNull(AdbKeyLines.text("привет"))
        assertFalse(AdbKeyLines.valid(0))
        assertFalse(AdbKeyLines.valid(-5))
        // the marker never appears in the echoed command
        assertFalse(AdbKeyLines.keys(listOf(19)).contains(AdbKeyLines.DONE))
    }

    private class FakeShell : AdbShellOpener {
        val lines: MutableList<String> = Collections.synchronizedList(ArrayList())
        var opens = 0
        var failNextWrite = false
        var done: (() -> Unit)? = null
        override fun open(ip: String, done: () -> Unit, closed: () -> Unit): AdbShellPipe {
            opens++
            this.done = done
            return object : AdbShellPipe {
                override fun write(line: String) {
                    if (failNextWrite) {
                        failNextWrite = false
                        throw IOException("broken")
                    }
                    lines.add(line)
                }
                override fun close() {}
            }
        }
    }

    private val quiet = object : BoxListener {
        override fun closed(reason: String) {}
    }

    @Test
    fun adbPressesWhileALineRunsGoTogether() {
        val sh = FakeShell()
        val ch = AdbBoxChannel("10.0.0.2", sh, quiet, lineWaitMs = 5000).start()
        ch.key(19, false)
        waitFor { sh.lines.size == 1 }
        // the first line has not finished: these wait and go in one line
        ch.key(20, false)
        ch.key(20, false)
        ch.key(22, false)
        Thread.sleep(50)
        assertEquals(1, sh.lines.size)
        sh.done!!()
        waitFor { sh.lines.size == 2 }
        assertEquals(AdbKeyLines.keys(listOf(19)), sh.lines[0])
        assertEquals(AdbKeyLines.keys(listOf(20, 20, 22)), sh.lines[1])
        sh.done!!()
        ch.key(3, true)
        waitFor { sh.lines.size == 3 }
        assertEquals(AdbKeyLines.longPress(3), sh.lines[2])
        ch.close()
        assertFalse(ch.alive)
    }

    @Test
    fun adbReopensABrokenShellOnce() {
        val sh = FakeShell()
        val ch = AdbBoxChannel("10.0.0.2", sh, quiet, lineWaitMs = 10).start()
        sh.failNextWrite = true
        ch.key(4, false)
        waitFor { sh.lines.size == 1 }
        assertEquals(2, sh.opens)
        assertTrue(ch.alive)
        ch.close()
    }

    private class PipeLink : TlsLink {
        val toPhone = PipedOutputStream()
        override val input = PipedInputStream(toPhone, 65536)
        val fromPhone = PipedInputStream(65536)
        override val output = PipedOutputStream(fromPhone)
        override val serverKey: RSAPublicKey? = null
        override fun readTimeout(ms: Int) {}
        override fun close() {
            toPhone.close()
            output.close()
        }
    }

    @Test
    fun googleChannelAnswersTheTvAndInjectsKeys() {
        val link = PipeLink()
        val closed = CountDownLatch(1)
        val listener = object : BoxListener {
            override fun closed(reason: String) = closed.countDown()
        }
        // the TV's opening: configure, then set-active
        ProtoFrames.write(link.toPhone, ProtoWriter().message(1, ProtoWriter().int(1, 639)).toByteArray())
        ProtoFrames.write(link.toPhone, ProtoWriter().message(2, ProtoWriter().int(1, 622)).toByteArray())
        val ch = GoogleRemoteChannel.connect({ _, _ -> link }, "10.0.0.3", listener, "SM-G998B", "samsung", "0.19")
        assertTrue(ch.alive)
        val conf = ProtoMessage(ProtoFrames.read(link.fromPhone))
        assertEquals(AtvRemoteProtocol.FEATURES, conf.message(1)!!.int(1))
        val active = ProtoMessage(ProtoFrames.read(link.fromPhone))
        assertEquals(AtvRemoteProtocol.FEATURES, active.message(2)!!.int(1))
        ProtoFrames.write(link.toPhone, ProtoWriter().message(8, ProtoWriter().int(1, 77)).toByteArray())
        assertEquals(77, ProtoMessage(ProtoFrames.read(link.fromPhone)).message(9)!!.int(1))
        ch.key(24, false)
        val key = ProtoMessage(ProtoFrames.read(link.fromPhone)).message(10)!!
        assertEquals(24, key.int(1))
        assertEquals(AtvRemoteProtocol.DIRECTION_SHORT, key.int(2))
        // the TV hangs up: the channel reports it
        link.toPhone.close()
        assertTrue(closed.await(5, TimeUnit.SECONDS))
        assertFalse(ch.alive)
    }

    @Test
    fun googleChannelClosedBeforeAnyMessageNeedsPairing() {
        val link = PipeLink()
        link.toPhone.close()
        try {
            GoogleRemoteChannel.connect({ _, _ -> link }, "10.0.0.3", quiet, "m", "v", "1")
            throw AssertionError("connected")
        } catch (e: BoxFailure) {
            assertEquals(BoxCodes.NEED_PAIRING, e.code)
        }
    }

    @Test
    fun pairingStatusErrorsAreMapped() {
        val link = PipeLink()
        // request ok, then «bad configuration»: the TV declined
        ProtoFrames.write(link.toPhone, ProtoWriter().int(1, 2).int(2, 200).toByteArray())
        ProtoFrames.write(link.toPhone, ProtoWriter().int(1, 2).int(2, 401).toByteArray())
        val key = BoxIdentity.generate().publicKey
        try {
            GooglePairing({ _, _ -> link }, key, "S21").start("10.0.0.3")
            throw AssertionError("paired")
        } catch (e: BoxFailure) {
            assertEquals(BoxCodes.REJECTED, e.code)
        }
    }

    @Test
    fun aMistypedCodeIsRefusedOnThePhone() {
        val tvKey = BoxIdentity.generate().publicKey
        val phoneKey = BoxIdentity.generate().publicKey
        val link = object : TlsLink {
            val toPhone = PipedOutputStream()
            override val input = PipedInputStream(toPhone, 65536)
            override val output = java.io.ByteArrayOutputStream()
            override val serverKey: RSAPublicKey = tvKey
            override fun readTimeout(ms: Int) {}
            override fun close() {}
        }
        repeat(3) { ProtoFrames.write(link.toPhone, ProtoWriter().int(1, 2).int(2, 200).toByteArray()) }
        val p = GooglePairing({ _, _ -> link }, phoneKey, "S21")
        p.start("10.0.0.3")
        val right = AtvRemoteProtocol.pairingSecret(phoneKey, tvKey, "001234")[0].toInt() and 0xFF
        val wrong = "%02X".format((right + 1) and 0xFF) + "1234"
        try {
            p.finish(wrong)
            throw AssertionError("sent")
        } catch (e: BoxFailure) {
            assertEquals(BoxCodes.BAD_CODE, e.code)
        }
        try {
            p.finish("12")
            throw AssertionError("sent")
        } catch (e: BoxFailure) {
            assertEquals(BoxCodes.BAD_CODE, e.code)
        }
    }

    @Test
    fun probeNeedsBothGooglePorts() {
        val open = setOf(6466, 5555)
        val r = BoxRemote(
            { throw AssertionError() }, { throw AssertionError() }, { _, _, _ -> throw AssertionError() },
            BoxRemote.DeviceInfo("n", "m", "v", "1"),
            object : BoxRemote.Events {
                override fun closed(via: String) {}
                override fun volume(level: Int, max: Int, muted: Boolean) {}
            },
        ) { _, port, _ -> port in open }
        assertEquals(BoxProbe(google = false, adb = true), r.probe("10.0.0.4"))
    }
}
