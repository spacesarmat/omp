package com.spacesarmat.omp.player

import org.json.JSONArray
import java.util.Locale

/**
 * One step of the start order («Озвучка», nativeTrackStart on the page): a track by [label] (with [lang] its language
 * when known), else by [lang] alone; [off] turns the subtitles off. The first step that finds a track wins.
 */
data class TrackPick(val label: String = "", val lang: String = "", val off: Boolean = false) {
    companion object {
        /** `[{ l?, g?, off? }]` of playNative; malformed or empty steps are dropped. */
        fun parseList(a: JSONArray?): List<TrackPick> {
            if (a == null) return emptyList()
            val out = ArrayList<TrackPick>()
            for (i in 0 until minOf(a.length(), 16)) {
                val o = a.optJSONObject(i) ?: continue
                if (o.optBoolean("off", false)) {
                    out.add(TrackPick(off = true))
                    continue
                }
                val l = o.optString("l").trim().take(PlayRequest.LABEL_MAX)
                val g = o.optString("g").trim().take(16)
                if (l.isNotEmpty() || g.isNotEmpty()) out.add(TrackPick(l, g))
            }
            return out
        }

        /** The steps carrying a choice made by hand: its title, then its language. */
        fun of(label: String, lang: String): List<TrackPick> {
            val out = ArrayList<TrackPick>()
            if (label.isNotEmpty()) out.add(TrackPick(label, lang))
            if (lang.isNotEmpty()) out.add(TrackPick("", lang))
            return out
        }
    }
}

/**
 * «Озвучка» of a series (src/lib/seriesTracks.ts on the page): tracks are picked by their title (the dub: «LostFilm»,
 * «HDrezka Studio») or by language, in the order of the [TrackPick] steps. Titles compare like sameDub on the page:
 * lowercase, ё → е, punctuation collapsed, equal or the shorter (3+ characters) a whole-word part of the longer. A
 * title made only of codec names («SUBRIP», «PCM_S16LE 2.0») names nothing. Pure.
 */
object DubMatch {
    /** [pickSub] result: the subtitles are to be off. */
    const val OFF = -2

    private val NON_WORD = Regex("[^0-9a-zа-я]+")
    private val SPLIT = Regex("[\\s·|/,()\\-]+")
    private val CODEC_WORD = Regex(
        "^(?:aac|he|lc|ac3|eac3|ec3|e|ac|dts|hd|ma|es|x|truehd|thd|mlp|flac|alac|opus|mp3|mp2|mpeg|lpcm|pcm|pcm_[a-z0-9_]+|" +
            "vorbis|atmos|dd|ddp|dd\\+|wma|wmapro|amr|subrip|srt|ass|ssa|pgs|hdmv_pgs_subtitle|sup|vobsub|dvd_subtitle|dvdsub|" +
            "dvb_subtitle|dvb_sub|dvbsub|dvb_teletext|webvtt|vtt|tx3g|mov_text|text|eia_608|cc|mono|stereo|surround|" +
            "\\d\\.\\d|\\d+ch|\\d+(?:k|kbps)|\\d+(?:hz|khz)|\\d+bit)$",
    )

    fun norm(s: String?): String = (s ?: "").lowercase(Locale.ROOT).replace('ё', 'е').replace(NON_WORD, " ").trim()

    /** Only codec / format / channel names: no dub. */
    fun isCodecLabel(s: String?): Boolean {
        val words = (s ?: "").lowercase(Locale.ROOT).split(SPLIT).filter { it.isNotEmpty() }
        return words.isNotEmpty() && words.all { CODEC_WORD.matches(it) }
    }

    /** The title of a track as a dub / subtitle title: '' when absent or only a codec name. */
    fun title(s: String?): String {
        val t = s?.trim().orEmpty()
        return if (isCodecLabel(t)) "" else t
    }

    fun same(a: String?, b: String?): Boolean {
        val x = norm(title(a))
        val y = norm(title(b))
        if (x.isEmpty() || y.isEmpty()) return false
        if (x == y) return true
        val short = if (x.length <= y.length) x else y
        val long = if (x.length <= y.length) y else x
        if (short.length < 3) return false
        return " $long ".contains(" $short ")
    }

    /** «ru», «rus», «russian» → one key («rus»); null for «und», empty or unknown. */
    fun langKey(code: String?): String? {
        val c = code?.trim()?.lowercase(Locale.ROOT).orEmpty()
        if (c.isEmpty() || c == "und") return null
        val base = c.split('-', '_')[0]
        return try {
            Locale(base).isO3Language.ifEmpty { base }
        } catch (e: Exception) {
            base
        }
    }

    fun sameLang(a: String?, b: String?): Boolean {
        val x = langKey(a) ?: return false
        return x == langKey(b)
    }

    /** Both languages known: they must be the same; one unknown: any. */
    private fun langOk(a: String?, b: String?): Boolean {
        val x = langKey(a) ?: return true
        val y = langKey(b) ?: return true
        return x == y
    }

    /** Index in [tracks] of the first step that finds an audio track (title, else language); -1 when none does. */
    fun pickAudio(tracks: List<EngineTrack>, picks: List<TrackPick>): Int {
        for (p in picks) {
            if (p.off) continue
            val i = if (p.label.isNotEmpty()) tracks.indexOfFirst { same(it.label, p.label) }
            else tracks.indexOfFirst { sameLang(it.language, p.lang) }
            if (i >= 0) return i
        }
        return -1
    }

    /** The dub [label], else the language [lang]. */
    fun pickAudio(tracks: List<EngineTrack>, label: String, lang: String): Int = pickAudio(tracks, TrackPick.of(label, ""))
        .takeIf { it >= 0 } ?: pickAudio(tracks, TrackPick.of("", lang))

    /**
     * Index in [tracks] of the first step that finds subtitles: by title (an embedded track's title, or the name of
     * the item's file in [files]; the language must agree when both are known), else by language; [OFF] when an «off»
     * step comes first; -1 when no step decides.
     */
    fun pickSub(tracks: List<EngineTrack>, files: List<SubFile>, picks: List<TrackPick>): Int {
        for (p in picks) {
            if (p.off) return OFF
            val i = if (p.label.isNotEmpty()) tracks.indexOfFirst { same(titleOf(it, files), p.label) && langOk(langOf(it, files), p.lang) }
            else tracks.indexOfFirst { sameLang(langOf(it, files), p.lang) }
            if (i >= 0) return i
        }
        return -1
    }

    /** Subtitles titled [label] (same language when both are known), else in the language [lang]. */
    fun pickSub(tracks: List<EngineTrack>, files: List<SubFile>, label: String, lang: String): Int =
        pickSub(tracks, files, TrackPick.of(label, lang))

    /** The title of a subtitle track: the file name for one of the item's files. */
    fun titleOf(t: EngineTrack, files: List<SubFile>): String =
        t.external?.let { files.getOrNull(it)?.label } ?: title(t.label)

    /** The language of a subtitle track: the guess from the name for one of the item's files. */
    fun langOf(t: EngineTrack, files: List<SubFile>): String =
        t.language?.takeIf { it.isNotEmpty() && it != "und" } ?: t.external?.let { files.getOrNull(it)?.lang }.orEmpty()

    /** The dubs of a file (title + language, titled tracks only, no codec names, no repeats): the series screen's choices. */
    fun seen(tracks: List<EngineTrack>): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        for (t in tracks) {
            val l = title(t.label)
            if (l.isEmpty() || out.any { same(it.first, l) }) continue
            out.add(l to t.language.orEmpty())
        }
        return out
    }
}
