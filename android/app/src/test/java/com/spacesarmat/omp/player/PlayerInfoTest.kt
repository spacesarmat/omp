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
    fun panelInRussian() {
        val media = EngineMediaInfo("HEVC", 3840, 2160, "HDR10", 15_000_000, passthrough = true, bufferedMs = 25_500)
        val audio = EngineTrack("a1", "rus", "HDRezka", "E-AC3", 6, selected = true)
        val stats = TorrentStats(7, 8, 21, 2_202_010.0, 0.0, 125829120L, 52428800L, 209715200L)
        val p = PlayerInfoText.panel("Тёмная материя · S01E02", "Dark.Matter.S01E02.mkv", media, audio, stats)
        assertEquals("Тёмная материя · S01E02", p.title)
        assertEquals("Dark.Matter.S01E02.mkv", p.file)
        assertEquals(
            listOf(
                InfoRow("Видео", "HEVC · 3840×2160 · HDR10 · 15 Мбит/с"),
                InfoRow("Звук", "E-AC3 · 5.1 · напрямую на ресивер"),
                InfoRow("Раздача", "7 сидов · 8 пиров из 21 · ↓ 2,1 МБ/с · ↑ 0"),
                InfoRow("Буфер", "TorrServer 120 МБ · плеер 25 с"),
            ),
            p.rows,
        )
    }

    @Test
    fun pluralsAndRates() {
        assertEquals("1 сид", PlayerInfoText.plural("info.seeds", 1))
        assertEquals("3 сида", PlayerInfoText.plural("info.seeds", 3))
        assertEquals("11 сидов", PlayerInfoText.plural("info.seeds", 11))
        assertEquals("22 пира", PlayerInfoText.plural("info.peers", 22))
        assertEquals("0", PlayerInfoText.rate(0.0))
        assertEquals("350 КБ/с", PlayerInfoText.rate(358_400.0))
        I18n.lang = "en"
        assertEquals("1 seed", PlayerInfoText.plural("info.seeds", 1))
        assertEquals("3 seeds", PlayerInfoText.plural("info.seeds", 3))
    }

    @Test
    fun unknownPartsAreLeftOut() {
        val p = PlayerInfoText.panel("Film", "Film", EngineMediaInfo(), EngineTrack("a", null, null), null)
        assertEquals("", p.file)
        assertEquals(listOf(InfoRow("Раздача", "нет данных")), p.rows)
        val decoded = PlayerInfoText.panel("", "", EngineMediaInfo(passthrough = false), EngineTrack("a", "eng", null, "DTS", 0), TorrentStats())
        assertTrue(decoded.rows.contains(InfoRow("Звук", "DTS · декодируется")))
        assertTrue(decoded.rows.contains(InfoRow("Раздача", "0 сидов · 0 пиров · ↓ 0 · ↑ 0")))
        // no buffer known: no buffer row; the cache counts when there is no preload
        assertTrue(decoded.rows.none { it.label == "Буфер" })
        val cache = PlayerInfoText.panel("", "", EngineMediaInfo(), null, TorrentStats(cacheFilled = 1024))
        assertTrue(cache.rows.contains(InfoRow("Буфер", "TorrServer 1,0 КБ")))
    }

    @Test
    fun englishHasNoCyrillic() {
        I18n.lang = "en"
        val p = PlayerInfoText.panel(
            "", "a.mkv", EngineMediaInfo("HEVC", 1920, 1080, "HLG", 8_000_000, false, 1_000), EngineTrack("a", "eng", null, "AC3", 2),
            TorrentStats(1, 2, 3, 1e6, 0.0, 2048, 1024, 4096),
        )
        assertTrue(p.rows.contains(InfoRow("Video", "HEVC · 1920×1080 · HLG · 8.0 Mbit/s")))
        assertTrue(p.rows.contains(InfoRow("Torrent", "1 seed · 2 peers of 3 · ↓ 977 KB/s · ↑ 0")))
        assertTrue(p.rows.contains(InfoRow("Buffer", "TorrServer 2.0 KB · player 1 s")))
        val cyr = Regex("[\\u0400-\\u04FF]")
        p.rows.forEach { assertNull(it.toString(), cyr.find(it.label + it.value)) }
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
        assertEquals(listOf(InfoRow("Раздача", "нет данных")), PlayerInfoText.panel("", "", EngineMediaInfo(), null, s.stats).rows)
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
