package com.spacesarmat.omp.player

import java.util.Locale

/**
 * «Озвучка» of a series (src/lib/seriesTracks.ts on the page): the track to start with is picked by its title (the dub:
 * «LostFilm», «HDrezka Studio») first, then by language. Titles compare like sameDub on the page: lowercase, ё → е,
 * punctuation collapsed, equal or the shorter (3+ characters) a whole-word part of the longer. Pure.
 */
object DubMatch {
    private val NON_WORD = Regex("[^0-9a-zа-я]+")

    fun norm(s: String?): String = (s ?: "").lowercase(Locale.ROOT).replace('ё', 'е').replace(NON_WORD, " ").trim()

    fun same(a: String?, b: String?): Boolean {
        val x = norm(a)
        val y = norm(b)
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

    /** Index in [tracks] of the dub [label], else of the language [lang]; -1 when neither is there. */
    fun pickAudio(tracks: List<EngineTrack>, label: String, lang: String): Int {
        if (label.isNotEmpty()) {
            val i = tracks.indexOfFirst { same(it.label, label) }
            if (i >= 0) return i
        }
        if (lang.isNotEmpty()) return tracks.indexOfFirst { sameLang(it.language, lang) }
        return -1
    }

    /**
     * Index in [tracks] of the subtitles titled [label] (an embedded track's title, or the name of the item's file in
     * [files]), else of the language [lang]; -1 when neither is there.
     */
    fun pickSub(tracks: List<EngineTrack>, files: List<SubFile>, label: String, lang: String): Int {
        if (label.isNotEmpty()) {
            val i = tracks.indexOfFirst { same(titleOf(it, files), label) }
            if (i >= 0) return i
        }
        if (lang.isNotEmpty()) return tracks.indexOfFirst { sameLang(langOf(it, files), lang) }
        return -1
    }

    /** The title of a subtitle track: the file name for one of the item's files. */
    fun titleOf(t: EngineTrack, files: List<SubFile>): String =
        t.external?.let { files.getOrNull(it)?.label } ?: t.label.orEmpty()

    /** The language of a subtitle track: the guess from the name for one of the item's files. */
    fun langOf(t: EngineTrack, files: List<SubFile>): String =
        t.language?.takeIf { it.isNotEmpty() && it != "und" } ?: t.external?.let { files.getOrNull(it)?.lang }.orEmpty()

    /** The dubs of a file (title + language, titled tracks only, no repeats): the choices of the series screen. */
    fun seen(tracks: List<EngineTrack>): List<Pair<String, String>> {
        val out = ArrayList<Pair<String, String>>()
        for (t in tracks) {
            val l = t.label?.trim().orEmpty()
            if (l.isEmpty() || out.any { same(it.first, l) }) continue
            out.add(l to t.language.orEmpty())
        }
        return out
    }
}
