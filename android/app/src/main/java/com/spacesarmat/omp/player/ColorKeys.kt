package com.spacesarmat.omp.player

import android.view.KeyEvent
import com.spacesarmat.omp.I18n

/** What a colour key of the remote does in the player (the same keys on LG: src/player/colorKeys.ts). */
enum class ColorAction { AUDIO, SUBS, INFO, MENU }

/** The bottom hint line for the colour keys: [text] has one «●» per entry of [dots] (ARGB colours, in order). */
data class ColorHint(val text: String, val dots: List<Int>)

/**
 * Pure parts of the colour keys of the player: Red — the audio list, Green — the subtitles list, Yellow — «Инфо»
 * (this build has no night sound), Blue — the player menu; the Info key opens «Инфо» too. The hint line.
 */
object ColorKeys {
    const val RED = 0xFFE5484D.toInt()
    const val GREEN = 0xFF30A46C.toInt()
    const val YELLOW = 0xFFF5C518.toInt()
    const val BLUE = 0xFF3E8EF7.toInt()

    /** The same physical keys TvKeys maps to 403..406 (red, green, yellow, blue), and Info. */
    fun actionFor(keyCode: Int): ColorAction? = when (keyCode) {
        KeyEvent.KEYCODE_PROG_RED -> ColorAction.AUDIO
        KeyEvent.KEYCODE_PROG_GREEN -> ColorAction.SUBS
        KeyEvent.KEYCODE_PROG_YELLOW, KeyEvent.KEYCODE_INFO -> ColorAction.INFO
        KeyEvent.KEYCODE_PROG_BLUE -> ColorAction.MENU
        else -> null
    }

    /** A key of the phone remote (ControlRouter KEYS) as a key code of the TV remote; null for others. */
    fun remoteCode(name: String): Int? = when (name) {
        "RED" -> KeyEvent.KEYCODE_PROG_RED
        "GREEN" -> KeyEvent.KEYCODE_PROG_GREEN
        "YELLOW" -> KeyEvent.KEYCODE_PROG_YELLOW
        "BLUE" -> KeyEvent.KEYCODE_PROG_BLUE
        "INFO" -> KeyEvent.KEYCODE_INFO
        "MENU" -> KeyEvent.KEYCODE_MENU
        else -> null
    }

    /**
     * A colour key while a player list or the menu is open: it closes it; Blue only closes (it toggles the menu),
     * the others then do their own action (Red on the subtitles list opens the audio list).
     */
    fun inDialog(action: ColorAction): ColorAction? = if (action == ColorAction.MENU) null else action

    /** «● аудио · ● субтитры · ● инфо · ● меню». */
    fun hint(): ColorHint {
        val parts = listOf("player.res.hintRed", "player.res.hintGreen", "player.res.hintYellow", "player.res.hintBlue").map { I18n.s(it) }
        return ColorHint(parts.joinToString(" · ") { "● $it" }, listOf(RED, GREEN, YELLOW, BLUE))
    }
}
