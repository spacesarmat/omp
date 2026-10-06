package com.spacesarmat.omp.player

import java.util.Locale

/**
 * The pure parts of [VlcEngine] (JVM-tested): language codes, codec names, track names, the start option, error
 * kinds and the track choice by preferences.
 */
object VlcSupport {
    /** The video layout has a size libVLC can draw into (attached at 0×0 it logs «Invalid surface size»). */
    fun surfaceReady(width: Int, height: Int): Boolean = width > 0 && height > 0

    /** ISO 639-2/B codes Locale does not know as ISO3 (it knows the /T ones: «deu», «fra», «zho», …). */
    private val BIBLIOGRAPHIC = mapOf(
        "alb" to "sq", "arm" to "hy", "baq" to "eu", "bur" to "my", "chi" to "zh", "cze" to "cs", "dut" to "nl",
        "fre" to "fr", "geo" to "ka", "ger" to "de", "gre" to "el", "ice" to "is", "mac" to "mk", "mao" to "mi",
        "may" to "ms", "per" to "fa", "rum" to "ro", "slo" to "sk", "tib" to "bo", "wel" to "cy",
    )

    /** Three-letter codes and English / Russian names → two-letter codes (built once from Locale). */
    private val LANGS: Map<String, String> by lazy {
        val m = HashMap<String, String>()
        val ru = Locale.forLanguageTag("ru")
        for (code in Locale.getISOLanguages()) {
            val l = Locale.forLanguageTag(code)
            try {
                m.putIfAbsent(l.isO3Language.lowercase(Locale.ROOT), code)
            } catch (_: java.util.MissingResourceException) {
            }
            l.getDisplayLanguage(Locale.ENGLISH).lowercase(Locale.ROOT).takeIf { it.isNotEmpty() && it != code }?.let { m.putIfAbsent(it, code) }
            l.getDisplayLanguage(ru).lowercase(ru).takeIf { it.isNotEmpty() && it != code }?.let { m.putIfAbsent(it, code) }
        }
        m.putAll(BIBLIOGRAPHIC)
        m
    }

    /**
     * A language as VLC reports it («rus», «ru», «Russian», «ru-RU») → the two-letter code («ru»); null for «und»,
     * empty or unknown values (Media3 reports two-letter codes, the track labels and the carried-over choices
     * compare them).
     */
    fun lang(s: String?): String? {
        val k = s?.trim()?.lowercase(Locale.ROOT).orEmpty()
        if (k.isEmpty() || k == "und" || k == "mul" || k == "zxx") return null
        val base = k.split('-', '_')[0]
        if (base.length == 2 && base.all { it in 'a'..'z' }) return base
        return LANGS[base] ?: LANGS[k]
    }

    /** A VLC fourcc («a52 », «dts », «mp4a») → the short display name used by Media3 tracks too. */
    fun codecName(fourcc: String?): String = when (fourcc?.trim()?.lowercase(Locale.ROOT)) {
        "a52", "ac3", "ac-3" -> "AC3"
        "eac3", "ec-3" -> "E-AC3"
        "ac-4", "ac4" -> "AC4"
        "dts", "dtsh", "dtsl" -> "DTS"
        "mlp", "trhd", "truehd" -> "TrueHD"
        "mp4a", "aac" -> "AAC"
        "mpga", "mp3", "mp2", "mp2a" -> "MP3"
        "opus" -> "Opus"
        "flac" -> "FLAC"
        "vorb" -> "Vorbis"
        else -> ""
    }

    /** Language and title from a VLC track name: «Дубляж - [Russian]», «Track 2 - [English]», «Russian». */
    data class NameInfo(val language: String?, val label: String?)

    private val BRACKET = Regex("^(.*?)\\s*-\\s*\\[([^\\]]+)]\\s*$")
    private val GENERIC = Regex("^(track|дорожка|subtitle|субтитры)\\s*\\d+$", RegexOption.IGNORE_CASE)

    fun parseName(name: String?): NameInfo {
        val n = name?.trim().orEmpty()
        if (n.isEmpty()) return NameInfo(null, null)
        val m = BRACKET.find(n)
        if (m != null) {
            val title = m.groupValues[1].trim()
            return NameInfo(lang(m.groupValues[2]), title.takeIf { it.isNotEmpty() && !GENERIC.matches(it) })
        }
        if (GENERIC.matches(n)) return NameInfo(null, null)
        val l = lang(n)
        return if (l != null) NameInfo(l, null) else NameInfo(null, n)
    }

    /** The file name of a subtitle URL («Show.S01E01.rus.srt»): last path segment, decoded, without the query. */
    fun fileName(url: String): String {
        val path = url.substringBefore('?').substringBefore('#').trimEnd('/')
        val last = path.substringAfterLast('/')
        return try {
            java.net.URLDecoder.decode(last.replace("+", "%2B"), "UTF-8")
        } catch (_: IllegalArgumentException) {
            last
        }
    }

    /**
     * The item's subtitle file a new subtitle ES belongs to: the one whose file name (with its extension) is in the
     * track [name], else the file being added ([inFlight]); null: not a file (an ES of the media itself). Files
     * already matched ([taken]) are skipped.
     */
    fun externalFor(name: String?, files: List<SubFile>, inFlight: Int?, taken: Collection<Int>): Int? {
        val n = name?.lowercase(Locale.ROOT).orEmpty()
        if (n.isNotEmpty()) {
            files.forEachIndexed { i, f ->
                if (i in taken) return@forEachIndexed
                val base = fileName(f.url).lowercase(Locale.ROOT)
                if (base.length >= 5 && base.contains('.') && n.contains(base)) return i
            }
        }
        return inFlight?.takeIf { it !in taken }
    }

    /** The media option that opens the item at [ms] (seconds, dot decimal). */
    fun startOption(ms: Long): String = ":start-time=" + String.format(Locale.ROOT, "%.3f", ms / 1000.0)

    /**
     * EncounteredError has no code: after the demuxer opened the file ([opened]: tracks were found) without
     * reaching playback it is the format; otherwise (not reachable, broke while playing) a generic error.
     */
    fun errorKind(opened: Boolean, played: Boolean): ErrorKind =
        if (opened && !played) ErrorKind.UNSUPPORTED_FORMAT else ErrorKind.OTHER

    /** A choice the user made in the menu, carried to the next items (as Media3's overrides are). */
    sealed class Choice {
        object Off : Choice()
        data class Track(val language: String?, val label: String?, val external: Int?) : Choice()
    }

    fun choiceOf(t: EngineTrack?): Choice = if (t == null) Choice.Off else Choice.Track(t.language, t.label, t.external)

    private fun matches(t: EngineTrack, c: Choice.Track): Boolean =
        if (c.external != null) t.external == c.external else t.external == null && t.language == c.language && t.label == c.label

    /** The audio track to select: the user's choice, else the preferred language; null: keep VLC's own. */
    fun pickAudio(tracks: List<EngineTrack>, choice: Choice?, prefLang: String): EngineTrack? {
        if (choice is Choice.Track) tracks.firstOrNull { matches(it, choice) }?.let { return it }
        val want = lang(prefLang) ?: return null
        return tracks.firstOrNull { it.language == want }
    }

    /** What to do with the subtitles: [off], select [track], or nothing yet ([track] null and not [off]). */
    data class SubPick(val off: Boolean, val track: EngineTrack?)

    /**
     * The subtitle decision: the user's choice (off, or the same file / language + title), else off unless
     * subtitles are on, else the preferred language (embedded first, then the files), else VLC's own choice.
     */
    fun pickSub(tracks: List<EngineTrack>, choice: Choice?, prefs: TrackPrefs): SubPick {
        when (choice) {
            Choice.Off -> return SubPick(true, null)
            is Choice.Track -> tracks.firstOrNull { matches(it, choice) }?.let { return SubPick(false, it) }
            null -> Unit
        }
        if (!prefs.subtitlesOn && choice == null) return SubPick(true, null)
        val want = lang(prefs.subLang) ?: return SubPick(false, null)
        val embedded = tracks.firstOrNull { it.external == null && it.language == want }
        return SubPick(false, embedded ?: tracks.firstOrNull { it.external != null && it.language == want })
    }
}
