package com.spacesarmat.omp.audio

import androidx.media3.common.Player

/**
 * The audiobook session is not player-core's PlaybackService. Its id, channel and notification id are its own,
 * so the two players never share a session, a shade entry or a foreground notification.
 *
 * Play/pause is media3's central button. The buttons we add are ±[SEEK_MS], the previous and next chapter, and stop.
 */
object AudioSession {
    const val ID = "omp-audiobook"
    const val CHANNEL_ID = "omp-audiobook"
    const val NOTIFICATION_ID = 8091
    const val SERVICE = "com.spacesarmat.omp.audio.AudioPlayerService"
    const val PLAYER_CORE_SERVICE = "tv.p2160.core.engine.PlaybackService"

    const val SEEK_MS = 30_000L
    /** Custom session actions so previous/next chapter stay on the shade and the lock screen. */
    const val CMD_PREV = "omp.audio.prev"
    const val CMD_NEXT = "omp.audio.next"
    /** Notification tap. MainActivity opens the audiobook player for [EXTRA_HASH]. */
    const val OPEN_ACTION = "com.spacesarmat.omp.audio.OPEN"
    const val EXTRA_HASH = "omp.audio.hash"
    const val SPEED_MIN = 0.5f
    const val SPEED_MAX = 3f

    const val SLEEP_OFF = "off"
    const val SLEEP_15 = "15"
    const val SLEEP_30 = "30"
    const val SLEEP_60 = "60"
    const val SLEEP_CHAPTER = "chapter"

    /**
     * Player commands on the shade, beside media3's central play/pause.
     * Previous and next chapter are [CMD_PREV] and [CMD_NEXT], not seek-to-previous/next.
     */
    val notificationCommands: List<Int> = listOf(
        Player.COMMAND_SEEK_BACK,
        Player.COMMAND_SEEK_FORWARD,
        Player.COMMAND_STOP,
    )

    fun clampSpeed(speed: Float): Float {
        if (speed.isNaN()) return 1f
        return speed.coerceIn(SPEED_MIN, SPEED_MAX)
    }

    fun normalizeSleep(sleep: String?): String = when (sleep) {
        SLEEP_15, SLEEP_30, SLEEP_60, SLEEP_CHAPTER -> sleep
        else -> SLEEP_OFF
    }

    /** Epoch-independent deadline. Null for «off» and «end of chapter» (that one pauses when the item ends). */
    fun sleepDeadline(sleep: String, nowMs: Long): Long? = when (sleep) {
        SLEEP_15 -> nowMs + 15 * 60_000L
        SLEEP_30 -> nowMs + 30 * 60_000L
        SLEEP_60 -> nowMs + 60 * 60_000L
        else -> null
    }

    fun sleepIsChapter(sleep: String): Boolean = sleep == SLEEP_CHAPTER

    /**
     * ExoPlayer sits in [Player.STATE_IDLE] after an error and ignores play() until prepare().
     * A paused player is STATE_READY, so a normal resume does not prepare again.
     */
    fun resumeNeedsPrepare(hasError: Boolean, playbackState: Int): Boolean =
        hasError || playbackState == Player.STATE_IDLE

    /** Where a tap starts inside a clipped chapter: the asked position minus the chapter start, never negative. */
    fun startOffset(item: AudioItem, positionMs: Long): Long {
        val asked = positionMs.coerceAtLeast(0)
        val start = item.startMs.coerceAtLeast(0)
        return (asked - start).coerceAtLeast(0)
    }
}
