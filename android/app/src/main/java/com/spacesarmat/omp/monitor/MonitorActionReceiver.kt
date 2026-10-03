package com.spacesarmat.omp.monitor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** «Добавить» / «Заменить» in a notification: shows «…» and queues the one-time work that runs the page. */
class MonitorActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val a = MonitorAction.fromJson(intent.getStringExtra(MonitorAction.EXTRA)) ?: return
        MonitorNotifier.progress(context, a)
        MonitorScheduler.runAction(context, a)
    }

    companion object {
        const val ACTION = "com.spacesarmat.omp.MONITOR_ACTION"
    }
}
