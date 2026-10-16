package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject

/** Which of 2160's report lines OMP shows, and when the poll gives up. */
class PlayerWarningsTest {
    private val sw4kRu = "4K-видео декодируется программно — возможны рывки; попробуйте аппаратный декодер в настройках"
    private val sw4kEn = "4K video is decoded in software — expect stutter; try the hardware decoder in settings"
    private val dvRu = "Dolby Vision здесь не поддерживается — показывается базовый слой HDR10"
    private val dvEn = "Dolby Vision is not supported here — the HDR10 base layer is shown"
    private val sdrRu = "Экран не HDR — цвета будут преобразованы (тонмаппинг)"
    private val sdrEn = "This screen is not HDR — colours are tone-mapped"
    private val swRu = "Видео декодируется программно — возможны рывки"
    private val tunnel = "Туннельный режим на этом устройстве не работает — выключен."

    @After
    fun resetLang() {
        I18n.lang = "ru"
    }

    @Test
    fun reportLinesBecomeTheThreeWarningsInAStableOrder() {
        assertEquals(
            listOf(PlayerWarning.SOFTWARE_4K, PlayerWarning.DOLBY_VISION, PlayerWarning.HDR_ON_SDR),
            PlayerWarnings.fromReport(listOf(sdrEn, sw4kRu, dvEn, swRu, tunnel)),
        )
        assertEquals(listOf(PlayerWarning.DOLBY_VISION), PlayerWarnings.fromReport(listOf("  $dvRu  ")))
        assertEquals(listOf(PlayerWarning.HDR_ON_SDR), PlayerWarnings.fromReport(listOf(sdrRu)))
        assertTrue(PlayerWarnings.fromReport(listOf(swRu, tunnel, "")).isEmpty())
        // the same line twice is one warning
        assertEquals(listOf(PlayerWarning.SOFTWARE_4K), PlayerWarnings.fromReport(listOf(sw4kEn, sw4kRu)))
    }

    @Test
    fun alwaysFfmpegDropsTheSoftware4kNote() {
        val lines = listOf(sw4kEn, dvRu, sdrEn)
        assertEquals(
            listOf(PlayerWarning.DOLBY_VISION, PlayerWarning.HDR_ON_SDR),
            PlayerWarnings.fromReport(lines, alwaysFfmpeg = true),
        )
        assertEquals(
            listOf(PlayerWarning.SOFTWARE_4K, PlayerWarning.DOLBY_VISION, PlayerWarning.HDR_ON_SDR),
            PlayerWarnings.fromReport(lines, alwaysFfmpeg = false),
        )
    }

    @Test
    fun messageUsesOmpsLanguage() {
        val kinds = listOf(PlayerWarning.SOFTWARE_4K, PlayerWarning.HDR_ON_SDR)
        I18n.lang = "ru"
        assertEquals(
            "4K декодируется программно — возможны рывки\nЭкран без HDR — цвета будут преобразованы",
            PlayerWarnings.message(kinds),
        )
        I18n.lang = "en"
        assertEquals(
            "4K is decoded in software — playback may stutter\nThis screen is not HDR — colors will be tone-mapped",
            PlayerWarnings.message(kinds),
        )
        assertEquals("", PlayerWarnings.message(emptyList()))
    }

    @Test
    fun pollWaitsForTheStartThenShowsOrStops() {
        val none = emptyList<PlayerWarning>()
        val one = listOf(PlayerWarning.DOLBY_VISION)
        assertEquals(PlayerWarnings.Poll.WAIT, PlayerWarnings.poll(false, 0, one))
        assertEquals(PlayerWarnings.Poll.WAIT, PlayerWarnings.poll(true, 1, none))
        assertEquals(PlayerWarnings.Poll.WAIT, PlayerWarnings.poll(true, PlayerWarnings.POLLS_AFTER_START - 1, none))
        assertEquals(PlayerWarnings.Poll.STOP, PlayerWarnings.poll(true, PlayerWarnings.POLLS_AFTER_START, none))
        assertEquals(PlayerWarnings.Poll.SHOW, PlayerWarnings.poll(true, PlayerWarnings.POLLS_AFTER_START, one))
        assertEquals(PlayerWarnings.Poll.SHOW, PlayerWarnings.poll(true, 1, one))
    }

    @Test
    fun playNativeCarriesAlwaysFfmpegOffByDefault() {
        val q = JSONArray().put(JSONObject().put("url", "http://h/a"))
        assertEquals(false, PlayRequest.parse(JSONObject().put("queue", q))!!.alwaysFfmpeg)
        assertEquals(true, PlayRequest.parse(JSONObject().put("queue", q).put("alwaysFfmpeg", true))!!.alwaysFfmpeg)
        assertEquals(false, PlayRequest.parse(JSONObject().put("queue", q).put("alwaysFfmpeg", "yes"))!!.alwaysFfmpeg)
    }
}
