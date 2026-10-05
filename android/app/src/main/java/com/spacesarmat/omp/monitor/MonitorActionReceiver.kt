package com.spacesarmat.omp.monitor

import com.spacesarmat.omp.I18n

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** «Добавить» / «Заменить» in a notification: shows «…» and queues the one-time work that runs the page. */
class MonitorActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        I18n.load(context)
        if (intent.action != ACTION) return
        val a = MonitorAction.fromJson(intent.getStringExtra(MonitorAction.EXTRA)) ?: return
        MonitorNotifier.progress(context, a)
        MonitorScheduler.runAction(context, a)
    }

    companion object {
        const val ACTION = "com.spacesarmat.omp.MONITOR_ACTION"
    }
}
