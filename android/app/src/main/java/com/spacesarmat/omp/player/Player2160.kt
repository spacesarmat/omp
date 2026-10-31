package com.spacesarmat.omp.player

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Parcelable
import androidx.core.net.toUri
import org.json.JSONArray
import org.json.JSONObject

/**
 * Launches 2160 Player (explicit component, no chooser) with the saved position, skip segments and a playlist,
 * and reads back where playback stopped.
 */
object Player2160 {
    val PACKAGES = listOf("tv.p2160.player", "tv.p2160.player.debug")
    const val ACTIVITY = "tv.p2160.core.Player2160Activity"
    private const val END_COMPLETED = "playback_completion"

    /**
     * The page's extras (external tracks, 2160 Player API §3.7) and the result keys it asks for are taken only under
     * this prefix. The key names themselves live on the page (src/player/externalTracks.ts), so a change of the
     * player's format needs no change here. Values are String or String[] (AUDIO_TRACKS / TEXT_TRACKS: one JSON array
     * per playlist item); the result's AUDIO_* / TEXT_* come back as String, Boolean or Int (2160 Player 0.2.17).
     */
    const val EXTRA_PREFIX = "tv.p2160.extra."

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
        /** The asked result extras the player handed back (String, Boolean, Int or Long). */
        val extras: Map<String, Any> = emptyMap(),
    ) {
        fun toJson(): JSONObject {
            val o = JSONObject().put("returned", returned)
            if (!returned) return o
            positionMs?.let { o.put("positionMs", it) }
            durationMs?.let { o.put("durationMs", it) }
            url?.let { o.put("url", it) }
            if (extras.isNotEmpty()) {
                val e = JSONObject()
                for ((k, v) in extras) e.put(k, v)
                o.put("extras", e)
            }
            return o.put("ended", ended)
        }
    }

    /** The page's extra Intent extras: String or String[] values under [EXTRA_PREFIX]; anything else is dropped. */
    fun pageExtras(raw: JSONObject?): Map<String, Any> {
        val out = LinkedHashMap<String, Any>()
        if (raw == null) return out
        val keys = raw.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (!k.startsWith(EXTRA_PREFIX) || k.length == EXTRA_PREFIX.length) continue
            when (val v = raw.opt(k)) {
                is String -> out[k] = v
                is JSONArray -> {
                    val arr = Array(v.length()) { i -> v.opt(i) as? String }
                    if (arr.all { it != null }) out[k] = arr.map { it!! }.toTypedArray()
                }
            }
        }
        return out
    }

    /** The result keys the page asks for, only under [EXTRA_PREFIX]. */
    fun resultKeys(raw: JSONArray?): List<String> {
        if (raw == null) return emptyList()
        return (0 until raw.length()).mapNotNull { raw.opt(it) as? String }
            .filter { it.startsWith(EXTRA_PREFIX) && it.length > EXTRA_PREFIX.length }
            .distinct()
    }

    /** Adds the page's extras to a launch intent (2160 Player app, or the embedded screen's intent). */
    fun putPageExtras(i: Intent, extras: Map<String, Any>): Intent {
        for ((k, v) in extras) {
            when (v) {
                is String -> i.putExtra(k, v)
                is Array<*> -> @Suppress("UNCHECKED_CAST") i.putExtra(k, v as Array<String>)
            }
        }
        return i
    }

    /** Drops items without a url keeping the order; start is remapped to the start item's new index, null when it has none. */
    fun playable(items: List<Item>, start: Int): Pair<List<Item>, Int>? {
        val cur = items.getOrNull(start) ?: return null
        if (cur.url.isBlank()) return null
        val kept = items.filter { it.url.isNotBlank() }.map { it.copy(url = it.url.trim()) }
        val idx = items.subList(0, start).count { it.url.isNotBlank() }
        return kept to idx
    }

    fun spec(
        items: List<Item>,
        start: Int,
        positionMs: Long,
        fromStart: Boolean,
        segments: String,
        page: Map<String, Any> = emptyMap(),
    ): Spec {
        val cur = items[start.coerceIn(0, items.lastIndex)]
        val extras = LinkedHashMap<String, Any>()
        val name = cur.title.trim()
        if (name.isNotEmpty()) extras["title"] = name
        if (fromStart) extras["from_start"] = true
        else if (positionMs > 0) extras["position"] = positionMs.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
        if (segments.isNotBlank()) extras["tv.p2160.extra.SEGMENTS"] = segments
        if (items.size > 1) extras["video_list.name"] = items.map { it.title }.toTypedArray()
        // the page's own (external tracks) never replace the extras above
        for ((k, v) in page) if (!extras.containsKey(k)) extras[k] = v
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

    /**
     * Position and duration: the Long keys of API 3.4 (`tv.p2160.extra.POSITION` / `DURATION`), then VLC's
     * `extra_*`, then MX `position` / `duration`. A positive value wins over a zero in an earlier key.
     * `tv.p2160.extra.WATCHED` or `end_by=playback_completion` means the player says it finished. A missing
     * position is still returned (the page decides whether that is a real finish).
     */
    fun parseExtras(extras: Map<String, Any?>?, dataUrl: String?, asked: List<String> = emptyList()): Result {
        if (extras == null) return Result(false)
        val position = bestMillis(extras, POSITION_KEYS)
        val duration = bestMillis(extras, DURATION_KEYS)
        val ended = extras["tv.p2160.extra.WATCHED"] == true || extras["end_by"] == END_COMPLETED
        if (position == null && !ended) return Result(false)
        val more = LinkedHashMap<String, Any>()
        for (k in asked) {
            when (val v = extras[k]) {
                is String -> more[k] = v
                is Boolean -> more[k] = v
                is Int -> more[k] = v
                is Long -> more[k] = v
            }
        }
        return Result(true, position, duration, ended, dataUrl, more)
    }

    fun parse(resultCode: Int, data: Intent?, asked: List<String> = emptyList()): Result {
        if (resultCode != Activity.RESULT_OK) return Result(false)
        val b = data?.extras ?: return Result(false)
        val map = HashMap<String, Any?>()
        for (k in KEYS + asked) {
            @Suppress("DEPRECATION")
            if (b.containsKey(k)) map[k] = b.get(k)
        }
        return parseExtras(map, data.dataString, asked)
    }

    private val KEYS = listOf(
        "position", "duration", "end_by", "extra_position", "extra_duration",
        "tv.p2160.extra.POSITION", "tv.p2160.extra.DURATION", "tv.p2160.extra.WATCHED",
    )
    private val POSITION_KEYS = listOf("tv.p2160.extra.POSITION", "extra_position", "position")
    private val DURATION_KEYS = listOf("tv.p2160.extra.DURATION", "extra_duration", "duration")

    /** The first positive millis among [keys], or a zero when that is all the player sent. */
    private fun bestMillis(extras: Map<String, Any?>, keys: List<String>): Long? {
        var zero: Long? = null
        for (k in keys) {
            val v = millis(extras[k]) ?: continue
            if (v > 0) return v
            if (zero == null) zero = v
        }
        return zero
    }

    private fun millis(v: Any?): Long? = when (v) {
        is Int -> v.toLong()
        is Long -> v
        else -> null
    }?.takeIf { it >= 0 }
}
