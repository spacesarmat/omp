package com.spacesarmat.omp.audio

import androidx.media3.common.Player
import com.spacesarmat.omp.I18n
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Queue parsing, session contract and the manifest entry. No device and no ExoPlayer. */
class AudioPlayerTest {
    @Test
    fun sessionIsSeparateFromPlayerCore() {
        assertEquals("omp-audiobook", AudioSession.ID)
        assertEquals("omp-audiobook", AudioSession.CHANNEL_ID)
        assertEquals(8091, AudioSession.NOTIFICATION_ID)
        assertFalse(AudioSession.SERVICE == AudioSession.PLAYER_CORE_SERVICE)
        assertEquals(30_000L, AudioSession.SEEK_MS)
    }

    @Test
    fun notificationIsSeekChaptersAndStopWithoutASecondPlayButton() {
        assertEquals(
            listOf(
                Player.COMMAND_SEEK_BACK,
                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                Player.COMMAND_SEEK_FORWARD,
                Player.COMMAND_STOP,
            ),
            AudioSession.notificationCommands,
        )
        assertFalse(AudioSession.notificationCommands.contains(Player.COMMAND_PLAY_PAUSE))
    }

    @Test
    fun speedStaysInsideHalfToThreeAndSleepIsOneOfTheChoices() {
        assertEquals(0.5f, AudioSession.clampSpeed(0.1f))
        assertEquals(3f, AudioSession.clampSpeed(4f))
        assertEquals(1.5f, AudioSession.clampSpeed(1.5f))
        assertEquals(1f, AudioSession.clampSpeed(Float.NaN))
        assertEquals(AudioSession.SLEEP_OFF, AudioSession.normalizeSleep("nope"))
        assertEquals(AudioSession.SLEEP_CHAPTER, AudioSession.normalizeSleep("chapter"))
        assertEquals(15 * 60_000L, AudioSession.sleepDeadline("15", 1_000L)!! - 1_000L)
        assertEquals(30 * 60_000L, AudioSession.sleepDeadline("30", 0L))
        assertEquals(60 * 60_000L, AudioSession.sleepDeadline("60", 0L))
        assertNull(AudioSession.sleepDeadline("off", 0L))
        assertNull(AudioSession.sleepDeadline("chapter", 0L))
        assertTrue(AudioSession.sleepIsChapter("chapter"))
        assertFalse(AudioSession.sleepIsChapter("30"))
    }

    @Test
    fun chapterOffsetIsRelativeToTheClip() {
        val chapter = AudioItem("http://127.0.0.1:8090/a.m4b", "Глава 2", 3, 90_000, 200_000)
        assertEquals(0L, AudioSession.startOffset(chapter, 90_000))
        assertEquals(5_000L, AudioSession.startOffset(chapter, 95_000))
        assertEquals(0L, AudioSession.startOffset(chapter, 1_000))
    }

    @Test
    fun credentialsLeaveTheUrlAndLocalTorrServerIsRecognized() {
        val raw = "http://u:p%40ss@127.0.0.1:8090/stream/a.mp3?link=h&index=1&play"
        val (url, header) = AudioQueueParser.splitCredentials(raw)
        assertEquals("http://127.0.0.1:8090/stream/a.mp3?link=h&index=1&play", url)
        assertEquals("Basic dTpwQHNz", header)
        assertTrue(AudioQueueParser.targetsLocalTorrServer(raw))
        assertTrue(AudioQueueParser.targetsLocalTorrServer("http://localhost:8090/stream/a"))
        assertFalse(AudioQueueParser.targetsLocalTorrServer("http://127.0.0.1:8091/stream/a"))
        assertFalse(AudioQueueParser.targetsLocalTorrServer("http://10.0.0.2:8090/stream/a"))
        assertFalse(AudioQueueParser.targetsLocalTorrServer("https://books.example/a.mp3"))
    }

    @Test
    fun queueKeepsListeningOrderClipsAndDropsAPublicCleartextUrl() {
        val items = JSONArray()
            .put(item("http://127.0.0.1:8090/stream/10.mp3?index=4", "10", 4, 0, 0))
            .put(item("http://127.0.0.1:8090/stream/2.mp3?index=2", "2", 2, 0, 0))
        val q = AudioQueueParser.parse("Мастер", "ab", 1, 12_000, items)!!
        assertEquals(1, q.start)
        assertEquals(12_000L, q.positionMs)
        assertEquals("2", q.items[1].title)
        assertEquals(2, q.items[1].fileId)

        val chapters = JSONArray().put(item("http://127.0.0.1:8090/book.m4b?index=3", "Глава", 3, 90_000, 200_000))
        val ch = AudioQueueParser.parse("Книга", "h", 0, 90_000, chapters)!!
        assertEquals(90_000L, ch.items[0].startMs)
        assertEquals(200_000L, ch.items[0].endMs)

        val open = JSONArray().put(item("http://203.0.113.5/stream/a.mp3", "x", 1, 0, 0))
        assertNull(AudioQueueParser.parse("Книга", "h", 0, 0, open))
        assertNull(AudioQueueParser.parse("Книга", "h", 0, 0, JSONArray()))
        assertNull(AudioQueueParser.command("jump", null, null, null))
        assertEquals("seek", AudioQueueParser.command("seek", 30_000.0, null, null)!!.name)
        assertEquals(30_000L, AudioQueueParser.command("seek", 30_000.0, null, null)!!.ms)
    }

    @Test
    fun manifestDeclaresANonExportedMediaPlaybackServiceBesidesPlayerCore() {
        val xml = manifest()
        val service = element(xml, "service", AudioSession.SERVICE)
        assertTrue(service.contains("android:exported=\"false\""))
        assertTrue(service.contains("android:foregroundServiceType=\"mediaPlayback\""))
        assertTrue(service.contains("androidx.media3.session.MediaSessionService"))
        assertFalse(service.contains("android.media.browse.MediaBrowserService"))
        val core = element(xml, "service", AudioSession.PLAYER_CORE_SERVICE)
        assertTrue(core.contains("android:foregroundServiceType=\"mediaPlayback\""))
        assertTrue(xml.contains("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"))
        assertEquals(1, Regex("android:name=\"${Regex.escape(AudioSession.SERVICE)}\"").findAll(xml).count())
    }

    @Test
    fun notificationLabelsExistInBothLanguages() {
        val keys = listOf(
            "audio.channel",
            "audio.noUrl",
            "audio.notify.back",
            "audio.notify.forward",
            "audio.notify.prev",
            "audio.notify.next",
            "audio.notify.stop",
        )
        for (key in keys) {
            I18n.lang = "en"
            val en = I18n.s(key)
            I18n.lang = "ru"
            val ru = I18n.s(key)
            assertTrue(key, en.isNotEmpty() && en != key)
            assertTrue(key, ru.isNotEmpty() && ru != key && ru != en)
            assertFalse(key, en.any { it in '\u0400'..'\u04FF' })
        }
        I18n.lang = "ru"
    }

    private fun item(url: String, title: String, fileId: Int, startMs: Long, endMs: Long): JSONObject =
        JSONObject()
            .put("url", url)
            .put("title", title)
            .put("fileId", fileId)
            .put("startMs", startMs)
            .put("endMs", endMs)

    private fun manifest(): String {
        val file = listOf(File("src/main/AndroidManifest.xml"), File("android/app/src/main/AndroidManifest.xml"))
            .firstOrNull { it.isFile }
            ?: error("AndroidManifest.xml not found from ${File(".").absolutePath}")
        return file.readText()
    }

    private fun element(xml: String, tag: String, name: String): String {
        val marker = "android:name=\"$name\""
        val at = xml.indexOf(marker)
        assertTrue(name, at >= 0)
        val open = xml.lastIndexOf("<$tag", at)
        val close = xml.indexOf("</$tag>", at).let { if (it < 0) xml.indexOf("/>", at) + 2 else it + tag.length + 3 }
        return xml.substring(open, close)
    }
}
