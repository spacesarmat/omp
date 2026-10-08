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
    fun fileIdAndProbeUrl() {
        val r = TorrServerStats.request("http://u:p@10.0.0.2:8090/ts/stream/a.mkv?link=$H&index=3&play")!!
        assertEquals(3, r.index)
        assertEquals("http://10.0.0.2:8090/ts/ffp/$H/3", r.probeUrl)
        assertEquals("$H/3", r.fileKey)
        val none = TorrServerStats.request("http://h:1/stream/a.mkv?link=$H&play")!!
        assertNull(none.index)
        assertNull(none.probeUrl)
    }

    @Test
    fun fileSizeFromFileStats() {
        val files = org.json.JSONArray()
            .put(JSONObject().put("id", 1).put("path", "a/1.mkv").put("length", 1_000L))
            .put(JSONObject().put("id", 2).put("path", "a/2.mkv").put("length", 4_500_000_000L))
        val body = JSONObject().put("Torrent", JSONObject().put("file_stats", files)).toString()
        assertEquals(4_500_000_000L, TorrServerStats.parse(body, 2)!!.fileLength)
        assertEquals(0L, TorrServerStats.parse(body, 7)!!.fileLength)
        // no file id: only a single-file torrent has an answer
        assertEquals(0L, TorrServerStats.parse(body)!!.fileLength)
        val one = JSONObject().put("Torrent", JSONObject().put("file_stats", org.json.JSONArray().put(JSONObject().put("id", 1).put("length", 77L))))
        assertEquals(77L, TorrServerStats.parse(one.toString())!!.fileLength)
        assertEquals(0L, TorrServerStats.parse("{}", 1)!!.fileLength)
    }

    @Test
    fun probeBitrateLikeLg() {
        fun probe(video: JSONObject?, format: String?): String {
            val streams = org.json.JSONArray()
                .put(JSONObject().put("codec_type", "video").put("codec_name", "mjpeg").put("disposition", JSONObject().put("attached_pic", 1)).put("bit_rate", "1"))
            if (video != null) streams.put(video.put("codec_type", "video"))
            streams.put(JSONObject().put("codec_type", "audio").put("bit_rate", "640000"))
            val o = JSONObject().put("streams", streams)
            if (format != null) o.put("format", JSONObject().put("bit_rate", format))
            return o.toString()
        }
        // the video stream's bit_rate, else its BPS tag (MKV), else the container's; never the cover picture
        assertEquals(20_000_000L, TorrServerStats.probeBitrate(probe(JSONObject().put("bit_rate", "20000000"), "25000000")))
        assertEquals(18_123_456L, TorrServerStats.probeBitrate(probe(JSONObject().put("tags", JSONObject().put("BPS-eng", "18123456")), "25000000")))
        assertEquals(17_000_000L, TorrServerStats.probeBitrate(probe(JSONObject().put("tags", JSONObject().put("BPS", "17000000")), null)))
        assertEquals(25_000_000L, TorrServerStats.probeBitrate(probe(JSONObject().put("bit_rate", "N/A"), "25000000")))
        assertEquals(0L, TorrServerStats.probeBitrate(probe(null, null)))
        assertNull(TorrServerStats.probeBitrate("not json"))
    }

    @Test
    fun fetchProbeAsksFfpWithCredentials() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{\"streams\":[],\"format\":{\"bit_rate\":\"9000000\"}}"))
        server.start()
        try {
            val u = server.url("/stream/a.mkv").toString().replace("http://", "http://u:p@") + "?link=$H&index=2&play"
            val r = TorrServerStats.request(u)!!
            assertEquals(9_000_000L, TorrServerStats.fetchProbeBitrate(r))
            val req = server.takeRequest()
            assertEquals("GET", req.method)
            assertEquals("/ffp/$H/2", req.path)
            assertEquals(r.authorization, req.getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
        assertNull(TorrServerStats.fetchProbeBitrate(TorrServerStats.Request("http://127.0.0.1:1/cache", null, H, 1)))
        assertNull(TorrServerStats.fetchProbeBitrate(TorrServerStats.Request("http://127.0.0.1:1/cache", null, H)))
    }

    @Test
    fun bitrateFallbackOrder() {
        // 4,5 GB over 40 min = 15 Mbit/s
        val size = 4_500_000_000L
        val dur = 40 * 60_000L
        assertEquals(InfoBitrate(15_100_000, false), PlayerInfoText.bitrate(15_100_000, 9_000_000, size, dur))
        assertEquals(InfoBitrate(9_000_000, false), PlayerInfoText.bitrate(0, 9_000_000, size, dur))
        assertEquals(InfoBitrate(15_000_000, true), PlayerInfoText.bitrate(0, 0, size, dur))
        assertNull(PlayerInfoText.bitrate(0, 0, size, 0))
        assertNull(PlayerInfoText.bitrate(0, 0, 0, dur))
        assertNull(PlayerInfoText.bitrate(0, 0, size, 500))
        // the tile: exact as before, the average «≈», whole Mbit/s from 10 up
        assertEquals("15,1" to "Мбит/с", PlayerInfoText.bitrateTile(InfoBitrate(15_100_000, false)))
        assertEquals("≈15" to "Мбит/с", PlayerInfoText.bitrateTile(InfoBitrate(15_100_000, true)))
        assertEquals("≈8,4" to "Мбит/с", PlayerInfoText.bitrateTile(InfoBitrate(8_400_000, true)))
        assertEquals("—" to "", PlayerInfoText.bitrateTile(null))
        // in the panel
        fun tile(engine: Long, probe: Long, bytes: Long, ms: Long) =
            PlayerInfoText.panel("", EngineMediaInfo(bitrate = engine), null, null, probe, bytes, ms).tiles[2]
        assertEquals(InfoTile("Битрейт", "15,1", "Мбит/с"), tile(15_100_000, 9_000_000, size, dur))
        assertEquals(InfoTile("Битрейт", "9,0", "Мбит/с"), tile(0, 9_000_000, size, dur))
        assertEquals(InfoTile("Битрейт", "≈15", "Мбит/с"), tile(0, 0, size, dur))
        assertEquals(InfoTile("Битрейт", "—", ""), tile(0, 0, 0, dur))
        I18n.lang = "en"
        assertEquals(InfoTile("Bitrate", "≈8.4", "Mbit/s"), PlayerInfoText.panel("", EngineMediaInfo(), null, null, 0, 1_050_000_000L, 1_000_000L).tiles[2])
    }

    @Test
    fun fileSizeAndProbeCachedPerItem() {
        val s = InfoStatsState()
        val a = "$H/1"
        s.forTorrent(H, a)
        assertTrue(s.probeDue())
        // one request at a time
        assertTrue(!s.probeDue())
        s.answer(H, TorrentStats(fileLength = 1_000))
        s.probeAnswer(a, 9_000_000)
        assertEquals(1_000L, s.fileBytes)
        assertEquals(9_000_000L, s.probeBps)
        assertTrue(!s.probeDue())
        // a failed /cache keeps the size; closing the panel keeps both (they do not change)
        s.answer(H, null)
        s.closed()
        s.forTorrent(H, a)
        assertEquals(1_000L, s.fileBytes)
        assertEquals(9_000_000L, s.probeBps)
        // another file of the same torrent: nothing of the previous one; a late answer for it is ignored
        val b = "$H/2"
        s.forTorrent(H, b)
        assertEquals(0L, s.fileBytes)
        assertNull(s.probeBps)
        s.probeAnswer(a, 5)
        assertNull(s.probeBps)
        // ffprobe fails: a second try, then no more
        assertTrue(s.probeDue())
        s.probeAnswer(b, null)
        assertTrue(s.probeDue())
        s.probeAnswer(b, null)
        assertTrue(!s.probeDue())
        assertNull(s.probeBps)
        // not a TorrServer stream: nothing
        s.forTorrent(null, null)
        assertEquals(0L, s.fileBytes)
        assertTrue(!s.probeDue())
    }

    @Test
    fun hdrKinds() {
        assertEquals("HDR10", Engine2160.hdrOf("video/hevc", androidx.media3.common.C.COLOR_TRANSFER_ST2084))
        assertEquals("HLG", Engine2160.hdrOf("video/hevc", androidx.media3.common.C.COLOR_TRANSFER_HLG))
        assertEquals("Dolby Vision", Engine2160.hdrOf("video/dolby-vision", null))
        assertEquals("", Engine2160.hdrOf("video/avc", androidx.media3.common.C.COLOR_TRANSFER_SDR))
        assertEquals("", Engine2160.hdrOf(null, null))
    }
}
