package com.spacesarmat.omp.monitor

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.spacesarmat.omp.OmpNativePlugin
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/**
 * One background run: a check (periodic / «Проверить сейчас») or a notification button. Opens the hidden monitor page
 * ([MonitorHost]) on the main thread and waits for its summary, at most [MonitorPlan.RUN_LIMIT_MS]; the page is
 * destroyed in every case. One run at a time: a check finding another run busy is skipped, a button waits its turn.
 */
class MonitorWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val raw = inputData.getString(MonitorScheduler.KEY_ACTION)
        val action = MonitorAction.fromJson(raw)
        if (raw != null && action == null) return Result.success()
        // the periodic check skips when another run is busy; «Проверить сейчас» and buttons wait their turn
        if (action == null && !inputData.getBoolean(MonitorScheduler.KEY_MANUAL, false)) {
            if (!lock.tryLock()) return Result.success()
        } else {
            lock.lock()
        }
        running.set(true)
        try {
            val at = System.currentTimeMillis()
            val outcome = runPage(action)
            val summary = outcome.first
            if (action == null) {
                MonitorScheduler.recordRun(applicationContext, at, summary, outcome.second)
            } else {
                val r = summary?.optJSONObject("action")
                val ok = r?.optBoolean("ok", false) == true
                val message = (r?.opt("message") as? String)?.takeIf { it.isNotEmpty() } ?: (outcome.second ?: FAILED)
                MonitorNotifier.result(applicationContext, action, ok, message, r?.opt("title") as? String)
            }
            OmpNativePlugin.deliverMonitorDone(summary)
        } finally {
            running.set(false)
            lock.unlock()
        }
        return Result.success()
    }

    /** The page's summary, or null and the reason. */
    private suspend fun runPage(action: MonitorAction?): Pair<JSONObject?, String?> {
        val done = CompletableDeferred<JSONObject?>()
        var host: MonitorHost? = null
        var error: String? = null
        try {
            val deadline = System.currentTimeMillis() + MonitorPlan.RUN_LIMIT_MS
            val summary = withTimeoutOrNull(MonitorPlan.RUN_LIMIT_MS) {
                withContext(Dispatchers.Main) {
                    // assigned before start(): a WebView that fails half-way is still destroyed below
                    val h = MonitorHost(applicationContext, action, deadline) { s -> done.complete(s) }
                    host = h
                    h.start()
                }
                done.await()
            }
            if (summary == null) error = if (done.isCompleted) NO_SUMMARY else TOO_LONG
            // Chromium commits localStorage to disk a few seconds late: keep the page (and WorkManager's wake lock)
            // alive meanwhile, so the seen keys survive a process killed right after the run. The journal
            // (MonitorJournal) covers the dedup keys even if this is not enough.
            if (done.isCompleted) delay(STORAGE_FLUSH_MS)
            return Pair(summary, error)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            // WebView missing or being updated
            return Pair(null, NO_WEBVIEW)
        } finally {
            withContext(NonCancellable + Dispatchers.Main) { host?.destroy() }
        }
    }

    companion object {
        private val lock = Mutex()
        val running = AtomicBoolean(false)
        /** Longer than Chromium's localStorage commit delay (about 5 s). */
        const val STORAGE_FLUSH_MS = 6_000L
        private const val TOO_LONG = "Проверка не уложилась в 3 минуты"
        private const val NO_SUMMARY = "Проверка не завершилась"
        private const val NO_WEBVIEW = "Не удалось открыть WebView"
        private const val FAILED = "Не удалось выполнить"
    }
}
