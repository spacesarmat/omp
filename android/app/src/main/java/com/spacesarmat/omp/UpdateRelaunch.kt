package com.spacesarmat.omp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.spacesarmat.omp.monitor.MonitorNotifier

/** Opens OMP after a package update, with a notification when the system blocks the activity start. */
object UpdateRelaunch {
    private const val CHANNEL = "update"
    private const val ID = 0x20D

    fun open(context: Context) {
        val launch = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        try {
            context.startActivity(launch)
            return
        } catch (_: Exception) {
        }
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
