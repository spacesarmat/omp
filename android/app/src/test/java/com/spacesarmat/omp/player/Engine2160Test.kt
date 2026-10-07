package com.spacesarmat.omp.player

import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/** 2160 engine → engine-independent mappings (no controller is built). */
class Engine2160Test {
    @Test
    fun errorCodesMapToKinds() {
        val k = { code: Int -> Engine2160.errorKind(code) }
        assertEquals(ErrorKind.NETWORK, k(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED))
        assertEquals(ErrorKind.NETWORK, k(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT))
        assertEquals(ErrorKind.NETWORK, k(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS))
        assertEquals(ErrorKind.NETWORK, k(PlaybackException.ERROR_CODE_TIMEOUT))
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, k(PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED))
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, k(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED))
        assertEquals(ErrorKind.UNSUPPORTED_FORMAT, k(PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES))
        assertEquals(ErrorKind.DECODER, k(PlaybackException.ERROR_CODE_DECODER_INIT_FAILED))
        assertEquals(ErrorKind.DECODER, k(PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED))
        assertEquals(ErrorKind.OTHER, k(PlaybackException.ERROR_CODE_UNSPECIFIED))
        assertEquals(ErrorKind.OTHER, k(PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND))
        // the old text («Не удалось воспроизвести видео»); «Авто» recognises it by the code name
        assertEquals(ErrorKind.OTHER, k(PlaybackException.ERROR_CODE_DECODING_FAILED))
        assertEquals(EngineChooser.DECODING_FAILED, PlaybackException.getErrorCodeName(PlaybackException.ERROR_CODE_DECODING_FAILED))
    }

    @Test
    fun codecNames() {
        assertEquals("AC3", Engine2160.codecName(MimeTypes.AUDIO_AC3))
        assertEquals("E-AC3", Engine2160.codecName(MimeTypes.AUDIO_E_AC3_JOC))
        assertEquals("DTS", Engine2160.codecName(MimeTypes.AUDIO_DTS_HD))
        assertEquals("DTS", Engine2160.codecName(MimeTypes.AUDIO_DTS_UHD_P2))
        assertEquals("TrueHD", Engine2160.codecName(MimeTypes.AUDIO_TRUEHD))
        // Blu-ray LPCM through 2160's M2TS extractor
        assertEquals("PCM", Engine2160.codecName(MimeTypes.AUDIO_RAW))
        assertEquals("", Engine2160.codecName(null))
        assertEquals("", Engine2160.codecName("audio/x-unknown"))
    }

    @Test
    fun formatsBecomeTracks() {
        val t = Engine2160.trackOf("g1", null, "ru", "Дубляж", MimeTypes.AUDIO_AC3, 6, true)
        assertEquals(EngineTrack("g1", "ru", "Дубляж", "AC3", 6, true, null), t)
        assertEquals("Русский · Дубляж · AC3 5.1", TrackOptions.audioLabel(t, 1))

        val unknown = Engine2160.trackOf("g2", null, null, null, null, Format.NO_VALUE, false)
        assertEquals(0, unknown.channels)
        assertEquals("", unknown.codec)
        assertNull(unknown.external)

        assertEquals(3, Engine2160.trackOf("g4", 3, null, "Надписи", MimeTypes.TEXT_SSA, Format.NO_VALUE, false).external)
    }

    @Test
    fun externalSubtitlesAreFoundByTheirUriHash() {
        // the controller's SubtitleConfiguration id «ext:<item>:<uri hash>»; the extractor may prefix it («1:ext:0:…»)
        val hashes = mapOf(-12345 to 0, 777 to 3)
        assertEquals(0, Engine2160.externalIndex("ext:0:-12345", hashes))
        assertEquals(3, Engine2160.externalIndex("1:ext:0:777", hashes))
        assertNull(Engine2160.externalIndex("ext:0:42", hashes))
        assertNull(Engine2160.externalIndex("2", hashes))
        assertNull(Engine2160.externalIndex(null, hashes))
    }

    @Test
    fun subtitleFilesGetANameWithTheirExtension() {
        // 2160 takes the MIME type from the extension and the label from the rest
        assertEquals("Надписи.ass", Engine2160.subtitleName("Надписи", ".ASS", 0))
        assertEquals("Full.srt", Engine2160.subtitleName("Full", "srt", 1))
        assertEquals("sub3.vtt", Engine2160.subtitleName(" ", "vtt", 2))
    }

    @Test
    fun subtitleMimes() {
        assertEquals(MimeTypes.APPLICATION_SUBRIP, Engine2160.subMime(".SRT"))
        assertEquals(MimeTypes.TEXT_SSA, Engine2160.subMime("ssa"))
        assertEquals(MimeTypes.TEXT_VTT, Engine2160.subMime("vtt"))
        assertNull(Engine2160.subMime("sub"))
    }

    @Test
    fun credentialsMoveFromTheUrlToABasicHeader() {
        val (url, headers) = Engine2160.splitCredentials("http://admin:p%40ss@192.168.1.5:8090/stream/Film.mkv?link=abc&index=1&play")
        assertEquals("http://192.168.1.5:8090/stream/Film.mkv?link=abc&index=1&play", url)
        val token = Base64.getEncoder().encodeToString("admin:p@ss".toByteArray())
        assertEquals(mapOf("Authorization" to "Basic $token"), headers)

        val plain = "http://192.168.1.5:8090/stream/a@b.mkv?link=x@y"
        assertEquals(plain to emptyMap<String, String>(), Engine2160.splitCredentials(plain))
        assertEquals("file:///x" to emptyMap<String, String>(), Engine2160.splitCredentials("file:///x"))
        assertEquals("no-scheme" to emptyMap<String, String>(), Engine2160.splitCredentials("no-scheme"))

        val userOnly = Engine2160.splitCredentials("http://user@h/s")
        assertEquals("http://h/s", userOnly.first)
        assertEquals("Basic " + Base64.getEncoder().encodeToString("user:".toByteArray()), userOnly.second["Authorization"])
    }

    @Test
    fun percentDecoding() {
        assertEquals("p@ss word", Engine2160.percentDecode("p%40ss%20word"))
        assertEquals("a+b", Engine2160.percentDecode("a+b"))
        assertEquals("пароль", Engine2160.percentDecode("%D0%BF%D0%B0%D1%80%D0%BE%D0%BB%D1%8C"))
        assertEquals("100%", Engine2160.percentDecode("100%"))
        assertEquals("%zz", Engine2160.percentDecode("%zz"))
    }

    @Test
    fun quietSegmentsAreNeverReached() {
        val ten = 10L * 3600_000
        assertEquals(2, Engine2160.QUIET_SEGMENTS.size)
        for (s in Engine2160.QUIET_SEGMENTS) {
            for (pos in listOf(0L, 60_000L, ten)) assertTrue(!s.contains(pos, ten))
        }
    }

    @Test
    fun onlyThe2160EngineHasNightSound() {
        assertNull(FakeEngine().nightMode)
    }
}
