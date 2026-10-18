package com.spacesarmat.omp.boot

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings

/**
 * Whether a boot broadcast should open OMP, and whether the TV setting should ask for display over other apps.
 *
 * Registered on [BootReceiver]:
 * - [ACTION_BOOT_COMPLETED] — cold boot, after unlock, so the WebView can read its data.
 * - [ACTION_QUICKBOOT_POWERON] and [ACTION_HTC_QUICKBOOT_POWERON] — Realtek and MTK boxes send these on quick
 *   boot, sometimes instead of BOOT_COMPLETED. Stock Android 8+ may not deliver these non-exempt implicit
 *   broadcasts; the firmware that uses them still does.
 *
 * Not registered:
 * - [ACTION_LOCKED_BOOT_COMPLETED] — direct boot, before credential-encrypted storage exists. A WebView activity
 *   cannot usefully start then. TV boxes unlock immediately and then deliver BOOT_COMPLETED.
 * - [ACTION_SCREEN_ON] and [ACTION_DREAMING_STOPPED] — every panel wake and screensaver exit, including resume
 *   from standby. Opening OMP there would take the screen from whatever was on. Power-on is cold boot and
 *   quick boot only.
 *
 * Phones: [outcome] is [Outcome.PHONE]. The same APK is installed on phones. The receiver returns without
 * starting an activity. [disableOnPhone] turns the receiver off after the phone UI has opened once, so later
 * boots do not even start the process for this feature.
 *
 * Android 10+ (API 29) may drop a background activity start without throwing. The receiver still calls
 * startActivity and records the attempt. [MainActivity] clears the blocked flag only when that attempt's
 * activity actually starts. [needsOverlayPrompt] is true only when the user is turning the setting on, a
 * previous attempt stayed blocked, overlay permission is missing, and the SDK enforces the limit.
 */
object BootLaunch {
    const val ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED"
    const val ACTION_QUICKBOOT_POWERON = "android.intent.action.QUICKBOOT_POWERON"
    const val ACTION_HTC_QUICKBOOT_POWERON = "com.htc.intent.action.QUICKBOOT_POWERON"

    /** Documented exclusions. Not in the manifest intent filter. */
    const val ACTION_LOCKED_BOOT_COMPLETED = "android.intent.action.LOCKED_BOOT_COMPLETED"
    const val ACTION_SCREEN_ON = "android.intent.action.SCREEN_ON"
    const val ACTION_DREAMING_STOPPED = "android.intent.action.DREAMING_STOPPED"

    /** Passed to [com.spacesarmat.omp.MainActivity] so only a real start of this attempt clears the block. */
    const val EXTRA_ATTEMPT = "omp.bootAttempt"

    /** Background activity starts are restricted from this SDK (Android 10). */
    const val OVERLAY_MIN_SDK = 29

    private val BOOT_ACTIONS = setOf(
        ACTION_BOOT_COMPLETED,
        ACTION_QUICKBOOT_POWERON,
        ACTION_HTC_QUICKBOOT_POWERON,
    )

    enum class Outcome { NOT_BOOT, PHONE, DISABLED, LAUNCH }

    /** One recorded start. [attempt] grows by one each try. [blocked] stays until that attempt's activity starts. */
    data class AttemptState(val attempt: Long = 0, val blocked: Boolean = false)

    fun isBootAction(action: String?): Boolean = action != null && action in BOOT_ACTIONS

    /** Missing [enabled] is on. A phone never launches, including when the preference was never written. */
    fun shouldLaunch(isTv: Boolean, enabled: Boolean?): Boolean = isTv && enabled != false

    fun outcome(action: String?, isTv: Boolean, enabled: Boolean?): Outcome = when {
        !isBootAction(action) -> Outcome.NOT_BOOT
        !shouldLaunch(isTv, enabled) -> if (isTv) Outcome.DISABLED else Outcome.PHONE
        else -> Outcome.LAUNCH
    }

    /**
     * The in-app prompt for SYSTEM_ALERT_WINDOW. False while the setting stays off, before any blocked start,
     * when the permission is already granted, and below [OVERLAY_MIN_SDK] (the OS does not block the start).
     */
    fun needsOverlayPrompt(sdkInt: Int, canDrawOverlays: Boolean, launchBlocked: Boolean, enabling: Boolean): Boolean =
        enabling && launchBlocked && !canDrawOverlays && sdkInt >= OVERLAY_MIN_SDK

    fun nextAttempt(state: AttemptState): AttemptState {
        val id = if (state.attempt == Long.MAX_VALUE) 1L else state.attempt + 1
        return AttemptState(id, blocked = true)
    }

    /** A late success for an older attempt must not clear a newer blocked one. */
    fun afterSuccess(state: AttemptState, attempt: Long): AttemptState =
        if (attempt > 0L && state.attempt == attempt) state.copy(blocked = false) else state

    /** Opens the system "display over other apps" screen, or the app details screen when that one is missing. */
    fun openOverlaySettings(context: Context): Boolean {
        val uri = Uri.fromParts("package", context.packageName, null)
        val overlay = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (tryStart(context, overlay)) return true
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return tryStart(context, details)
    }

    /** Phones: the receiver stops being invoked. No-op when it is already disabled. */
    fun disableOnPhone(context: Context) {
        try {
            val pm = context.packageManager
            val cn = ComponentName(context, BootReceiver::class.java)
            if (pm.getComponentEnabledSetting(cn) == PackageManager.COMPONENT_ENABLED_STATE_DISABLED) return
            pm.setComponentEnabledSetting(
                cn,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        } catch (_: RuntimeException) {
            // the receiver still returns immediately on a phone
        }
    }

    fun acknowledge(context: Context, intent: Intent?) {
        val attempt = intent?.getLongExtra(EXTRA_ATTEMPT, 0L) ?: return
        if (attempt <= 0L) return
        try {
            BootLaunchPrefs(context).markSuccess(attempt)
        } catch (_: RuntimeException) {
        }
    }

    private fun tryStart(context: Context, intent: Intent): Boolean =
        try {
            context.startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
}
