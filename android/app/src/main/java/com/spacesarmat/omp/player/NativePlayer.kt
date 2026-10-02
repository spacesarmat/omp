package com.spacesarmat.omp.player

import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject

/** External subtitle file of a queue item (`ext` decides the MIME type, `lang` is a guess from the name). */
data class SubFile(val url: String, val label: String, val ext: String, val lang: String)

data class QueueItem(
    val url: String,
    val title: String,
    val hash: String?,
    val fileIndex: Int?,
    val subtitles: List<SubFile>,
)

/** playNative({ queue, index, startAt, session, seekStep, autoNext, audioLang, subLang, subtitlesOn }). */
data class PlayRequest(
    val queue: List<QueueItem>,
    val index: Int,
    val startAtMs: Long,
    val seekStep: Int,
    val autoNext: Boolean,
    val audioLang: String,
    val subLang: String,
    val subtitlesOn: Boolean,
    /** Echoed in every event so that the page tells runs apart (a new playNative takes an open player over). */
    val session: Long?,
) {
    companion object {
        /** Null when the queue is empty or malformed. */
        fun parse(o: JSONObject): PlayRequest? {
            val arr = o.optJSONArray("queue") ?: return null
            val queue = ArrayList<QueueItem>()
            for (i in 0 until arr.length()) {
                val it = arr.optJSONObject(i) ?: return null
                val url = it.optString("url")
                if (url.isEmpty()) return null
                val subs = ArrayList<SubFile>()
                val sa = it.optJSONArray("subtitles") ?: JSONArray()
                for (j in 0 until sa.length()) {
                    val s = sa.optJSONObject(j) ?: continue
                    subs.add(SubFile(s.optString("url"), s.optString("label"), s.optString("ext"), s.optString("lang")))
                }
                queue.add(
                    QueueItem(
                        url = url,
                        title = it.optString("title"),
                        hash = it.optString("hash").ifEmpty { null },
                        fileIndex = if (it.has("fileIndex")) it.optInt("fileIndex") else null,
                        subtitles = subs,
                    ),
                )
            }
            if (queue.isEmpty()) return null
            val start = o.optDouble("startAt", 0.0).let { if (it.isNaN() || it < 0) 0.0 else it }
            return PlayRequest(
                queue = queue,
                index = o.optInt("index", 0).coerceIn(0, queue.size - 1),
                startAtMs = (start * 1000).toLong(),
                seekStep = o.optInt("seekStep", 10).coerceIn(1, 600),
                autoNext = o.optBoolean("autoNext", true),
                audioLang = o.optString("audioLang"),
                subLang = o.optString("subLang"),
                subtitlesOn = o.optBoolean("subtitlesOn", false),
                session = if (o.opt("session") is Number) o.optLong("session") else null,
            )
        }
    }
}

/**
 * Link between OmpNativePlugin (page side) and the open PlayerActivity: the request to play, the events to
 * the page (`nativePlayerState`, `nativePlayerClosed`) and the phone commands to the player.
 */
object NativePlayerBridge {
    @Volatile
    var request: PlayRequest? = null

    @Volatile
    var player: PlayerActivity? = null

    /** Set by the plugin: delivers an event to the page listeners. */
    @Volatile
    var emitter: ((String, JSObject) -> Unit)? = null

    fun emit(event: String, data: JSObject) {
        emitter?.invoke(event, data)
    }

    /** A phone command (src/phone/protocol.ts Cmd); false when no player is open. */
    fun command(cmd: JSONObject): Boolean {
        val p = player ?: return false
        p.runOnUiThread { p.applyCommand(cmd) }
        return true
    }
}

/** Step for repeated ◀/▶ presses, as the LG player's double press: base, 2×base (≤ 30), then 30 s. */
fun streakStep(base: Int, streak: Int): Int = when {
    streak <= 0 -> base
    streak == 1 -> minOf(base * 2, 30)
    else -> 30
}

/** Port of src/player/pointerTaps.ts SeekStreak: the streak resets after [resetMs] idle or a direction change. */
class SeekStreak(private val resetMs: Long = 2000, private val now: () -> Long = { android.os.SystemClock.uptimeMillis() }) {
    private var count = 0
    private var lastAt = Long.MIN_VALUE / 2
    private var dir = 0

    fun next(direction: Int, base: Int): Int {
        val t = now()
        if (direction != dir || t - lastAt > resetMs) count = 0 else count++
        dir = direction
        lastAt = t
        return streakStep(base, count)
    }

    fun reset() {
        count = 0
        dir = 0
        lastAt = Long.MIN_VALUE / 2
    }
}
