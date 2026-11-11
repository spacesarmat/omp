package com.spacesarmat.omp

import android.content.Context

/** «Включать телевизор через HDMI-CEC». Absent means on, matching the page default. */
object CecPrefs {
    private const val PREFS = "omp-cec"
    private const val KEY = "enabled"

    fun enabled(context: Context): Boolean =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, true)

    fun setEnabled(context: Context, on: Boolean) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).commit()
    }
}

/**
 * One-touch play: turn the TV on and switch to this HDMI input.
 * HdmiControlManager is a hidden API and the permission is privileged, so a missing method or a
 * SecurityException is a no-op. The box keeps working.
 */
object CecPower {
    fun oneTouch(hdmi: Any?): Boolean {
        if (hdmi == null) return false
        if (invoke(hdmi, "oneTouchPlay")) return true
        val client = hdmi.javaClass.methods.firstOrNull { it.name == "getPlaybackClient" && it.parameterTypes.isEmpty() }
            ?.let { runCatching { it.invoke(hdmi) }.getOrNull() }
        return invoke(client, "oneTouchPlay")
    }

    private fun invoke(target: Any?, name: String): Boolean {
        if (target == null) return false
        val method = target.javaClass.methods.firstOrNull { it.name == name && it.parameterTypes.size == 1 } ?: return false
        return try {
            method.invoke(target, null)
            true
        } catch (_: Throwable) {
            false
        }
    }
}
