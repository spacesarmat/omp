package com.spacesarmat.omp.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import tv.p2160.core.api.MediaEntry
import tv.p2160.core.api.PlaybackRequest
import tv.p2160.core.api.SkipSegment
import tv.p2160.core.settings.PlayerSettings
import tv.p2160.core.api.Player2160 as P2160

/**
 * Phone: «Смотреть на телефоне» in 2160 Player's own screen inside OMP (player-core's `Player2160Activity`, launched
 * in-process through `Player2160.PlayContract`'s intent). The answer is the same MX-style result as the 2160 Player
 * app's ([Player2160.parse]), so the page saves it the same way.
 */
object Embedded2160 {
    /** player-core's media session service: declared disabled in OMP's manifest, switched by «Звук в фоне» (phone only). */
    const val PLAYBACK_SERVICE = "tv.p2160.core.engine.PlaybackService"
    private const val USER_AGENT = "OMP"

    data class Entry(val url: String, val title: String?)

    /** What the request carries; pure, so that it is testable without Android. */
    data class Plan(
        val entries: List<Entry>,
        val startIndex: Int,
        /** Always explicit (0 = from the start): 2160's own resume point never wins over OMP's. */
        val startPositionMs: Long,
        val headers: Map<String, String>,
        /** «Пропуск» marks of the start item (2160's segment format). */
        val segments: String,
    )

    /**
     * [items] are already [Player2160.playable]. Credentials (user:password@, TorrServer auth) leave the URLs and go
     * as an «Authorization: Basic» header, as with the TV engine: Media3 does not send URL user info by itself, and
     * the result's URL then matches the page's queue exactly.
     */
    fun plan(items: List<Player2160.Item>, start: Int, positionMs: Long, fromStart: Boolean, segments: String): Plan {
        var auth: Map<String, String> = emptyMap()
        val entries = items.map { item ->
            val (url, h) = Engine2160.splitCredentials(item.url)
            if (auth.isEmpty()) auth = h
            Entry(url, item.title.trim().ifEmpty { null })
        }
        val idx = start.coerceIn(0, entries.lastIndex)
        val pos = if (fromStart || positionMs <= 0) 0L else positionMs.coerceAtMost(Int.MAX_VALUE.toLong())
        return Plan(entries, idx, pos, auth + ("User-Agent" to USER_AGENT), segments.trim())
    }

    fun request(plan: Plan): PlaybackRequest = PlaybackRequest(
        items = plan.entries.mapIndexed { i, e ->
            MediaEntry(
                uri = Uri.parse(e.url),
                title = e.title,
                segments = if (i == plan.startIndex) SkipSegment.parseList(plan.segments) else emptyList(),
            )
        },
        startIndex = plan.startIndex,
        startPositionMs = plan.startPositionMs,
        headers = plan.headers,
        returnResult = true,
    )

    /** The explicit intent to OMP's own copy of `Player2160Activity` (exported=false: fine in-process). */
    fun intent(context: Context, plan: Plan): Intent = P2160.PlayContract().createIntent(context, request(plan))

    /**
     * «Звук в фоне»: player-core's PlaybackService (notification with controls, lock screen, headset/Bluetooth
     * buttons, the foreground service that keeps sound playing with the screen off) runs only on a phone with the
     * setting on. Android TV never gets it (Engine2160 starts it in runCatching and does without it). Pure.
     */
    fun backgroundOn(isTv: Boolean, setting: Boolean): Boolean = setting && !isTv

    /**
     * Applies [on] before the embedded screen starts: enables or disables PlaybackService (declared disabled in OMP's
     * manifest; DONT_KILL_APP; only when it differs) and sets 2160's «background playback» to match, so that video
     * keeps playing as sound after Home → closing the PiP window or with the screen off. Off = PiP only, as before.
     */
    fun applyBackground(context: Context, on: Boolean) {
        val pm = context.packageManager
        val cn = ComponentName(context, PLAYBACK_SERVICE)
        val wanted = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        runCatching {
            if (pm.getComponentEnabledSetting(cn) != wanted) pm.setComponentEnabledSetting(cn, wanted, PackageManager.DONT_KILL_APP)
        }
        runCatching {
            val settings = PlayerSettings.get(context)
            if (settings.current.backgroundPlayback != on) settings.update { it.copy(backgroundPlayback = on) }
        }
    }
}
