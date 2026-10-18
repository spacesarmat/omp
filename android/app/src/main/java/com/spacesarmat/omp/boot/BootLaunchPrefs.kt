package com.spacesarmat.omp.boot

import android.content.Context

/**
 * Boot-launch switch and the last attempt, in [PREFS].
 * An absent [KEY_ENABLED] means on (Android TV default). Phones never read this to start an activity.
 */
class BootLaunchPrefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** null when the person has never moved the switch. */
    fun enabled(): Boolean? =
        if (prefs.contains(KEY_ENABLED)) prefs.getBoolean(KEY_ENABLED, true) else null

    fun setEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, enabled).commit()
    }

    fun state(): BootLaunch.AttemptState = BootLaunch.AttemptState(
        prefs.getLong(KEY_ATTEMPT, 0L),
        prefs.getBoolean(KEY_BLOCKED, false),
    )

    /** Records a new attempt as blocked. The activity clears it in [BootLaunch.acknowledge]. */
    fun markAttempt(): Long {
        val next = BootLaunch.nextAttempt(state())
        prefs.edit().putLong(KEY_ATTEMPT, next.attempt).putBoolean(KEY_BLOCKED, true).commit()
        return next.attempt
    }

    fun markSuccess(attempt: Long) {
        val current = state()
        val next = BootLaunch.afterSuccess(current, attempt)
        if (next != current) prefs.edit().putBoolean(KEY_BLOCKED, false).commit()
    }

    fun launchBlocked(): Boolean = state().blocked

    companion object {
        const val PREFS = "omp-boot"
        const val KEY_ENABLED = "enabled"
        const val KEY_ATTEMPT = "attempt"
        const val KEY_BLOCKED = "blocked"
    }
}
