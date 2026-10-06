package com.spacesarmat.omp.player

import android.content.Intent
import androidx.core.net.toUri
import org.json.JSONObject

/**
 * "Open in another player": an MX Player compatible ACTION_VIEW (also understood by Just Player and mpv) that
 * starts at the saved position and asks the player to hand the watch position back as an activity result.
 */
object ExternalPlayer {
    const val DEFAULT_MIME = "video/*"
    private const val END_COMPLETED = "playback_completion"

    /** What the view intent carries; pure, so that it is testable without Android. */
    data class Spec(val url: String, val mime: String, val extras: Map<String, Any>)

    data class Result(
        val returned: Boolean,
        val positionMs: Long? = null,
        val durationMs: Long? = null,
        val ended: Boolean = false,
    ) {
        fun toJson(): JSONObject {
            val o = JSONObject().put("returned", returned)
            if (!returned) return o
            positionMs?.let { o.put("positionMs", it) }
            durationMs?.let { o.put("durationMs", it) }
            return o.put("ended", ended)
        }
    }

    fun spec(url: String, title: String, positionMs: Long, mime: String?): Spec {
        val extras = LinkedHashMap<String, Any>()
        val name = title.trim()
        if (name.isNotEmpty()) extras["title"] = name
        extras["position"] = positionMs.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
        extras["return_result"] = true
        extras["secure_uri"] = true
        return Spec(url, mime?.trim().orEmpty().ifEmpty { DEFAULT_MIME }, extras)
    }

    /** The view intent wrapped in a chooser titled [chooserTitle]; the chooser forwards the player's result. */
    fun intent(url: String, title: String, positionMs: Long, mime: String?, chooserTitle: String): Intent {
        val s = spec(url, title, positionMs, mime)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(s.url.toUri(), s.mime)
        for ((k, v) in s.extras) {
            when (v) {
                is Int -> view.putExtra(k, v)
                is Boolean -> view.putExtra(k, v)
                is String -> view.putExtra(k, v)
            }
        }
        return Intent.createChooser(view, chooserTitle)
    }

    /**
     * Reads "position", "duration" (Int or Long, ms) and "end_by" (MX Player, Just Player, mpv), with VLC's
     * "extra_position" / "extra_duration" as fallbacks; nothing usable → returned = false.
     */
    fun parseExtras(resultCode: Int, extras: Map<String, Any?>?): Result {
        if (extras == null) return Result(false)
        val position = millis(extras["position"]) ?: millis(extras["extra_position"])
        val duration = millis(extras["duration"]) ?: millis(extras["extra_duration"])
        val ended = extras["end_by"] == END_COMPLETED
        if (position == null && !ended) return Result(false)
        return Result(true, position, duration, ended)
    }

    fun parse(resultCode: Int, data: Intent?): Result {
        val b = data?.extras ?: return Result(false)
        val map = HashMap<String, Any?>()
        for (k in KEYS) {
            @Suppress("DEPRECATION")
            if (b.containsKey(k)) map[k] = b.get(k)
        }
        return parseExtras(resultCode, map)
    }

    private val KEYS = listOf("position", "duration", "end_by", "extra_position", "extra_duration")

    private fun millis(v: Any?): Long? = when (v) {
        is Int -> v.toLong()
        is Long -> v
        else -> null
    }?.takeIf { it >= 0 }
}
