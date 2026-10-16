package com.spacesarmat.omp.player

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import com.spacesarmat.omp.I18n
import com.spacesarmat.omp.TvMode
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Puts seek backward, seek forward and stop on the media3 notification of player-core's [PlaybackControls.SERVICE].
 * Play/pause is already the notification's central button. The session object is internal to player-core; playback
 * still works if it cannot be reached (the service then shows media3's previous / play / next).
 *
 * Calls happen on the main thread. Android TV does not install the callbacks and does not enable the service.
 */
@OptIn(UnstableApi::class)
object PlaybackNotification {
    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val installed = AtomicBoolean(false)

    private val callbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
        override fun onActivityStarted(activity: Activity) = refresh(activity)
        override fun onActivityResumed(activity: Activity) = refresh(activity)
        override fun onActivityPaused(activity: Activity) {}
        override fun onActivityStopped(activity: Activity) {}
        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        override fun onActivityDestroyed(activity: Activity) {}
    }

    /** Once per process, and only on a phone, when «Звук в фоне» has enabled the service. */
    fun install(context: Context) {
        if (TvMode.isTv(context)) return
        if (!installed.compareAndSet(false, true)) return
        val app = context.applicationContext
        if (app is Application) app.registerActivityLifecycleCallbacks(callbacks)
    }

    /**
     * The embedded player has just been started. Posted to the main thread so it runs after the activity has
     * created the session, and so a plugin thread never touches the session.
     */
    fun onPlayerOpened(context: Context) {
        val app = context.applicationContext
        main.post { applyIfEnabled(app) }
    }

    /** The three preference buttons, in [PlaybackControls.preferenceCommands] order. Visible for tests. */
    fun preferenceButtons(): List<CommandButton> =
        PlaybackControls.preferenceCommands.map { command -> button(command, I18n.s(labelKey(command))) }

    private fun refresh(activity: Activity) {
        if (activity.javaClass.name != PlaybackControls.ACTIVITY) return
        applyIfEnabled(activity)
    }

    private fun applyIfEnabled(context: Context) {
        if (TvMode.isTv(context)) return
        if (!PlaybackControls.componentRuns(enabledSetting(context))) return
        I18n.load(context)
        runCatching {
            val session = session() ?: return
            session.setMediaButtonPreferences(preferenceButtons())
        }
    }

    private fun enabledSetting(context: Context): Int = runCatching {
        context.packageManager.getComponentEnabledSetting(ComponentName(context, PlaybackControls.SERVICE))
    }.getOrDefault(PackageManager.COMPONENT_ENABLED_STATE_DEFAULT)

    private fun labelKey(command: Int): String = when (command) {
        Player.COMMAND_SEEK_BACK -> "player.notify.seekBack"
        Player.COMMAND_SEEK_FORWARD -> "player.notify.seekForward"
        Player.COMMAND_STOP -> "player.notify.stop"
        else -> "player.notify.stop"
    }

    private fun button(command: Int, name: String): CommandButton {
        val (icon, slot) = when (command) {
            Player.COMMAND_SEEK_BACK -> CommandButton.ICON_SKIP_BACK to CommandButton.SLOT_BACK
            Player.COMMAND_SEEK_FORWARD -> CommandButton.ICON_SKIP_FORWARD to CommandButton.SLOT_FORWARD
            else -> CommandButton.ICON_STOP to CommandButton.SLOT_OVERFLOW
        }
        return CommandButton.Builder(icon)
            .setPlayerCommand(command)
            .setSlots(slot)
            .setDisplayName(name)
            .build()
    }

    /**
     * player-core's `PlaybackSessions` is `internal`. The foreground service reads the same session; we only
     * replace its button list. A missing or renamed getter leaves the default notification in place.
     */
    private fun session(): MediaSession? {
        val cls = Class.forName("tv.p2160.core.engine.PlaybackSessions")
        val instance = cls.getField("INSTANCE").get(null) ?: return null
        val getter = cls.methods.firstOrNull { it.parameterCount == 0 && PlaybackControls.isSessionGetter(it.name) }
            ?: return null
        return getter.invoke(instance) as? MediaSession
    }
}
