package com.spacesarmat.omp.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import tv.p2160.core.api.MediaEntry
import tv.p2160.core.api.PlaybackRequest
import tv.p2160.core.api.SkipSegment
import tv.p2160.core.api.Player2160 as P2160

/**
 * Phone: «Смотреть на телефоне» in 2160 Player's own screen inside OMP (player-core's `Player2160Activity`, launched
 * in-process through `Player2160.PlayContract`'s intent). The answer is the same MX-style result as the 2160 Player
 * app's ([Player2160.parse]), so the page saves it the same way.
 */
object Embedded2160 {
    /** player-core's media session service: declared disabled in OMP's manifest, switched on here (phone only). */
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
     * Turns player-core's PlaybackService on (once; kept across restarts): the notification with controls, lock
     * screen and headset buttons, and a foreground service while audio (or video with 2160's «background playback»)
     * plays with the screen off. It stays off on Android TV, where Engine2160 does not need it.
     */
    fun enablePlaybackService(context: Context) {
        val pm = context.packageManager
        val cn = ComponentName(context, PLAYBACK_SERVICE)
        runCatching {
            if (pm.getComponentEnabledSetting(cn) != PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                pm.setComponentEnabledSetting(cn, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
            }
        }
    }
}
