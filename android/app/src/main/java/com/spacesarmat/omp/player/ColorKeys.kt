package com.spacesarmat.omp.player

import android.view.KeyEvent
import com.spacesarmat.omp.I18n

/** What a colour key of the remote does in the player. */
enum class ColorAction { AUDIO, SUBS, NIGHT, MENU }

/** The bottom hint line for the colour keys: [text] has one «●» per entry of [dots] (ARGB colours, in order). */
data class ColorHint(val text: String, val dots: List<Int>)

/** Pure parts of the colour keys of the player: key mapping, track cycling, labels, the hint. */
object ColorKeys {
    const val RED = 0xFFE5484D.toInt()
    const val GREEN = 0xFF30A46C.toInt()
    const val YELLOW = 0xFFF5C518.toInt()
    const val BLUE = 0xFF3E8EF7.toInt()

    /** The same physical keys TvKeys maps to 403..406 (red, green, yellow, blue). */
    fun actionFor(keyCode: Int): ColorAction? = when (keyCode) {
        KeyEvent.KEYCODE_PROG_RED -> ColorAction.AUDIO
        KeyEvent.KEYCODE_PROG_GREEN -> ColorAction.SUBS
        KeyEvent.KEYCODE_PROG_YELLOW -> ColorAction.NIGHT
        KeyEvent.KEYCODE_PROG_BLUE -> ColorAction.MENU
        else -> null
    }

    /** Index of the next audio track (wraps); null when there is nothing to switch to (fewer than two). */
    fun nextAudio(audio: List<AudioOption>): Int? {
        if (audio.size < 2) return null
        val cur = TrackOptions.selectedAudio(audio)
        return (cur + 1) % audio.size
    }

    /** The next subtitle choice: off, each track in menu order, then off again. [TrackOptions.subs] puts «off» first. */
    fun nextSub(subs: List<SubOption>): SubOption? {
        if (subs.size < 2) return null
        val cur = subs.indexOf(TrackOptions.selectedSub(subs))
        return subs[(cur + 1) % subs.size]
    }

    fun audioLabel(label: String): String = I18n.s("player.audioRow", "v" to label)

    fun subsLabel(label: String): String = I18n.s("player.subsRow", "v" to label)

    fun nightLabel(on: Boolean): String = I18n.s("player.nightRow", "v" to I18n.s(if (on) "player.on" else "player.off"))

    fun nightUnavailable(): String = I18n.s("player.nightNa")

    /** «● аудио · ● субтитры · ● ночной звук · ● меню»; the night entry only where the engine has it. */
    fun hint(night: Boolean): ColorHint {
        val parts = ArrayList<String>()
        val dots = ArrayList<Int>()
        parts.add(I18n.s("player.res.hintRed")); dots.add(RED)
        parts.add(I18n.s("player.res.hintGreen")); dots.add(GREEN)
        if (night) {
            parts.add(I18n.s("player.res.hintYellow")); dots.add(YELLOW)
        }
        parts.add(I18n.s("player.res.hintBlue")); dots.add(BLUE)
        return ColorHint(parts.joinToString(" · ") { "● $it" }, dots)
    }
}
