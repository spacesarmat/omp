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
        assertEquals("AVC", PlayerInfoText.videoCodec("h264"))
        assertEquals("AV1", PlayerInfoText.videoCodec("video/av01"))
        // Dolby Vision: the base codec, DV only as the HDR mark
        assertEquals("HEVC", PlayerInfoText.videoCodec("video/dolby-vision", "dvhe.08.06"))
        assertEquals("HEVC", PlayerInfoText.videoCodec("video/dolby-vision", "dvh1.05.06"))
        assertEquals("HEVC", PlayerInfoText.videoCodec("video/dolby-vision", null))
        assertEquals("AV1", PlayerInfoText.videoCodec("video/dolby-vision", "dav1.10.09"))
        assertEquals("AVC", PlayerInfoText.videoCodec("video/dolby-vision", "dvav.09.05"))
        assertEquals("HEVC", PlayerInfoText.videoCodec("dvhe"))
        assertEquals("DV", PlayerInfoText.hdrMark("Dolby Vision"))
        assertEquals("HDR10", PlayerInfoText.hdrMark("HDR10"))
        assertEquals("", PlayerInfoText.videoCodec(null))
    }

    @Test
    fun panelInRussian() {
        val media = EngineMediaInfo("HEVC", 3832, 1600, "Dolby Vision", 15_100_000, passthrough = true, bufferedMs = 17_500)
        val audio = EngineTrack("a1", "rus", "HDRezka", "AC3", 6, selected = true)
        val stats = TorrentStats(9, 11, 40, 3_250_586.0, 4_096.0, 547_356_672L, 52428800L, 1073741824L)
        val p = PlayerInfoText.panel("Сериал · S04E02", media, audio, stats)
        assertEquals("S04E02", p.title)
        assertEquals("DV", p.hdr)
        assertEquals("HEVC · 3832×1600", p.chip)
        assertEquals(
            listOf(InfoTile("Сиды / пиры", "9 / 11", ""), InfoTile("Загрузка", "3,1", "МБ/с"), InfoTile("Битрейт", "15,1", "Мбит/с")),
            p.tiles,
        )
        assertEquals("AC3 5.1 · на ресивер", p.sound)
        assertEquals("522 МБ · 17 с", p.buffer)
        assertEquals(17.5 / 30, p.bufferFill, 1e-9)
    }

    @Test
    fun titlesAndUnits() {
        assertEquals("S04E02", PlayerInfoText.shortTitle("Тёмная материя · s04e02"))
        assertEquals("Фильм (2024)", PlayerInfoText.shortTitle("Фильм (2024)"))
        assertEquals("0" to "КБ/с", PlayerInfoText.rateParts(0.0))
        assertEquals("350" to "КБ/с", PlayerInfoText.rateParts(358_400.0))
        assertEquals("120" to "Мбит/с", PlayerInfoText.bitrateParts(120_000_000))
        I18n.lang = "en"
        assertEquals("3.1" to "MB/s", PlayerInfoText.rateParts(3_250_586.0))
    }

    @Test
    fun unknownPartsShowADash() {
        val p = PlayerInfoText.panel("Film", EngineMediaInfo(), EngineTrack("a", null, null), null)
        assertEquals("Film", p.title)
        assertEquals("", p.hdr)
        assertEquals("", p.chip)
        assertEquals(listOf("—", "—", "—"), p.tiles.map { it.value })
        assertEquals("—", p.sound)
        assertEquals("—", p.buffer)
        assertEquals(0.0, p.bufferFill, 0.0)
        val decoded = PlayerInfoText.panel("", EngineMediaInfo(passthrough = false), EngineTrack("a", "eng", null, "DTS", 0), TorrentStats())
        assertEquals("DTS · декодируется", decoded.sound)
        assertEquals("0 / 0", decoded.tiles[0].value)
        // no player buffer: TorrServer's preload against its cache fills the bar
        val server = PlayerInfoText.panel("", EngineMediaInfo(), null, TorrentStats(preloaded = 256, cacheCapacity = 1024))
        assertEquals(0.25, server.bufferFill, 1e-9)
        assertEquals("256 Б", server.buffer)
        // a long buffer fills the bar, no more
        assertEquals(1.0, PlayerInfoText.panel("", EngineMediaInfo(bufferedMs = 90_000), null, null).bufferFill, 0.0)
    }

    @Test
    fun englishHasNoCyrillic() {
        I18n.lang = "en"
        val p = PlayerInfoText.panel(
            "Show · S01E02", EngineMediaInfo("HEVC", 1920, 1080, "HLG", 8_000_000, false, 1_000), EngineTrack("a", "eng", null, "AC3", 2),
            TorrentStats(1, 2, 3, 1e6, 0.0, 2048, 1024, 4096),
        )
        assertEquals(listOf("Seeds / peers", "Download", "Bitrate"), p.tiles.map { it.label })
        assertEquals("AC3 2.0 · decoded", p.sound)
        assertEquals("2.0 KB · 1 s", p.buffer)
        val cyr = Regex("[\\u0400-\\u04FF]")
        (p.tiles.flatMap { listOf(it.label, it.value, it.unit) } + listOf(p.title, p.chip, p.sound, p.buffer, I18n.s("info.audio"), I18n.s("info.buffer")))
            .forEach { assertNull(it, cyr.find(it)) }
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
        assertEquals("—", PlayerInfoText.panel("", EngineMediaInfo(), null, s.stats).tiles[0].value)
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
