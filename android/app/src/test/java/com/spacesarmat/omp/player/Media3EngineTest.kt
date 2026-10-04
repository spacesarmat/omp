package com.spacesarmat.omp.player

import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Media3 → engine-independent mappings (no player is built). */
class Media3EngineTest {
    @Test
    fun errorCodesMapToKinds() {
        val k = { code: Int -> Media3Engine.errorKind(code) }
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
    }

    @Test
    fun codecNames() {
        assertEquals("AC3", Media3Engine.codecName(MimeTypes.AUDIO_AC3))
        assertEquals("E-AC3", Media3Engine.codecName(MimeTypes.AUDIO_E_AC3_JOC))
        assertEquals("DTS", Media3Engine.codecName(MimeTypes.AUDIO_DTS_HD))
        assertEquals("TrueHD", Media3Engine.codecName(MimeTypes.AUDIO_TRUEHD))
        assertEquals("", Media3Engine.codecName(null))
        assertEquals("", Media3Engine.codecName("audio/x-unknown"))
    }

    @Test
    fun formatsBecomeTracks() {
        val t = Media3Engine.trackOf("g1", "2", "ru", "Дубляж", MimeTypes.AUDIO_AC3, 6, true)
        assertEquals(EngineTrack("g1", "ru", "Дубляж", "AC3", 6, true, null), t)
        assertEquals("Русский · Дубляж · AC3 5.1", TrackOptions.audioLabel(t, 1))

        val unknown = Media3Engine.trackOf("g2", null, null, null, null, Format.NO_VALUE, false)
        assertEquals(0, unknown.channels)
        assertEquals("", unknown.codec)
        assertNull(unknown.external)

        assertEquals(3, Media3Engine.trackOf("g4", "1:omp-x3", null, "Надписи", MimeTypes.TEXT_SSA, Format.NO_VALUE, false).external)
    }

    @Test
    fun subtitleMimes() {
        assertEquals(MimeTypes.APPLICATION_SUBRIP, Media3Engine.subMime(".SRT"))
        assertEquals(MimeTypes.TEXT_SSA, Media3Engine.subMime("ssa"))
        assertEquals(MimeTypes.TEXT_VTT, Media3Engine.subMime("vtt"))
        assertNull(Media3Engine.subMime("sub"))
    }
}
