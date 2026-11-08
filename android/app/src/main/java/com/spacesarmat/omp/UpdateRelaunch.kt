package com.spacesarmat.omp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.spacesarmat.omp.boot.BootLaunch
import com.spacesarmat.omp.boot.BootLaunchPrefs
import com.spacesarmat.omp.monitor.MonitorNotifier
import java.util.concurrent.TimeUnit

/**
 * Opens OMP after a package update. Android 10+ (API 29) may drop a background activity start without
 * throwing, so a returned startActivity proves nothing. Like [com.spacesarmat.omp.boot.BootReceiver] the
 * attempt is recorded in [BootLaunchPrefs] and passed to MainActivity with [BootLaunch.EXTRA_ATTEMPT];
 * [BootLaunch.acknowledge] clears the block only when that activity really starts. A WorkManager worker
 * re-checks after [CHECK_DELAY_SECONDS]: acknowledged -> no notification, still blocked -> fallback
 * notification with an open button.
 */
object UpdateRelaunch {
    private const val CHANNEL = "update"
    private const val ID = 0x20D
    internal const val WORK = "update-relaunch-check"
    internal const val KEY_ATTEMPT = "attempt"
    internal const val CHECK_DELAY_SECONDS = 30L

    fun open(context: Context) {
        val app = context.applicationContext
        val attempt = try {
            BootLaunchPrefs(app).markAttempt()
        } catch (_: RuntimeException) {
            0L
        }
        val launch = Intent(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(BootLaunch.EXTRA_ATTEMPT, attempt)
        try {
            // may be silently ignored on Android 10+; the deferred check decides about the notification
            context.startActivity(launch)
        } catch (_: Exception) {
            notify(app)
            return
        }
        try {
            if (attempt > 0L) scheduleCheck(app, attempt)
        } catch (_: RuntimeException) {
            // the direct start still happened; losing the fallback check beats breaking the install flow
        }
    }

    private fun scheduleCheck(context: Context, attempt: Long) {
        val req = OneTimeWorkRequestBuilder<UpdateRelaunchCheckWorker>()
            .setInitialDelay(CHECK_DELAY_SECONDS, TimeUnit.SECONDS)
            .setInputData(workDataOf(KEY_ATTEMPT to attempt))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
    }

    /** The deferred half of [open]: notify only when this attempt never got its [BootLaunch.acknowledge]. */
    internal fun check(context: Context, attempt: Long) {
        if (attempt <= 0L) return
        val state = try {
            BootLaunchPrefs(context).state()
        } catch (_: RuntimeException) {
            return
        }
        if (state.attempt != attempt || !state.blocked) return
        notify(context)
    }

    private fun notify(context: Context) {
        I18n.load(context)
        if (Build.VERSION.SDK_INT >= 26) {
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL, I18n.s("install.channel"), NotificationManager.IMPORTANCE_DEFAULT),
            )
        }
        if (!MonitorNotifier.canNotify(context)) return
        val open = PendingIntent.getActivity(
            context,
            ID,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = I18n.s("install.updatedText")
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_monitor)
            .setContentTitle(I18n.s("install.updatedTitle"))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(ID, notification)
        } catch (_: SecurityException) {
        }
    }
}

class UpdateRelaunchCheckWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        UpdateRelaunch.check(applicationContext, inputData.getLong(UpdateRelaunch.KEY_ATTEMPT, 0L))
        return Result.success()
    }
}
