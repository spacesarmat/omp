package com.spacesarmat.omp.install

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.R
import com.spacesarmat.omp.monitor.MonitorNotifier
import java.util.concurrent.TimeUnit

/**
 * «Напомнить продлить режим разработчика»: one local notification at the time the page chose (3 days before the
 * 1000 hours of LG Developer Mode run out), through WorkManager (survives reboots). Nothing leaves the phone.
 */
object DevModeReminder {
    private const val WORK = "devmode-reminder"
    const val CHANNEL = "devmode"
    private const val NOTIFICATION_ID = 7_100
    private const val HOUR = 3_600_000L

    /** Accepted times: 1 hour … 1000 hours from [now]. */
    fun validAt(at: Long, now: Long): Boolean = at >= now + HOUR && at <= now + 1000 * HOUR

    fun schedule(ctx: Context, at: Long, now: Long = System.currentTimeMillis()): Boolean {
        if (!validAt(at, now)) return false
        val req = OneTimeWorkRequestBuilder<DevModeReminderWorker>()
            .setInitialDelay(at - now, TimeUnit.MILLISECONDS)
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
        return true
    }

    fun cancel(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK)
    }

    fun show(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Режим разработчика LG", NotificationManager.IMPORTANCE_DEFAULT))
        }
        if (!MonitorNotifier.canNotify(ctx)) return
        val open = PendingIntent.getActivity(
            ctx,
            NOTIFICATION_ID,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = "Через 3 дня закончатся 1000 часов режима разработчика, и OMP удалится с телевизора. " +
            "Откройте на ТВ приложение Developer Mode и продлите срок."
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_monitor)
            .setContentTitle("Продлите режим разработчика на LG")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, n)
        } catch (_: SecurityException) {
        }
    }
}

class DevModeReminderWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        DevModeReminder.show(applicationContext)
        return Result.success()
    }
}
