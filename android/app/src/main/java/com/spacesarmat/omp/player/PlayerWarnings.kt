package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n

/**
 * Playback warnings the built-in player shows as a message. 2160 Player already computes them in
 * `MediaReporter` / `PlayerController.state.warnings` (its own screen is not used). OMP keeps the three that
 * matter on a set-top box and says them in its own language.
 */
enum class PlayerWarning {
    /** 4K video is decoded in software (FFmpeg or a software MediaCodec). */
    SOFTWARE_4K,

    /** Dolby Vision, and this device is not decoding it (the HDR10 base layer plays instead). */
    DOLBY_VISION,

    /** HDR picture on a display that reported no HDR modes. */
    HDR_ON_SDR,
}

object PlayerWarnings {
    /** How many polls after playback has passed 2 s to wait for 2160 to fill the list. */
    const val POLLS_AFTER_START = 6

    enum class Poll { WAIT, SHOW, STOP }

    /**
     * 2160's `info.warn_*` texts (ru and en packs of the pinned player-core). Anything else — the non-4K software
     * line, the tunneling note — is not an OMP message.
     */
    private val FROM_2160: Map<String, PlayerWarning> = mapOf(
        "4K-видео декодируется программно — возможны рывки; попробуйте аппаратный декодер в настройках" to PlayerWarning.SOFTWARE_4K,
        "4K video is decoded in software — expect stutter; try the hardware decoder in settings" to PlayerWarning.SOFTWARE_4K,
        "Dolby Vision здесь не поддерживается — показывается базовый слой HDR10" to PlayerWarning.DOLBY_VISION,
        "Dolby Vision is not supported here — the HDR10 base layer is shown" to PlayerWarning.DOLBY_VISION,
        "Экран не HDR — цвета будут преобразованы (тонмаппинг)" to PlayerWarning.HDR_ON_SDR,
        "This screen is not HDR — colours are tone-mapped" to PlayerWarning.HDR_ON_SDR,
    )

    private val ORDER = listOf(PlayerWarning.SOFTWARE_4K, PlayerWarning.DOLBY_VISION, PlayerWarning.HDR_ON_SDR)

    /**
     * The warnings to show, in [ORDER]. [alwaysFfmpeg]: the user asked for software decoding, so the 4K software
     * note would fire on every 4K file and is left out. Dolby Vision and HDR on an SDR screen still show.
     */
    fun fromReport(lines: List<String>, alwaysFfmpeg: Boolean = false): List<PlayerWarning> {
        val found = HashSet<PlayerWarning>()
        for (line in lines) {
            val kind = FROM_2160[line.trim()] ?: continue
            if (kind == PlayerWarning.SOFTWARE_4K && alwaysFfmpeg) continue
            found.add(kind)
        }
        return ORDER.filter { it in found }
    }

    /**
     * One poll of 2160's warning list. Show as soon as playback has passed the start delay and a known warning is
     * there; stop after [POLLS_AFTER_START] empty polls past that delay. Before that delay, keep waiting (a torrent
     * can take a while to start).
     */
    fun poll(pastStart: Boolean, ticksAfterStart: Int, kinds: List<PlayerWarning>): Poll = when {
        pastStart && kinds.isNotEmpty() -> Poll.SHOW
        pastStart && ticksAfterStart >= POLLS_AFTER_START -> Poll.STOP
        else -> Poll.WAIT
    }

    fun text(kind: PlayerWarning): String = I18n.s(
        when (kind) {
            PlayerWarning.SOFTWARE_4K -> "player.warn.software4k"
            PlayerWarning.DOLBY_VISION -> "player.warn.dolbyVision"
            PlayerWarning.HDR_ON_SDR -> "player.warn.hdrOnSdr"
        },
    )

    /** One toast: the warnings, one per line. Empty when there is nothing to say. */
    fun message(kinds: List<PlayerWarning>): String = kinds.map { text(it) }.filter { it.isNotEmpty() }.joinToString("\n")
}

/**
 * A playback warning that arrived while «Вернуть» is on screen. The engine reports it once, so it is kept until
 * that toast goes and then shown. A new item drops it: the warning belongs to the item that produced it.
 */
class PendingPlaybackWarning {
    private var pending: String? = null

    /**
     * A warning for the current item. The text to show now, or null when [undoVisible] and it stays pending
     * (a later warning replaces the one already held).
     */
    fun arrive(text: String, undoVisible: Boolean): String? {
        if (text.isEmpty()) return null
        if (undoVisible) {
            pending = text
            return null
        }
        pending = null
        return text
    }

    /** «Вернуть» (or the toast that replaced it) left the screen and this item continues. The held text, once. */
    fun take(): String? {
        val text = pending
        pending = null
        return text
    }

    /** The next item, or a new queue. */
    fun clear() {
        pending = null
    }
}
