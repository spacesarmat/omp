package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The «Инфо» panel: TorrServer statistics of the stream's torrent and the text of the panel. */
class PlayerInfoTest {
    private val H = "a".repeat(40)

    @Before
    fun ru() {
        I18n.lang = "ru"
    }

    @After
    fun back() {
        I18n.lang = "ru"
    }

    @Test
    fun cacheRequestFromTheStreamUrl() {
        val r = TorrServerStats.request("http://u%40x:p%3Aw@10.0.0.2:8090/stream/Show.S01E02.mkv?link=$H&index=2&play")!!
        assertEquals("http://10.0.0.2:8090/cache", r.url)
        assertEquals(H, r.hash)
        assertEquals("Basic " + java.util.Base64.getEncoder().encodeToString("u@x:p:w".toByteArray()), r.authorization)
        // a TorrServer behind a path prefix, no credentials
        val p = TorrServerStats.request("https://ts.example/ts/stream/a.mkv?link=$H&index=1&play")!!
        assertEquals("https://ts.example/ts/cache", p.url)
        assertNull(p.authorization)
        assertNull(TorrServerStats.request("http://h/video.mkv"))
        assertNull(TorrServerStats.request("http://h/stream/a.mkv?index=1"))
        assertNull(TorrServerStats.request("file:///x/stream/a?link=$H"))
    }

    @Test
    fun parsesTheCacheAnswer() {
        val body = JSONObject()
            .put("Capacity", 209715200L).put("Filled", 52428800L)
            .put("Torrent", JSONObject().put("connected_seeders", 12).put("active_peers", 30).put("total_peers", 85)
                .put("download_speed", 2_500_000.5).put("upload_speed", 125_000.0).put("preloaded_bytes", 33554432L))
            .toString()
        assertEquals(TorrentStats(12, 30, 85, 2_500_000.5, 125_000.0, 33554432L, 52428800L, 209715200L), TorrServerStats.parse(body))
        assertEquals(TorrentStats(), TorrServerStats.parse("{}"))
        assertNull(TorrServerStats.parse("not json"))
    }

    @Test
    fun fetchPostsGetWithTheHash() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{\"Torrent\":{\"active_peers\":3,\"total_peers\":9,\"connected_seeders\":2}}"))
        server.start()
        try {
            val r = TorrServerStats.request(server.url("/stream/a.mkv").toString() + "?link=$H&index=1&play")!!
            val s = TorrServerStats.fetch(r)!!
            assertEquals(3, s.activePeers)
            val req = server.takeRequest()
            assertEquals("POST", req.method)
            assertEquals("/cache", req.path)
            val sent = JSONObject(req.body.readUtf8())
            assertEquals("get", sent.getString("action"))
            assertEquals(H, sent.getString("hash"))
        } finally {
            server.shutdown()
        }
        // an unreachable server: null, no exception
        assertNull(TorrServerStats.fetch(TorrServerStats.Request("http://127.0.0.1:1/cache", null, H)))
    }

    @Test
    fun fileNameAndCodecs() {
        assertEquals("Show S01E02.mkv", PlayerInfoText.fileName("http://h:1/stream/Show%20S01E02.mkv?link=$H&index=2&play"))
        assertEquals("", PlayerInfoText.fileName("http://h:1/video.mkv"))
        assertEquals("HEVC", PlayerInfoText.videoCodec("video/hevc"))
        assertEquals("HEVC", PlayerInfoText.videoCodec("hevc"))
        assertEquals("H.264", PlayerInfoText.videoCodec("h264"))
        assertEquals("AV1", PlayerInfoText.videoCodec("video/av01"))
        assertEquals("Dolby Vision", PlayerInfoText.videoCodec("video/dolby-vision"))
        assertEquals("", PlayerInfoText.videoCodec(null))
    }

    @Test
    fun panelLinesInRussian() {
        val media = EngineMediaInfo("HEVC", 3840, 2160, "HDR10", 25_000_000, passthrough = true, bufferedMs = 42_500)
        val audio = EngineTrack("a1", "rus", "HDRezka", "E-AC3", 6, selected = true)
        val stats = TorrentStats(12, 30, 85, 2_500_000.0, 125_000.0, 33554432L, 52428800L, 209715200L)
        val lines = PlayerInfoText.lines("Тёмная материя · S01E02", "Dark.Matter.S01E02.mkv", media, audio, stats)
        assertEquals(
            listOf(
                "Тёмная материя · S01E02",
                "Dark.Matter.S01E02.mkv",
                "Видео: HEVC · 3840×2160 · HDR10 · 25,0 Мбит/с",
                "Звук: E-AC3 · 5.1 · напрямую на ресивер",
                "Сиды: 12 · пиры: 30 из 85",
                "Загрузка: 20,0 Мбит/с · отдача: 1,0 Мбит/с",
                "Предзагружено: 32,0 МБ · кэш: 50,0 МБ из 200 МБ",
                "Буфер плеера: 42 с",
            ),
            lines,
        )
    }

    @Test
    fun unknownPartsAreLeftOut() {
        val lines = PlayerInfoText.lines("Film", "Film", EngineMediaInfo(), EngineTrack("a", null, null), null)
        assertEquals(listOf("Film", "Торрент: нет данных"), lines)
        val decoded = PlayerInfoText.lines("", "", EngineMediaInfo(passthrough = false), EngineTrack("a", "eng", null, "DTS", 0), TorrentStats())
        assertTrue(decoded.contains("Звук: DTS · декодируется"))
        assertTrue(decoded.contains("Сиды: 0 · пиры: 0 из 0"))
    }

    @Test
    fun englishHasNoCyrillic() {
        I18n.lang = "en"
        val lines = PlayerInfoText.lines(
            "", "a.mkv", EngineMediaInfo("HEVC", 1920, 1080, "HLG", 8_000_000, false, 1_000), EngineTrack("a", "eng", null, "AC3", 2),
            TorrentStats(1, 2, 3, 1e6, 0.0, 2048, 1024, 4096),
        )
        assertNotNull(lines.firstOrNull { it.startsWith("Video: HEVC") })
        assertTrue(lines.contains("Download: 8.0 Mbit/s · upload: 0.0 Mbit/s"))
        val cyr = Regex("[\\u0400-\\u04FF]")
        lines.forEach { assertNull(it, cyr.find(it)) }
    }

    @Test
    fun statsAreNeverStale() {
        val s = InfoStatsState()
        val good = TorrentStats(5, 10, 20)
        s.forTorrent(H)
        s.answer(H, good)
        assertEquals(good, s.stats)
        // TorrServer stops answering: «нет данных», not the last numbers
        s.answer(H, null)
        assertNull(s.stats)
        assertEquals(listOf("Торрент: нет данных"), PlayerInfoText.lines("", "", EngineMediaInfo(), null, s.stats))
        // a late answer for another torrent is ignored
        s.answer(H, good)
        s.forTorrent("b".repeat(40))
        assertNull(s.stats)
        s.answer(H, good)
        assertNull(s.stats)
        // an item that is not a TorrServer stream: no numbers of the previous one
        s.answer("b".repeat(40), good)
        assertEquals(good, s.stats)
        s.forTorrent(null)
        assertNull(s.stats)
        // closing the panel: reopening starts empty, even for the same torrent
        s.forTorrent(H)
        s.answer(H, good)
        s.closed()
        assertNull(s.stats)
        s.forTorrent(H)
        assertNull(s.stats)
    }

    @Test
    fun hdrKinds() {
        assertEquals("HDR10", Media3Engine.hdrOf("video/hevc", androidx.media3.common.C.COLOR_TRANSFER_ST2084))
        assertEquals("HLG", Media3Engine.hdrOf("video/hevc", androidx.media3.common.C.COLOR_TRANSFER_HLG))
        assertEquals("Dolby Vision", Media3Engine.hdrOf("video/dolby-vision", null))
        assertEquals("", Media3Engine.hdrOf("video/avc", androidx.media3.common.C.COLOR_TRANSFER_SDR))
        assertEquals("", Media3Engine.hdrOf(null, null))
    }
}
