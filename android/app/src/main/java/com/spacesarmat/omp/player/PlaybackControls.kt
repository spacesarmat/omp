package com.spacesarmat.omp.player

import android.content.pm.PackageManager
import androidx.media3.common.Player

/**
 * Phone background playback through player-core's [PLAYBACK_SERVICE].
 *
 * The service was removed while it was exported: other apps could bind to the media session. It stays in the
 * manifest as not exported and disabled. [Embedded2160.backgroundOn] turns it on only for a phone with
 * «Звук в фоне». Android TV never does, so Engine2160's `startService` stays a caught no-op (no notification).
 *
 * The shade shows [notificationActions]. Play/pause is media3's own central button, so [preferenceCommands] does
 * not include it (a second play button would be drawn next to the first).
 */
object PlaybackControls {
    const val SERVICE = "tv.p2160.core.engine.PlaybackService"
    const val ACTIVITY = "tv.p2160.core.Player2160Activity"
    const val FOREGROUND_SERVICE_TYPE = "mediaPlayback"

    /** Install-time. Required on API 34+ together with [FOREGROUND_SERVICE_TYPE]. */
    const val PERMISSION_FGS = "android.permission.FOREGROUND_SERVICE"
    const val PERMISSION_MEDIA_PLAYBACK = "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"

    /** Runtime prompt on API 33+. Without it the sound can still play; the shade has no controls. */
    const val PERMISSION_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

    val manifestPermissions: List<String> = listOf(PERMISSION_FGS, PERMISSION_MEDIA_PLAYBACK, PERMISSION_NOTIFICATIONS)

    /** Shade order. `playPause` is inserted by media3 between the two seeks. */
    val notificationActions: List<String> = listOf("seekBack", "playPause", "seekForward", "stop")

    /**
     * Buttons we publish on the session. Order is back, forward, stop; media3 places play/pause in the centre
     * and the stop action on the expanded notification.
     */
    val preferenceCommands: List<Int> = listOf(
        Player.COMMAND_SEEK_BACK,
        Player.COMMAND_SEEK_FORWARD,
        Player.COMMAND_STOP,
    )

    /**
     * `PackageManager.getComponentEnabledSetting` returns [PackageManager.COMPONENT_ENABLED_STATE_DEFAULT] when
     * nothing has overridden the manifest, and the manifest says `enabled=false`. Only an explicit ENABLED means
     * the phone has turned the service on.
     */
    fun componentRuns(enabledSetting: Int): Boolean =
        enabledSetting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED

    /** Kotlin mangles an `internal` getter as `getSession$<module>`. `getSessionId` is a different method. */
    fun isSessionGetter(name: String): Boolean =
        name == "getSession" || (name.startsWith("getSession$") && name.indexOf('$') == "getSession".length)
}
