package com.spacesarmat.omp.player

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Parcelable
import androidx.core.net.toUri
import org.json.JSONObject

/**
 * Launches 2160 Player (explicit component, no chooser) with the saved position, skip segments and a playlist,
 * and reads back where playback stopped.
 */
object Player2160 {
    val PACKAGES = listOf("tv.p2160.player", "tv.p2160.player.debug")
    const val ACTIVITY = "tv.p2160.core.Player2160Activity"
    private const val END_COMPLETED = "playback_completion"

    /** The first installed 2160 Player package (release before debug), or null. */
    fun installed(pm: PackageManager): String? = PACKAGES.firstOrNull { pkg ->
        try {
            if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(0))
            else @Suppress("DEPRECATION") pm.getPackageInfo(pkg, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    data class Item(val url: String, val title: String)

    /** What the intent carries besides the Uri playlist; pure, so that it is testable without Android. */
    data class Spec(val url: String, val extras: Map<String, Any>)

    data class Result(
        val returned: Boolean,
        val positionMs: Long? = null,
        val durationMs: Long? = null,
        val ended: Boolean = false,
        val url: String? = null,
    ) {
        fun toJson(): JSONObject {
            val o = JSONObject().put("returned", returned)
            if (!returned) return o
            positionMs?.let { o.put("positionMs", it) }
            durationMs?.let { o.put("durationMs", it) }
            url?.let { o.put("url", it) }
            return o.put("ended", ended)
        }
    }

    fun spec(items: List<Item>, start: Int, positionMs: Long, fromStart: Boolean, segments: String): Spec {
        val cur = items[start.coerceIn(0, items.lastIndex)]
        val extras = LinkedHashMap<String, Any>()
        val name = cur.title.trim()
        if (name.isNotEmpty()) extras["title"] = name
        if (fromStart) extras["from_start"] = true
        else if (positionMs > 0) extras["position"] = positionMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        if (segments.isNotBlank()) extras["tv.p2160.extra.SEGMENTS"] = segments
        if (items.size > 1) extras["video_list.name"] = items.map { it.title }.toTypedArray()
        extras["return_result"] = true
        return Spec(cur.url, extras)
    }

    fun intent(pkg: String, spec: Spec, urls: List<String>): Intent {
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(spec.url.toUri(), "video/*")
            .setComponent(ComponentName(pkg, ACTIVITY))
        for ((k, v) in spec.extras) {
            when (v) {
                is Int -> i.putExtra(k, v)
                is Boolean -> i.putExtra(k, v)
                is String -> i.putExtra(k, v)
                is Array<*> -> @Suppress("UNCHECKED_CAST") i.putExtra(k, v as Array<String>)
            }
        }
        if (urls.size > 1) i.putExtra("video_list", urls.map { it.toUri() }.toTypedArray<Parcelable>())
        return i
    }

    /** "position"/"duration" (Int or Long, ms) with VLC's "extra_*" as fallback; "end_by" tells how it ended. */
    fun parseExtras(extras: Map<String, Any?>?, dataUrl: String?): Result {
        if (extras == null) return Result(false)
        val position = millis(extras["position"]) ?: millis(extras["extra_position"])
        val duration = millis(extras["duration"]) ?: millis(extras["extra_duration"])
        val ended = extras["end_by"] == END_COMPLETED
        if (position == null && !ended) return Result(false)
        return Result(true, position, duration, ended, dataUrl)
    }

    fun parse(resultCode: Int, data: Intent?): Result {
        if (resultCode != Activity.RESULT_OK) return Result(false)
        val b = data?.extras ?: return Result(false)
        val map = HashMap<String, Any?>()
        for (k in KEYS) {
            @Suppress("DEPRECATION")
            if (b.containsKey(k)) map[k] = b.get(k)
        }
        return parseExtras(map, data.dataString)
    }

    private val KEYS = listOf("position", "duration", "end_by", "extra_position", "extra_duration")

    private fun millis(v: Any?): Long? = when (v) {
        is Int -> v.toLong()
        is Long -> v
        else -> null
    }?.takeIf { it >= 0 }
}
