package com.spacesarmat.omp.monitor

import com.spacesarmat.omp.I18n

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.R

/**
 * Notifications of the monitoring: channels «Подписки», «Новые серии» and «Лучшее качество», grouped per channel. Buttons: «Добавить» /
 * «Заменить» run in the background ([MonitorActionReceiver] → one-time work), «Смотреть на ТВ» and a tap open OMP
 * with a link ([MonitorLinks]).
 */
object MonitorNotifier {
    private const val FLAGS = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    fun canNotify(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    }

    private fun channelName(channel: String) = when (channel) {
        MonitorIds.CHANNEL_SUBS -> I18n.s("monitor.subs")
        MonitorIds.CHANNEL_BETTER -> I18n.s("monitor.better")
        else -> I18n.s("monitor.episodes")
    }

    /** Called when monitoring is switched on too, so the channels can be tuned before the first notification. */
    fun ensureChannels(ctx: Context) {
        I18n.load(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        // same id again only renames the channel to the current language
        for (id in MonitorIds.CHANNELS) {
            nm.createNotificationChannel(NotificationChannel(id, channelName(id), NotificationManager.IMPORTANCE_DEFAULT))
        }
    }

    private fun openIntent(ctx: Context, url: String, requestCode: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java)
            .setAction(MonitorLinks.ACTION_OPEN)
            .putExtra(MonitorLinks.EXTRA_URL, url)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(ctx, requestCode, i, FLAGS)
    }

    private fun actionIntent(ctx: Context, a: MonitorAction): PendingIntent {
        val i = Intent(ctx, MonitorActionReceiver::class.java)
            .setAction(MonitorActionReceiver.ACTION)
            .putExtra(MonitorAction.EXTRA, a.toJson().toString())
        return PendingIntent.getBroadcast(ctx, a.notifId * 4 + 1, i, FLAGS)
    }

    private fun builder(ctx: Context, channel: String, title: String, text: String): NotificationCompat.Builder =
        NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_monitor)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setGroup(MonitorIds.group(channel))
            .setAutoCancel(true)

    /** false when notifications are off for the app or not permitted. */
    private fun show(ctx: Context, id: Int, channel: String, b: NotificationCompat.Builder): Boolean {
        ensureChannels(ctx)
        if (!canNotify(ctx)) return false
        val nm = NotificationManagerCompat.from(ctx)
        try {
            nm.notify(id, b.build())
            val summaryId = MonitorIds.summary(channel)
            val summary = NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat_monitor)
                .setContentTitle(channelName(channel))
                .setGroup(MonitorIds.group(channel))
                .setGroupSummary(true)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .setAutoCancel(true)
                .build()
            nm.notify(summaryId, summary)
            return true
        } catch (e: SecurityException) {
            // permission revoked meanwhile
            return false
        }
    }

    /** A new item from the page; false when it could not be shown. */
    fun post(ctx: Context, n: NotifySpec): Boolean {
        I18n.load(ctx)
        val id = n.notifId
        val b = builder(ctx, n.channel, n.title, n.text)
            .setContentIntent(openIntent(ctx, MonitorLinks.open(n.subId, n.key, false), id * 4))
        if (n.action != null) {
            val a = MonitorAction(n.action, n.subId, n.key, id, n.channel, n.title)
            b.addAction(0, if (n.action == MonitorAction.ADD) I18n.s("monitor.add") else I18n.s("monitor.replace"), actionIntent(ctx, a))
        }
        b.addAction(0, I18n.s("monitor.watchTv"), openIntent(ctx, MonitorLinks.open(n.subId, n.key, true), id * 4 + 2))
        return show(ctx, id, n.channel, b)
    }

    /** The button was pressed: «Добавляю…» / «Заменяю…» without buttons (no second press). */
    fun progress(ctx: Context, a: MonitorAction) {
        I18n.load(ctx)
        val b = builder(ctx, a.channel, if (a.kind == MonitorAction.ADD) I18n.s("monitor.adding") else I18n.s("monitor.replacing"), a.title)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .setAutoCancel(false)
        show(ctx, a.notifId, a.channel, b)
    }

    /** «Добавлено на сервер» / «Заменено» with «Открыть», or the error with the button to try again. */
    fun result(ctx: Context, a: MonitorAction, ok: Boolean, message: String, title: String?) {
        I18n.load(ctx)
        val text = title?.takeIf { it.isNotEmpty() } ?: a.title
        val b = builder(ctx, a.channel, if (ok) message else I18n.s("monitor.failedPrefix", "message" to message), text)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(openIntent(ctx, MonitorLinks.open(a.subId, a.key, false), a.notifId * 4))
        if (!ok) b.addAction(0, if (a.kind == MonitorAction.ADD) I18n.s("monitor.add") else I18n.s("monitor.replace"), actionIntent(ctx, a))
        b.addAction(0, I18n.s("monitor.open"), openIntent(ctx, MonitorLinks.open(a.subId, a.key, false), a.notifId * 4 + 3))
        show(ctx, a.notifId, a.channel, b)
    }
}
