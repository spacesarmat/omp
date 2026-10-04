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
    /** Saved resume point (resumePosition on the page), used when the player advances to this item. */
    val resumeMs: Long,
)

/** playNative({ queue, index, startAt, session, seekStep, autoNext, audioLang, subLang, subtitlesOn, donate? }). */
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
    /** The «Поддержать» card (pause, credits); null: not shown. */
    val donate: DonateQr? = null,
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
                        resumeMs = it.optDouble("resume", 0.0).let { r -> if (r.isNaN() || r < 0) 0L else (r * 1000).toLong() },
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
                donate = DonateQr.parse(o.optJSONObject("donate")),
            )
        }
    }
}

/**
 * Link between OmpNativePlugin (page side) and the open PlayerActivity: the request to play, the events to
 * the page (`nativePlayerState`, `nativePlayerClosed`, `nativePlayerMark`) and the phone commands to the player.
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

    private val inbox = SkipInbox()

    /** A new playNative: chapters and skips of the previous run are dropped. */
    fun resetSkips() = inbox.reset()

    private fun sessionOf(cmd: JSONObject): Long? = if (cmd.opt("session") is Number) cmd.optLong("session") else null

    /** True when the page's message belongs to the current run (or carries no session). */
    private fun current(cmd: JSONObject): Boolean = SkipInbox.sameRun(sessionOf(cmd), request?.session)

    /**
     * { type: "segments", … } from the page (ItemSkip): chapters and skips of a queue item. Kept until the player
     * takes it (the player may not be created yet, or still be loading the previous queue); messages of another
     * run (session) are ignored. True when accepted.
     */
    fun segments(cmd: JSONObject): Boolean {
        val s = ItemSkip.parse(cmd) ?: return false
        if (!inbox.add(s, sessionOf(cmd), request?.session)) return false
        val p = player
        if (p != null) p.runOnUiThread { p.applySkips() }
        return true
    }

    /** Messages the page sent since the last call. */
    fun takeSkips(): List<ItemSkip> = inbox.take()

    /** { type: "toast", text, error } from the page (the result of a mark): shown by the open player. */
    fun toast(cmd: JSONObject): Boolean {
        val text = cmd.optString("text")
        if (text.isEmpty()) return false
        if (!current(cmd)) return true
        val p = player ?: return true
        val error = cmd.optBoolean("error", false)
        p.runOnUiThread { p.showMessage(text, error) }
        return true
    }

    /** { type: "donate", on: false } from the page (a support code became known): the card is hidden for this run. */
    fun donate(cmd: JSONObject): Boolean {
        if (cmd.optBoolean("on", true)) return true
        if (!current(cmd)) return true
        val p = player ?: return true
        p.runOnUiThread { p.hideDonate() }
        return true
    }

    /** A phone command (src/phone/protocol.ts Cmd); false when no player is open. */
    fun command(cmd: JSONObject): Boolean {
        val p = player ?: return false
        p.runOnUiThread { p.applyCommand(cmd) }
        return true
    }
}
