package com.spacesarmat.omp.monitor

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * WorkManager plan of the monitoring: the periodic check (interval and Wi-Fi constraint from the settings), one-time
 * work for «Проверить сейчас» and for notification buttons. Keeps the schedule and the last run in its own
 * SharedPreferences (no secrets: counts, times, release titles).
 */
object MonitorScheduler {
    const val PERIODIC = "omp-monitor"
    const val CHECK = "omp-monitor-check"
    const val ACTIONS = "omp-monitor-actions"
    const val KEY_ACTION = "action"
    /** «Проверить сейчас»: waits for a running check instead of being skipped. */
    const val KEY_MANUAL = "manual"
    private const val PREFS = "omp-monitor"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun network(type: NetworkType) = Constraints.Builder().setRequiredNetworkType(type).build()

    /** Schedules (enabled) or cancels the periodic check; the interval / constraint of a scheduled one are updated. */
    fun apply(ctx: Context, s: MonitorSchedule) {
        prefs(ctx).edit()
            .putBoolean("enabled", s.enabled).putInt("hours", s.hours).putBoolean("wifiOnly", s.wifiOnly)
            .apply()
        val wm = WorkManager.getInstance(ctx)
        if (!s.enabled) {
            wm.cancelUniqueWork(PERIODIC)
            return
        }
        val req = PeriodicWorkRequestBuilder<MonitorWorker>(s.hours.toLong(), TimeUnit.HOURS)
            .setConstraints(network(MonitorPlan.network(s.wifiOnly)))
            .build()
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
    }

    /** «Проверить сейчас»: any network; a check already queued is kept. */
    fun runNow(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<MonitorWorker>()
            .setConstraints(network(NetworkType.CONNECTED))
            .setInputData(workDataOf(KEY_MANUAL to true))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(CHECK, ExistingWorkPolicy.KEEP, req)
    }

    /** A notification button; buttons run one after another. */
    fun runAction(ctx: Context, a: MonitorAction) {
        val req = OneTimeWorkRequestBuilder<MonitorWorker>()
            .setConstraints(network(NetworkType.CONNECTED))
            .setInputData(workDataOf(KEY_ACTION to a.toJson().toString()))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(ACTIONS, ExistingWorkPolicy.APPEND_OR_REPLACE, req)
    }

    /** A finished check: its summary, or why the page gave none. */
    fun recordRun(ctx: Context, at: Long, summary: JSONObject?, error: String?) {
        val e = prefs(ctx).edit().putLong("lastRun", at)
        if (summary != null) e.putString("lastSummary", summary.toString()).remove("lastError")
        else e.remove("lastSummary").putString("lastError", error ?: "Проверка не завершилась")
        e.apply()
    }

    /** Blocking (WorkManager query): call off the main thread. */
    fun status(ctx: Context): JSONObject {
        val p = prefs(ctx)
        val o = JSONObject()
            .put("enabled", p.getBoolean("enabled", false))
            .put("hours", MonitorPlan.hours(p.getInt("hours", MonitorPlan.DEFAULT_HOURS)))
            .put("wifiOnly", p.getBoolean("wifiOnly", true))
            .put("running", MonitorWorker.running.get())
        val last = p.getLong("lastRun", 0L)
        if (last > 0) o.put("lastRun", last)
        p.getString("lastSummary", null)?.let { o.put("lastSummary", it) }
        p.getString("lastError", null)?.let { o.put("lastError", it) }
        try {
            val next = WorkManager.getInstance(ctx).getWorkInfosForUniqueWork(PERIODIC).get()
                .firstOrNull { !it.state.isFinished }?.nextScheduleTimeMillis
            if (next != null && next > 0 && next != Long.MAX_VALUE) o.put("nextRun", next)
        } catch (e: Exception) {
            // unknown
        }
        return o
    }
}
