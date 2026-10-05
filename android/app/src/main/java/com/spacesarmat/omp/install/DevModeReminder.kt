package com.spacesarmat.omp.install

import com.spacesarmat.omp.I18n

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.R
import com.spacesarmat.omp.monitor.MonitorNotifier
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * «Напомнить продлить режим разработчика»: one local notification per LG TV at the time the page chose (3 days
 * before the 1000 hours of Developer Mode run out), through WorkManager (survives reboots). The work is keyed by a
 * hash of a stable TV id when the page knows one (else of the TV address), so TVs do not replace each other's
 * reminders; scheduling also drops an older reminder of the same TV under the other key form (a reinstall after a
 * DHCP change leaves no duplicate). Nothing leaves the phone.
 */
object DevModeReminder {
    private const val WORK_PREFIX = "devmode-reminder-"
    const val CHANNEL = "devmode"
    private const val NOTIFICATION_BASE = 7_100
    private const val HOUR = 3_600_000L
    private const val KEY_NAME = "name"
    private const val KEY_ID = "id"

    /** Accepted times: 1 hour … 1000 hours from [now]. */
    fun validAt(at: Long, now: Long): Boolean = at >= now + HOUR && at <= now + 1000 * HOUR

    /** Stable short id of a TV (its address), never the address itself. */
    fun tvId(tv: String): String =
        MessageDigest.getInstance("SHA-256").digest(tv.trim().toByteArray()).take(8).joinToString("") { "%02x".format(it) }

    fun workName(tv: String): String = WORK_PREFIX + tvId(tv)

    /** Work names of one TV, preferred first: by stable id (when known), then by address. */
    fun workNames(tv: String, stableId: String?): List<String> {
        val id = stableId?.trim().orEmpty()
        return if (id.isEmpty()) listOf(workName(tv)) else listOf(workName("id:" + id), workName(tv))
    }

    /** Notification id per TV (one notification each). */
    fun notificationId(tv: String): Int = NOTIFICATION_BASE + (tvId(tv).take(4).toInt(16) % 1000)

    /** Notification id of the preferred key of [tv] / [stableId]. */
    fun notificationId(tv: String, stableId: String?): Int {
        val id = stableId?.trim().orEmpty()
        return notificationId(if (id.isEmpty()) tv else "id:" + id)
    }

    /** At most 60 printable characters of the TV name for the notification title. */
    fun cleanName(name: String?): String? =
        name?.filter { !it.isISOControl() }?.trim()?.take(60)?.takeIf { it.isNotEmpty() }

    fun schedule(
        ctx: Context,
        tv: String,
        name: String?,
        at: Long,
        now: Long = System.currentTimeMillis(),
        stableId: String? = null,
    ): Boolean {
        if (!validAt(at, now)) return false
        val data = Data.Builder().putInt(KEY_ID, notificationId(tv, stableId))
        cleanName(name)?.let { data.putString(KEY_NAME, it) }
        val req = OneTimeWorkRequestBuilder<DevModeReminderWorker>()
            .setInitialDelay(at - now, TimeUnit.MILLISECONDS)
            .setInputData(data.build())
            .build()
        val names = workNames(tv, stableId)
        val wm = WorkManager.getInstance(ctx)
        for (n in names) wm.cancelUniqueWork(n)
        wm.enqueueUniqueWork(names.first(), ExistingWorkPolicy.REPLACE, req)
        return true
    }

    fun cancel(ctx: Context, tv: String, stableId: String? = null) {
        for (n in workNames(tv, stableId)) WorkManager.getInstance(ctx).cancelUniqueWork(n)
    }

    /** When the reminder for [tv] is due (unix ms), or null when none is scheduled. Blocking. */
    fun scheduledAt(ctx: Context, tv: String, stableId: String? = null): Long? {
        for (n in workNames(tv, stableId)) {
            val infos = WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(n).get(5, TimeUnit.SECONDS)
            val pending = infos.firstOrNull { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.BLOCKED } ?: continue
            val next = pending.nextScheduleTimeMillis
            if (next > 0 && next != Long.MAX_VALUE) return next
        }
        return null
    }

    fun show(ctx: Context, id: Int, name: String?) {
        I18n.load(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        run { // same id again only renames the channel to the current language
            nm.createNotificationChannel(NotificationChannel(CHANNEL, I18n.s("devmode.channel"), NotificationManager.IMPORTANCE_DEFAULT))
        }
        if (!MonitorNotifier.canNotify(ctx)) return
        val open = PendingIntent.getActivity(
            ctx,
            id,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = I18n.s("devmode.text")
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_monitor)
            .setContentTitle(if (name != null) I18n.s("devmode.titleNamed", "name" to name) else I18n.s("devmode.title"))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (_: SecurityException) {
        }
    }

    internal fun showFrom(ctx: Context, data: Data) {
        show(ctx, data.getInt(KEY_ID, NOTIFICATION_BASE), cleanName(data.getString(KEY_NAME)))
    }
}

class DevModeReminderWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        I18n.load(applicationContext)
        DevModeReminder.showFrom(applicationContext, inputData)
        return Result.success()
    }
}
