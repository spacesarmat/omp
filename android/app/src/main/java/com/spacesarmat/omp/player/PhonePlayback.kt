package com.spacesarmat.omp.player

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import androidx.lifecycle.Lifecycle
import com.spacesarmat.omp.TvMode
import tv.p2160.core.api.Player2160 as CorePlayer
import tv.p2160.core.settings.PlayerSettings
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Pauses the embedded phone player when «Звук в фоне» is off and playback is no longer on screen.
 *
 * player-core keeps playing through [android.app.Activity.onStop] while its own PiP flag is still set.
 * On Samsung One UI, closing the PiP window (X or swipe) does not destroy the activity: `onStop` already
 * ran while the activity was still in PiP, and [Activity.onPictureInPictureModeChanged] then reports
 * `false` with the activity stopped and not finishing. Nothing pauses, so the sound continues with no
 * window and no notification. The same setting also pauses on screen off, including while the PiP
 * window is up (Home → PiP itself keeps playing).
 *
 * When the setting is on, this object does not pause. player-core continues playback and the foreground
 * service shows the notification.
 */
object PhonePlayback {
    enum class Leave {
        /** [Activity.onPictureInPictureModeChanged] after the mode has already changed. */
        PIP_CHANGED,
        /** [Activity.onStop]. Home → PiP still reports picture-in-picture, so playback continues. */
        STOP,
        /** Power button. Pauses even if the activity is still in PiP. */
        SCREEN_OFF,
    }

    /**
     * Pure. [backgroundPlayback] is 2160's flag, which OMP sets from «Звук в фоне».
     * [inPictureInPicture] and [resumed] are the values after the event.
     */
    fun shouldPause(
        backgroundPlayback: Boolean,
        leave: Leave,
        inPictureInPicture: Boolean,
        resumed: Boolean,
        finishing: Boolean,
        changingConfigurations: Boolean,
    ): Boolean {
        if (backgroundPlayback || finishing || changingConfigurations) return false
        return when (leave) {
            Leave.PIP_CHANGED -> !inPictureInPicture && !resumed
            Leave.STOP -> !inPictureInPicture
            Leave.SCREEN_OFF -> true
        }
    }

    private val installed = AtomicBoolean(false)
    private val pipListeners = HashMap<Activity, Consumer<PictureInPictureModeChangedInfo>>()
    private var players = 0
    private var screenOff: BroadcastReceiver? = null

    private val callbacks = object : Application.ActivityLifecycleCallbacks {
        override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
            if (!isPlayer(activity)) return
            watchScreen(activity)
            if (activity !is ComponentActivity) return
            val listener = Consumer<PictureInPictureModeChangedInfo> { info ->
                pauseIf(
                    activity,
                    Leave.PIP_CHANGED,
                    inPictureInPicture = info.isInPictureInPictureMode,
                    resumed = activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED),
                )
            }
            activity.addOnPictureInPictureModeChangedListener(listener)
            pipListeners[activity] = listener
        }

        override fun onActivityStarted(activity: Activity) {}
        override fun onActivityResumed(activity: Activity) {}
        override fun onActivityPaused(activity: Activity) {}

        override fun onActivityStopped(activity: Activity) {
            if (!isPlayer(activity)) return
            pauseIf(
                activity,
                Leave.STOP,
                inPictureInPicture = activity.isInPictureInPictureMode,
                resumed = false,
            )
        }

        override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

        override fun onActivityDestroyed(activity: Activity) {
            if (!isPlayer(activity)) return
            if (activity is ComponentActivity) {
                pipListeners.remove(activity)?.let(activity::removeOnPictureInPictureModeChangedListener)
            }
            players = (players - 1).coerceAtLeast(0)
            if (players == 0) {
                screenOff?.let { runCatching { activity.application.unregisterReceiver(it) } }
                screenOff = null
            }
        }
    }

    /** Once per process, on a phone, before the embedded player activity is started. No-op on TV. */
    fun install(context: Context) {
        if (TvMode.isTv(context)) return
        if (!installed.compareAndSet(false, true)) return
        val app = context.applicationContext
        if (app is Application) app.registerActivityLifecycleCallbacks(callbacks)
    }

    private fun isPlayer(activity: Activity): Boolean = activity.javaClass.name == PlaybackControls.ACTIVITY

    private fun watchScreen(activity: Activity) {
        players++
        if (screenOff != null) return
        val app = activity.application
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != Intent.ACTION_SCREEN_OFF || players == 0) return
                if (shouldPause(
                        backgroundPlayback = background(context),
                        leave = Leave.SCREEN_OFF,
                        inPictureInPicture = true,
                        resumed = false,
                        finishing = false,
                        changingConfigurations = false,
                    )
                ) CorePlayer.pause()
            }
        }
        val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            app.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            app.registerReceiver(receiver, filter)
        }
        screenOff = receiver
    }

    private fun pauseIf(activity: Activity, leave: Leave, inPictureInPicture: Boolean, resumed: Boolean) {
        if (shouldPause(
                backgroundPlayback = background(activity),
                leave = leave,
                inPictureInPicture = inPictureInPicture,
                resumed = resumed,
                finishing = activity.isFinishing,
                changingConfigurations = activity.isChangingConfigurations,
            )
        ) CorePlayer.pause()
    }

    private fun background(context: Context): Boolean =
        runCatching { PlayerSettings.get(context).current.backgroundPlayback }.getOrDefault(false)
}
