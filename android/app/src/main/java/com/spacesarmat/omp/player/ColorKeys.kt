package com.spacesarmat.omp.player

import android.view.KeyEvent
import com.spacesarmat.omp.I18n

/** What a colour key (or Info) of the remote does in the player (LG has its own keys: src/player/colorKeys.ts). */
enum class ColorAction { AUDIO, SUBS, NIGHT, INFO, MENU }

/** The bottom hint line for the colour keys: [text] has one «●» per entry of [dots] (ARGB colours, in order). */
data class ColorHint(val text: String, val dots: List<Int>)

/**
 * Pure parts of the colour keys of the player: Red — the audio list, Green — the subtitles list, Yellow — night
 * sound (2160's engine has it), Blue — the player menu; the Info key opens «Инфо». The hint line.
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
        KeyEvent.KEYCODE_PROG_YELLOW -> ColorAction.NIGHT
        KeyEvent.KEYCODE_INFO -> ColorAction.INFO
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
     * A colour key while a player list or the menu is open ([open]: the key whose window it is — the audio list for
     * Red, the subtitles list for Green, the menu for Blue; null for another list such as the chapters): it always
     * closes it. Its own key only closes (a toggle: Red closes the audio list it opened); Blue only closes, as before;
     * another colour key then does its own action (Red on the subtitles list opens the audio list).
     */
    fun inDialog(action: ColorAction, open: ColorAction?): ColorAction? =
        if (action == ColorAction.MENU || action == open) null else action

    fun nightLabel(on: Boolean): String = I18n.s("player.nightRow", "v" to I18n.s(if (on) "player.on" else "player.off"))

    fun nightUnavailable(): String = I18n.s("player.nightNa")

    /** «● аудио · ● субтитры · ● ночной звук · ● меню · Info — инфо»; the night entry only where the engine has it. */
    fun hint(night: Boolean): ColorHint {
        val parts = ArrayList<String>()
        val dots = ArrayList<Int>()
        parts.add(I18n.s("player.res.hintRed")); dots.add(RED)
        parts.add(I18n.s("player.res.hintGreen")); dots.add(GREEN)
        if (night) {
            parts.add(I18n.s("player.res.hintYellow")); dots.add(YELLOW)
        }
        parts.add(I18n.s("player.res.hintBlue")); dots.add(BLUE)
        return ColorHint(parts.joinToString(" · ") { "● $it" } + " · " + I18n.s("player.res.hintInfo"), dots)
    }
}

/** Colour keys and Info act once per press: the auto-repeat of a held key is swallowed (as for the menu). */
fun colorKeyActs(repeatCount: Int): Boolean = repeatCount == 0
