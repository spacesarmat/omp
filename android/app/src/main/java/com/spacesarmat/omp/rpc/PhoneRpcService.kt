package com.spacesarmat.omp.rpc

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.spacesarmat.omp.I18n
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.R
import com.spacesarmat.omp.control.ControlServer
import java.io.IOException
import java.net.BindException

/**
 * Foreground service (type specialUse) of the TV search: while the user keeps the feature on, it runs the phone RPC
 * server ([ControlServer] + [RpcRoute]) and the hidden page that answers it ([RpcPageHost]). Always shown by a quiet
 * notification («OMP: поиск для телевизора»). No wake lock and no Wi-Fi lock in this beta. Main thread only.
 */
class PhoneRpcService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val config by lazy { RpcConfig(SharedRpcPrefs(this)) }
    private val lan by lazy { LanInterfaces(this) }
    private val dispatcher = RpcDispatcher({ msg -> page?.send(msg) ?: false })
    private var server: ControlServer? = null
    @Volatile
    private var page: RpcPageHost? = null
    private var foreground = false
    private var destroyed = false
    /** elapsedRealtime of the page restarts after a renderer loss, within [RESTART_WINDOW_MS]. */
    private val restarts = ArrayDeque<Long>()
    private val recreate = Runnable { if (!destroyed && page == null) createPage() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        I18n.load(this)
        if (!foreground) {
            try {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification(),
                    if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
                )
                foreground = true
            } catch (_: Exception) {
                // not allowed from the background (sticky restart): give up until the app or a boot starts it again
                stopSelf()
                return START_NOT_STICKY
            }
        } else {
            // a repeat start (the switch, or the notification permission just granted): post it again, so it shows
            // once allowed and follows the current language
            try {
                getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification())
            } catch (_: Exception) {
            }
        }
        if (!config.enabled) {
            // turned off while a start was on its way
            stopSelf()
            return START_NOT_STICKY
        }
        if (server == null && !startServer()) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (page == null) createPage()
        return START_STICKY
    }

    override fun onDestroy() {
        destroyed = true
        main.removeCallbacks(recreate)
        server?.stop()
        server = null
        runningPort = -1
        dispatcher.failAll("not_ready")
        page?.destroy()
        page = null
        if (foreground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        foreground = false
        super.onDestroy()
    }

    /** Binds the stored port; when it is taken, an OS-chosen one that is then stored for the TVs. */
    private fun startServer(): Boolean {
        val route = RpcRoute({ config.token() }, { dispatcher }, lan::arrivedOn)
        fun build(port: Int) = ControlServer(port, route::precheck, cors = route::cors, workers = RpcDispatcher.MAX_WAITING) { route.route(it) }
        var s = build(config.port())
        try {
            s.start()
        } catch (_: BindException) {
            s = build(0)
            try {
                s.start()
            } catch (_: IOException) {
                return false
            }
            config.savePort(s.localPort)
        } catch (_: IOException) {
            return false
        }
        server = s
        runningPort = s.localPort
        return true
    }

    private fun createPage() {
        val host = RpcPageHost(this, dispatcher) { onPageGone() }
        page = host
        host.start()
    }

    /** The renderer died: fail the waiting calls and load the page again after 2 s, at most 3 times per 10 min. */
    private fun onPageGone() {
        dispatcher.failAll("not_ready")
        page?.destroy()
        page = null
        if (destroyed) return
        val now = SystemClock.elapsedRealtime()
        while (restarts.isNotEmpty() && now - restarts.first() > RESTART_WINDOW_MS) restarts.removeFirst()
        if (restarts.size >= MAX_RESTARTS) return
        restarts.addLast(now)
        main.postDelayed(recreate, RESTART_DELAY_MS)
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        // LOW (not MIN) keeps the status-bar icon; a channel's importance is fixed once created, hence the new id
        try {
            nm?.deleteNotificationChannel(OLD_CHANNEL)
        } catch (_: Exception) {
        }
        try {
            nm?.createNotificationChannel(
                NotificationChannel(CHANNEL, I18n.s("rpc.channel"), NotificationManager.IMPORTANCE_LOW).apply {
                    setShowBadge(false)
                    setSound(null, null)
                    enableVibration(false)
                },
            )
        } catch (_: Exception) {
        }
        val open = PendingIntent.getActivity(
            this, 3,
            Intent(this, MainActivity::class.java)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_server)
            .setContentTitle(I18n.s("rpc.title"))
            .setContentText(I18n.s("rpc.text"))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    companion object {
        private const val CHANNEL = "omp-rpc-low"
        /** The 0.18.0-beta.3 dev channel with IMPORTANCE_MIN (no status-bar icon); deleted on start. */
        private const val OLD_CHANNEL = "omp-rpc"
        private const val NOTIFICATION_ID = 8097
        private const val RESTART_DELAY_MS = 2_000L
        private const val RESTART_WINDOW_MS = 10 * 60_000L
        private const val MAX_RESTARTS = 3

        /** The port the server is bound to while it runs, else -1. */
        @Volatile
        var runningPort: Int = -1
            private set

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, PhoneRpcService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, PhoneRpcService::class.java))
        }
    }
}
