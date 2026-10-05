package com.spacesarmat.omp.player

import com.spacesarmat.omp.I18n

import java.util.Locale
import org.json.JSONObject

/** A span of a queue item (ms): the intro, or a manual intro mark. */
data class Segment(val startMs: Long, val endMs: Long)

/** A chapter of a queue item: its start (ms) and title (may be empty). */
data class ChapterMark(val startMs: Long, val title: String)

/**
 * Chapters and skips of one queue item, sent by the page (src/player/nativeSkip.ts segmentsMessage):
 * `{ type: "segments", index, session, chapters: [{ start, title }], intro?: { start, end }, credits?: { start },
 * autoIntro, autoCredits, mi?: [start, end], mc?, pending? }` in seconds. Its arrival also means that ffprobe
 * answered for the item (CH± fall back to episodes only then, and only without chapters).
 */
data class ItemSkip(
    val index: Int,
    val chapters: List<ChapterMark>,
    val intro: Segment?,
    val creditsMs: Long?,
    val autoIntro: Boolean,
    val autoCredits: Boolean,
    /** Manual marks of the torrent (menu labels): intro «с … до …» and credits «последние N с» (seconds). */
    val markIntro: Segment?,
    val markCreditsS: Long?,
    /** Intro start marked and waiting for its end (ms). */
    val pendingMs: Long?,
) {
    companion object {
        private fun ms(sec: Double): Long? = if (sec.isNaN() || sec.isInfinite() || sec < 0) null else (sec * 1000).toLong()

        /** Null when the index is missing; bad parts (NaN, empty spans) are left out. */
        fun parse(o: JSONObject): ItemSkip? {
            val index = o.optInt("index", -1)
            if (index < 0) return null
            val chapters = ArrayList<ChapterMark>()
            val arr = o.optJSONArray("chapters")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val c = arr.optJSONObject(i) ?: continue
                    val start = ms(c.optDouble("start", Double.NaN)) ?: continue
                    chapters.add(ChapterMark(start, c.optString("title")))
                }
            }
            chapters.sortBy { it.startMs }
            val intro = o.optJSONObject("intro")?.let { seg(it.optDouble("start", Double.NaN), it.optDouble("end", Double.NaN)) }
            val credits = o.optJSONObject("credits")?.let { ms(it.optDouble("start", Double.NaN)) }?.takeIf { it > 0 }
            val mi = o.optJSONArray("mi")?.let { if (it.length() == 2) seg(it.optDouble(0, Double.NaN), it.optDouble(1, Double.NaN)) else null }
            val mc = o.optDouble("mc", Double.NaN).let { if (it.isNaN() || it < 1) null else it.toLong() }
            return ItemSkip(
                index = index,
                chapters = chapters,
                intro = intro,
                creditsMs = credits,
                autoIntro = o.optBoolean("autoIntro", false),
                autoCredits = o.optBoolean("autoCredits", false),
                markIntro = mi,
                markCreditsS = mc,
                pendingMs = ms(o.optDouble("pending", Double.NaN)),
            )
        }

        private fun seg(start: Double, end: Double): Segment? {
            val s = ms(start) ?: return null
            val e = ms(end) ?: return null
            return if (e > s) Segment(s, e) else null
        }
    }
}

/** What CH+ / CH− do. */
sealed class ChapterStep {
    /** ffprobe has not answered yet: the file may have chapters, the key does nothing. */
    object Wait : ChapterStep()
    object NextItem : ChapterStep()
    object PrevItem : ChapterStep()
    object None : ChapterStep()
    data class Seek(val ms: Long) : ChapterStep()
}

/** Chapter rules of the LG player (src/player/chapters.ts), in ms. */
object Chapters {
    /** CH− within this time of a chapter start goes to the previous chapter, later it restarts the current one. */
    const val PREV_WINDOW_MS = 3000L

    /** Index of the chapter playing at [posMs] (the last one that started), -1 before the first. */
    fun indexAt(list: List<ChapterMark>, posMs: Long): Int {
        var idx = -1
        for (i in list.indices) if (list[i].startMs <= posMs) idx = i
        return idx
    }

    /** Where CH+ (dir 1) / CH− (dir -1) go from [posMs]; null when there is nowhere to go. */
    fun target(list: List<ChapterMark>, posMs: Long, dir: Int): Long? {
        if (list.isEmpty()) return null
        val cur = indexAt(list, posMs)
        if (dir > 0) return if (cur + 1 < list.size) list[cur + 1].startMs else null
        if (cur < 0) return 0L
        if (cur > 0 && posMs - list[cur].startMs < PREV_WINDOW_MS) return list[cur - 1].startMs
        return list[cur].startMs
    }

    /** Positions of the ticks on the progress bar (0..1), chapters inside the file only (not at 0). */
    fun ticks(list: List<ChapterMark>, durMs: Long): FloatArray {
        if (durMs <= 0) return FloatArray(0)
        return list.filter { it.startMs in 1 until durMs }.map { it.startMs.toFloat() / durMs }.toFloatArray()
    }

    /** «Глава N «Название»» of the chapter playing (LG title line), empty before the first chapter. */
    fun current(list: List<ChapterMark>, posMs: Long): String {
        val i = indexAt(list, posMs)
        if (i < 0) return ""
        val t = list[i].title
        return I18n.s("player.chapterN", "n" to (i + 1).toString()) + if (t.isNotEmpty()) " «$t»" else ""
    }

    /** «0:00 · Пролог» rows of the «Главы» list («Глава N» for untitled chapters). */
    fun rows(list: List<ChapterMark>): List<String> =
        list.mapIndexed { i, c -> formatClock(c.startMs) + " · " + c.title.ifEmpty { I18n.s("player.chapterN", "n" to (i + 1).toString()) } }
}

/** «1:02:03» / «2:15». */
fun formatClock(ms: Long): String {
    val sec = ms.coerceAtLeast(0L) / 1000
    val h = sec / 3600
    val m = sec / 60 % 60
    val s = sec % 60
    return if (h > 0) String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s)
    else String.format(Locale.ROOT, "%d:%02d", m, s)
}

/** The three «Отметить …» rows of the player menu (as on LG), [nowMs] = position when the menu opened. */
fun markRows(info: ItemSkip?, nowMs: Long, durMs: Long): List<String> {
    val pending = info?.pendingMs
    val mi = info?.markIntro
    val mc = info?.markCreditsS
    val start = when {
        pending != null -> formatClock(pending)
        mi != null -> formatClock(mi.startMs)
        else -> "—"
    }
    val end = if (pending != null) I18n.s("player.markStartVal", "a" to formatClock(pending), "b" to formatClock(nowMs)) else I18n.s("player.markNowVal", "b" to formatClock(nowMs))
    val credits = if (mc != null && durMs > mc * 1000) formatClock(durMs - mc * 1000) else "—"
    return listOf(
        I18n.s("player.markIntroStart", "v" to start),
        I18n.s("player.markIntroEnd", "v" to end),
        I18n.s("player.markCredits", "v" to credits),
    )
}

/**
 * Skips in the native player, pure (no Android), the rules of the LG player (src/screens/Player.tsx):
 * «Пропустить заставку» inside the intro [start, end − 1 s) until skipped or hidden; auto skip of the intro once per
 * visit of an item («Вернуть» does not skip again); credits auto skip only when playback crosses their start (not on
 * open, resume or a seek into them); the «Следующая серия» countdown from the credits start.
 * The per-visit state is reset by [enter] when an item becomes current.
 */
class SkipState {
    private val items = HashMap<Int, ItemSkip>()
    private var hiddenIntro: Long? = null
    private var autoIntroDone = false
    private var autoCreditsDone = false
    private var countdownDismissed = false
    private var lastPosMs = -1L

    /** The page's message for an item (newer replaces older). */
    fun set(info: ItemSkip) {
        items[info.index] = info
    }

    fun clear() {
        items.clear()
        enter()
    }

    fun info(index: Int): ItemSkip? = items[index]

    fun chapters(index: Int): List<ChapterMark> = items[index]?.chapters ?: emptyList()

    /** An item became current (or the queue was loaded): skips start over for it. */
    fun enter() {
        hiddenIntro = null
        autoIntroDone = false
        autoCreditsDone = false
        countdownDismissed = false
        lastPosMs = -1L
    }

    /** A seek: the next position is not a crossing of the credits start. */
    fun seeked() {
        lastPosMs = -1L
    }

    private fun inIntro(s: Segment, posMs: Long): Boolean = posMs >= s.startMs && posMs < s.endMs - END_GAP_MS

    /** «Пропустить заставку» is due at [posMs]. */
    fun skipDue(index: Int, posMs: Long): Boolean {
        val s = items[index]?.intro ?: return false
        return inIntro(s, posMs) && hiddenIntro != s.startMs
    }

    /** OK (skipped) or Back (hidden): the button does not come back for this intro during this visit. */
    fun hideIntro(index: Int) {
        hiddenIntro = items[index]?.intro?.startMs ?: return
    }

    /** Where skipping the intro goes: its end, never past the last second (a manual mark may exceed the file). */
    fun introTarget(index: Int, durMs: Long): Long? {
        val s = items[index]?.intro ?: return null
        return if (durMs > END_GAP_MS) minOf(s.endMs, durMs - END_GAP_MS) else s.endMs
    }

    /** Auto skip on entering the intro: the target to seek to (once per visit), null otherwise. */
    fun autoIntro(index: Int, posMs: Long, durMs: Long): Long? {
        val info = items[index] ?: return null
        val s = info.intro ?: return null
        if (!info.autoIntro || autoIntroDone || !inIntro(s, posMs)) return null
        autoIntroDone = true
        hiddenIntro = s.startMs
        return introTarget(index, durMs)
    }

    /**
     * Credits auto skip: true once when playback ([playing]) moves across the credits start in a small step and
     * there is a next item. Called on every position tick (it remembers the previous position).
     */
    fun creditsCrossed(index: Int, posMs: Long, playing: Boolean, hasNext: Boolean): Boolean {
        val prev = lastPosMs
        lastPosMs = posMs
        val info = items[index] ?: return false
        val cs = info.creditsMs ?: return false
        if (!info.autoCredits || !hasNext || autoCreditsDone || !playing) return false
        if (prev < 0 || prev >= cs || posMs < cs || posMs - prev >= CROSS_MAX_STEP_MS) return false
        autoCreditsDone = true
        return true
    }

    /** The «Следующая серия» countdown is due: inside the known credits of a file longer than a minute. */
    fun countdownDue(index: Int, posMs: Long, durMs: Long): Boolean {
        val cs = items[index]?.creditsMs ?: return false
        if (countdownDismissed || durMs <= MIN_COUNTDOWN_DUR_MS || posMs >= durMs) return false
        return cs in 1 until durMs && posMs >= cs
    }

    /**
     * A running credits countdown stays only while playing inside the credits (LG re-evaluates it on every render):
     * a pause from any source or a seek out of the credits cancels it (it starts again when due).
     */
    fun countdownHolds(index: Int, posMs: Long, durMs: Long, playing: Boolean): Boolean =
        playing && countdownDue(index, posMs, durMs)

    /** Back on the credits countdown: not shown again during this visit. */
    fun dismissCountdown() {
        countdownDismissed = true
    }

    /** CH+ (dir 1) / CH− (dir -1). */
    fun chapterStep(index: Int, posMs: Long, dir: Int): ChapterStep {
        val info = items[index] ?: return ChapterStep.Wait
        if (info.chapters.isEmpty()) return if (dir > 0) ChapterStep.NextItem else ChapterStep.PrevItem
        return Chapters.target(info.chapters, posMs, dir)?.let { ChapterStep.Seek(it) } ?: ChapterStep.None
    }

    companion object {
        const val END_GAP_MS = 1000L
        const val CROSS_MAX_STEP_MS = 5000L
        const val MIN_COUNTDOWN_DUR_MS = 60_000L
    }
}

/**
 * Segments messages of the page queued until the player takes them (the player may not exist yet, or still hold the
 * previous queue); only messages of the current run are accepted. Thread-safe (plugin thread adds, UI thread takes).
 */
class SkipInbox {
    private val items = ArrayList<ItemSkip>()

    /** Queues [s] unless its session [sid] belongs to another run than [current]; true when accepted. */
    fun add(s: ItemSkip, sid: Long?, current: Long?): Boolean {
        if (!sameRun(sid, current)) return false
        synchronized(items) { items.add(s) }
        return true
    }

    /** Messages queued since the last call. */
    fun take(): List<ItemSkip> = synchronized(items) {
        val out = ArrayList(items)
        items.clear()
        out
    }

    /** A new playNative: messages of the previous run are dropped. */
    fun reset() {
        synchronized(items) { items.clear() }
    }

    companion object {
        /** A message without a session, or with no run session known, is taken as the current run's. */
        fun sameRun(sid: Long?, current: Long?): Boolean = sid == null || current == null || sid == current
    }
}
