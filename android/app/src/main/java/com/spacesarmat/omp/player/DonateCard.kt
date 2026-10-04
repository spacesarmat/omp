package com.spacesarmat.omp.player

import org.json.JSONObject

/**
 * «Поддержать» card of the native player (the page's src/player/DonateCard.tsx): a QR code of the donation link on
 * pause (bottom right, above the controls) and during the end credits (bottom left, next to «Следующая серия»).
 * Purely visual: no focus, no keys. The page sends it with playNative (`donate`) only when the viewer is not a
 * supporter and a donation method opens the link; `{ type: "donate", on: false }` hides it for the rest of the run.
 * [bits]: the QR rows without the quiet zone, «1» dark (generated at build time: src/ui/donateQr.ts).
 */
data class DonateQr(val modules: Int, val bits: String, val label: String) {
    fun dark(x: Int, y: Int): Boolean = bits[y * modules + x] == '1'

    companion object {
        /** Modules of white border around the code (the QR standard asks for 4). */
        const val QUIET = 4

        const val NONE = 0
        const val PAUSE = 1
        const val CREDITS = 2

        /** Null when absent or malformed (size 21–177, a row string of exactly modules² «0»/«1»). */
        fun parse(o: JSONObject?): DonateQr? {
            if (o == null) return null
            val n = o.optInt("modules", 0)
            val bits = o.optString("bits")
            if (n < 21 || n > 177 || bits.length != n * n || bits.any { it != '0' && it != '1' }) return null
            return DonateQr(n, bits, o.optString("label"))
        }

        /**
         * Where the card is: the «Следующая серия» countdown or a position inside the known credits → [CREDITS];
         * a pause → [PAUSE]; nothing on an error. Without known credits there is no card at the end of a movie.
         */
        fun mode(enabled: Boolean, error: Boolean, paused: Boolean, countdown: Boolean, posMs: Long, durMs: Long, creditsMs: Long?): Int {
            if (!enabled || error) return NONE
            if (countdown) return CREDITS
            if (paused) return PAUSE
            if (creditsMs != null && creditsMs > 0 && durMs > 0 && creditsMs < durMs && posMs >= creditsMs && posMs < durMs) return CREDITS
            return NONE
        }
    }
}
