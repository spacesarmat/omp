package com.spacesarmat.omp

import android.os.Build
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.PluginCall
import com.spacesarmat.omp.audio.AudioPlayerService
import com.spacesarmat.omp.audio.AudioQueue
import com.spacesarmat.omp.audio.AudioQueueParser
import com.spacesarmat.omp.audio.AudioSession
import org.json.JSONObject

/** Audiobook player (audio/AudioPlayerService). Bodies for [OmpNativePlugin]. */

private val audioMain = Handler(Looper.getMainLooper())

private fun OmpNativePlugin.parseAudio(call: PluginCall): AudioQueue? =
    AudioQueueParser.parse(
        call.getString("book"),
        call.getString("hash"),
        call.getInt("start") ?: 0,
        call.getDouble("positionMs")?.toLong() ?: 0L,
        call.getArray("items"),
    )

/** Notification permission before the player screen is shown. Resolves either way; playback still starts. */
internal fun OmpNativePlugin.audioPrepareOp(call: PluginCall) {
    I18n.load(context)
    if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
        askPermission("notifications", call, "audioPrepareDone")
        return
    }
    call.resolve()
}

internal fun OmpNativePlugin.audioPrepareDoneOp(call: PluginCall) {
    call.resolve()
}

internal fun OmpNativePlugin.audioPlayOp(call: PluginCall) {
    I18n.load(context)
    val queue = parseAudio(call) ?: run {
        call.reject(I18n.s("audio.noUrl"))
        return
    }
    // Without the permission the sound still plays; the shade and the lock screen have no controls.
    if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
        askPermission("notifications", call, "audioAfterNotify")
        return
    }
    startAudio(call, queue)
}

internal fun OmpNativePlugin.audioAfterNotifyOp(call: PluginCall) {
    val queue = parseAudio(call) ?: run {
        call.reject(I18n.s("audio.noUrl"))
        return
    }
    startAudio(call, queue)
}

private fun OmpNativePlugin.startAudio(call: PluginCall, queue: AudioQueue) {
    try {
        AudioPlayerService.play(context, queue)
        call.resolve(JSObject.fromJSONObject(queuedState(queue)))
    } catch (_: Exception) {
        call.reject(I18n.s("audio.playFailed"))
    }
}

internal fun OmpNativePlugin.audioControlOp(call: PluginCall) {
    val cmd = AudioQueueParser.command(
        call.getString("cmd"),
        call.getDouble("ms"),
        call.getDouble("speed"),
        call.getString("sleep"),
    )
    if (cmd == null) {
        call.reject(I18n.s("audio.badCmd"))
        return
    }
    audioMain.post {
        val state = AudioPlayerService.instance?.control(cmd)
        call.resolve(JSObject.fromJSONObject(state ?: JSONObject().put("active", false)))
    }
}

internal fun OmpNativePlugin.takePendingAudioOpenOp(call: PluginCall) {
    val hash = synchronized(OmpNativePlugin.magnetLock) {
        val h = OmpNativePlugin.pendingAudioHash
        OmpNativePlugin.pendingAudioHash = null
        h
    }
    val o = JSObject()
    if (!hash.isNullOrEmpty()) o.put("hash", hash)
    call.resolve(o)
}

internal fun OmpNativePlugin.emitAudioOpen(hash: String) {
    if (listening("audioOpen")) {
        synchronized(OmpNativePlugin.magnetLock) {
            if (OmpNativePlugin.pendingAudioHash == hash) OmpNativePlugin.pendingAudioHash = null
        }
        emit("audioOpen", JSObject().put("hash", hash))
    }
}

internal fun OmpNativePlugin.audioStateOp(call: PluginCall) {
    audioMain.post {
        val svc = AudioPlayerService.instance
        val state = svc?.snapshotJson() ?: JSONObject().put("active", false)
        call.resolve(JSObject.fromJSONObject(state))
    }
}

private fun queuedState(queue: AudioQueue): JSONObject {
    val item = queue.items[queue.start]
    return AudioQueueParser.stateJson(
        active = true,
        playing = true,
        index = queue.start,
        positionMs = AudioSession.startOffset(item, queue.positionMs),
        durationMs = 0,
        speed = 1f,
        sleep = "off",
        title = item.title,
        book = queue.book,
        fileId = item.fileId,
        error = null,
        count = queue.items.size,
        hash = queue.hash,
    )
}
