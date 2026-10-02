package com.spacesarmat.omp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Foreground service (type specialUse) that keeps the embedded TorrServer ([LocalTorrServer]) running
 * with a Wi-Fi lock and a partial wake lock held only while it is busy (a torrent open or loading, and
 * 5 minutes after). Its notification shows «<IP>:8090 · N раздач · скорость», refreshed every 5 s,
 * with «Остановить» and «Открыть OMP».
 */
class TorrServerService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var stats: ScheduledExecutorService? = null
    private var wifiLocks: List<WifiManager.WifiLock> = emptyList()
    private var wakeLock: PowerManager.WakeLock? = null
    @Volatile private var foreground = false
    // main thread: last time the server was busy (or started)
    private var busyAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!foreground) {
            try {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification(LocalTorrServer.statusLine(LocalTorrServer.wifiIpv4(this), null)),
                    if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
                )
                foreground = true
            } catch (_: Exception) {
                // not allowed from the background (sticky restart): give up, a waiting start fails at once
                LocalTorrServer.failStart("Не удалось запустить сервер")
                stopSelf()
                return START_NOT_STICKY
            }
        }
        // a fresh start is likely followed by playback: stay awake for the idle grace period
        busyAt = SystemClock.elapsedRealtime()
        acquireLocks()
        LocalTorrServer.start(this) { main.post { stopSelf() } }
        if (stats == null) {
            stats = Executors.newSingleThreadScheduledExecutor().also {
                it.scheduleWithFixedDelay({ refresh() }, 2, 5, TimeUnit.SECONDS)
            }
        }
        // restarted by the system after the app process was killed: run the server again
        return START_STICKY
    }

    override fun onDestroy() {
        // first, so a refresh already posted to the main thread does not notify again
        val wasForeground = foreground
        foreground = false
        stats?.let {
            it.shutdownNow()
            try {
                it.awaitTermination(300, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
            }
        }
        stats = null
        LocalTorrServer.stop()
        releaseLocks()
        if (wasForeground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        try {
            getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    private fun refresh() {
        if (!LocalTorrServer.running) return
        LocalTorrServer.trimLogHourly(this)
        val stats = LocalTorrServer.stats()
        val line = LocalTorrServer.statusLine(LocalTorrServer.wifiIpv4(this), stats)
        // on the main thread, where onDestroy clears [foreground]: never re-posts after the stop
        main.post {
            if (!foreground) return@post
            val now = SystemClock.elapsedRealtime()
            if (stats?.busy == true) {
                busyAt = now
                acquireLocks()
            } else if (now - busyAt > IDLE_MS) {
                releaseLocks()
            }
            try {
                getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification(line))
            } catch (_: Exception) {
            }
        }
    }

    private fun notification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm?.getNotificationChannel(CHANNEL) == null) {
            nm?.createNotificationChannel(
                NotificationChannel(CHANNEL, "TorrServer", NotificationManager.IMPORTANCE_LOW).apply {
                    setShowBadge(false)
                },
            )
        }
        val pi = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val stop = PendingIntent.getService(
            this, 1, Intent(this, TorrServerService::class.java).setAction(ACTION_STOP), pi,
        )
        val open = PendingIntent.getActivity(
            this, 2,
            Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            pi,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_server)
            .setContentTitle("TorrServer работает")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Остановить", stop)
            .addAction(0, "Открыть OMP", open)
            .build()
    }

    private fun acquireLocks() {
        if (wakeLock == null) {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager?
            wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "omp:torrserver")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        if (wifiLocks.isEmpty()) {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager?
            if (wm != null) {
                // HIGH_PERF works in the background up to Android 13; LOW_LATENCY (10+) while in front
                @Suppress("DEPRECATION")
                val modes = mutableListOf(WifiManager.WIFI_MODE_FULL_HIGH_PERF)
                if (Build.VERSION.SDK_INT >= 29) modes.add(WifiManager.WIFI_MODE_FULL_LOW_LATENCY)
                wifiLocks = modes.mapNotNull { mode ->
                    try {
                        wm.createWifiLock(mode, "omp:torrserver:$mode").apply {
                            setReferenceCounted(false)
                            acquire()
                        }
                    } catch (_: Exception) {
                        null
                    }
                }
            }
        }
    }

    private fun releaseLocks() {
        for (l in wifiLocks) {
            try {
                if (l.isHeld) l.release()
            } catch (_: Exception) {
            }
        }
        wifiLocks = emptyList()
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wakeLock = null
    }

    companion object {
        private const val CHANNEL = "torrserver"
        private const val NOTIFICATION_ID = 8090
        private const val ACTION_STOP = "com.spacesarmat.omp.TORRSERVER_STOP"
        /** Locks are released after this long without a busy refresh. */
        private const val IDLE_MS = 5 * 60_000L

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, TorrServerService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, TorrServerService::class.java))
        }
    }
}
