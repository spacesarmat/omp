package com.spacesarmat.omp.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.TvMode

/**
 * Opens the main activity after the TV box powers on, when «Открывать при включении» is on (the default).
 * Which broadcasts count, and which were left out, is [BootLaunch].
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!BootLaunch.isBootAction(intent?.action)) return
        val app = context.applicationContext
        val isTv = try {
            TvMode.isTv(app)
        } catch (_: RuntimeException) {
            false
        }
        // Phones: no launch and no preference read. The component is disabled after the phone UI opens.
        if (!isTv) return
        val prefs = try {
            BootLaunchPrefs(app)
        } catch (_: RuntimeException) {
            return
        }
        if (BootLaunch.outcome(intent?.action, isTv = true, prefs.enabled()) != BootLaunch.Outcome.LAUNCH) return
        val attempt = try {
            prefs.markAttempt()
        } catch (_: RuntimeException) {
            return
        }
        try {
            // Android 10+ may ignore this without throwing. The attempt stays blocked until the activity starts.
            app.startActivity(launchIntent(app, attempt))
        } catch (_: Exception) {
        }
    }

    private fun launchIntent(context: Context, attempt: Long): Intent =
        Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra(BootLaunch.EXTRA_ATTEMPT, attempt)
        }
}
