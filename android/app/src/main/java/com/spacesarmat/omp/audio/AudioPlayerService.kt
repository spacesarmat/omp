package com.spacesarmat.omp.audio

import com.spacesarmat.omp.tls.TorrServerTrust
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.spacesarmat.omp.I18n
import com.spacesarmat.omp.LocalTorrServer
import com.spacesarmat.omp.MainActivity
import com.spacesarmat.omp.OmpNativePlugin
import com.spacesarmat.omp.R
import com.spacesarmat.omp.TorrServerService
import org.json.JSONObject

/**
 * Audiobook playback: its own ExoPlayer and Media3 session ([AudioSession.ID]), not player-core's PlaybackService.
 * The shade and the lock screen get ±30s, previous/next chapter and play/pause. Audio focus and unplugging
 * headphones are ExoPlayer's (`handleAudioFocus`, `handleAudioBecomingNoisy`).
 *
 * While a queue points at the embedded TorrServer, [TorrServerService] stays in the foreground with its locks held,
 * so the stream does not die when the phone is locked.
 */
@OptIn(UnstableApi::class)
class AudioPlayerService : MediaSessionService() {
    private val main = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var session: MediaSession? = null
    private var queue: AudioQueue? = null
    private var sleepMode = AudioSession.SLEEP_OFF
    private var sleepDeadline = 0L
    private var lastError: String? = null
    private var authHeader: String? = null

    private val ticker = object : Runnable {
        override fun run() {
            val p = player ?: return
            if (sleepDeadline > 0L && SystemClock.elapsedRealtime() >= sleepDeadline) {
                sleepDeadline = 0L
                sleepMode = AudioSession.SLEEP_OFF
                p.pause()
            }
            publish()
            main.postDelayed(this, 1000)
        }
    }

    private val sessionCallback = object : MediaSession.Callback {
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
                .add(SessionCommand(AudioSession.CMD_PREV, Bundle.EMPTY))
                .add(SessionCommand(AudioSession.CMD_NEXT, Bundle.EMPTY))
                .build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands)
                .setAvailablePlayerCommands(session.player.availableCommands)
                .build()
        }

        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            when (customCommand.customAction) {
                AudioSession.CMD_PREV -> control(AudioCommand("prev"))
                AudioSession.CMD_NEXT -> control(AudioCommand("next"))
            }
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }
    }

    private val events = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            publish()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM && sleepMode == AudioSession.SLEEP_CHAPTER) {
                sleepMode = AudioSession.SLEEP_OFF
                player?.pauseAtEndOfMediaItems = false
            }
            publish()
        }

        override fun onPlayerError(error: PlaybackException) {
            lastError = I18n.s("audio.playFailed")
            publish()
        }
    }

    override fun onCreate() {
        super.onCreate()
        I18n.load(this)
        TorrServerTrust.install(this)
        ensureChannel()
        val notifications = DefaultMediaNotificationProvider.Builder(this)
            .setChannelId(AudioSession.CHANNEL_ID)
            .setNotificationId(AudioSession.NOTIFICATION_ID)
            .build()
        notifications.setSmallIcon(R.drawable.ic_stat_server)
        setMediaNotificationProvider(notifications)
        val exo = newPlayer()
        player = exo
        val media = MediaSession.Builder(this, exo)
            .setId(AudioSession.ID)
            .setCallback(sessionCallback)
            .setSessionActivity(openApp(""))
            .build()
        session = media
        applyButtons(media)
        addSession(media)
        instance = this
        main.post(ticker)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PLAY) {
            val next = takePending()
            if (next != null) applyQueue(next)
        }
        return super.onStartCommand(intent, flags, startId)
    }

    override fun onDestroy() {
        main.removeCallbacks(ticker)
        instance = null
        TorrServerService.holdForAudio(this, false)
        session?.run {
            player.release()
            release()
        }
        session = null
        player = null
        super.onDestroy()
    }

    /** Runs on the main thread. Null when nothing is loaded. */
    fun control(cmd: AudioCommand): JSONObject? {
        val p = player ?: return null
        val q = queue ?: return snapshot(false)
        val recover = AudioSession.resumeNeedsPrepare(lastError != null, p.playbackState)
        if (cmd.name != "toggle" && cmd.name != "play") lastError = null
        when (cmd.name) {
            "toggle" -> if (p.isPlaying && !recover) p.pause() else resume(p, recover)
            "play" -> resume(p, recover)
            "pause" -> p.pause()
            "seek" -> {
                val dur = p.duration
                val max = if (dur > 0) dur else Long.MAX_VALUE / 4
                p.seekTo((p.currentPosition + cmd.ms).coerceIn(0, max))
            }
            "next" -> if (p.hasNextMediaItem()) p.seekToNextMediaItem()
            "prev" -> if (p.hasPreviousMediaItem()) p.seekToPreviousMediaItem() else p.seekTo(0)
            "speed" -> p.setPlaybackSpeed(AudioSession.clampSpeed(cmd.speed))
            "sleep" -> armSleep(cmd.sleep)
            "stop" -> {
                p.stop()
                stopSelf()
            }
        }
        publish()
        return snapshot(q.items.isNotEmpty())
    }

    fun snapshotJson(): JSONObject = snapshot(queue != null)

    private fun applyQueue(q: AudioQueue) {
        val p = player ?: return
        queue = q
        lastError = null
        sleepMode = AudioSession.SLEEP_OFF
        sleepDeadline = 0L
        p.pauseAtEndOfMediaItems = false
        val (header, items) = mediaItems(q)
        if (header != authHeader) {
            authHeader = header
            replacePlayer(header)
        }
        val exo = player ?: return
        val offset = AudioSession.startOffset(q.items[q.start], q.positionMs)
        exo.setMediaItems(items, q.start, offset)
        exo.setPlaybackSpeed(1f)
        exo.prepare()
        exo.play()
        session?.setSessionActivity(openApp(q.hash))
        applyButtons(session)
        holdServer(q)
        publish()
    }

    /** prepare() again after an error. A normal pause stays put: speed, sleep and position are kept. */
    private fun resume(p: ExoPlayer, recover: Boolean) {
        if (recover) {
            lastError = null
            p.prepare()
        }
        p.play()
    }

    private fun replacePlayer(header: String?) {
        val old = player ?: return
        old.removeListener(events)
        val exo = newPlayer(header)
        player = exo
        session?.player = exo
        applyButtons(session)
        old.release()
    }

    private fun newPlayer(header: String? = authHeader): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("OMP")
            .setAllowCrossProtocolRedirects(true)
        if (!header.isNullOrEmpty()) http.setDefaultRequestProperties(mapOf("Authorization" to header))
        val attrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
            .build()
        val exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(this).setDataSourceFactory(http))
            .setAudioAttributes(attrs, /* handleAudioFocus = */ true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setSeekBackIncrementMs(AudioSession.SEEK_MS)
            .setSeekForwardIncrementMs(AudioSession.SEEK_MS)
            .build()
        // Offload stays off. Samsung's COMPRESS_OFFLOAD path rejects setPlaybackParams, which breaks speed.
        // Media3's default is already disabled; set it so a later default cannot turn offload on.
        exo.trackSelectionParameters = exo.trackSelectionParameters
            .buildUpon()
            .setAudioOffloadPreferences(
                TrackSelectionParameters.AudioOffloadPreferences.Builder()
                    .setAudioOffloadMode(TrackSelectionParameters.AudioOffloadPreferences.AUDIO_OFFLOAD_MODE_DISABLED)
                    .build(),
            )
            .build()
        exo.addListener(events)
        return exo
    }

    private fun mediaItems(q: AudioQueue): Pair<String?, List<MediaItem>> {
        var header: String? = null
        val total = q.items.size
        val items = q.items.mapIndexed { i, item ->
            val (url, auth) = AudioQueueParser.splitCredentials(item.url)
            if (header == null && auth != null) header = auth
            val clip = MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs(item.startMs)
                .apply { if (item.endMs > item.startMs) setEndPositionMs(item.endMs) }
                .build()
            val place = AudioQueueParser.trackPlace(i, total)
            MediaItem.Builder()
                .setUri(url)
                .setMediaId(item.fileId.toString() + ":" + item.startMs)
                .setClippingConfiguration(clip)
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(place)
                        .setSubtitle(item.title)
                        .setDisplayTitle(place)
                        .setArtist(item.title)
                        .setAlbumTitle(q.book)
                        .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK)
                        .build(),
                )
                .build()
        }
        return header to items
    }

    private fun armSleep(sleep: String) {
        val p = player ?: return
        val mode = AudioSession.normalizeSleep(sleep)
        sleepMode = mode
        sleepDeadline = AudioSession.sleepDeadline(mode, SystemClock.elapsedRealtime()) ?: 0L
        p.pauseAtEndOfMediaItems = AudioSession.sleepIsChapter(mode)
    }

    private fun holdServer(q: AudioQueue) {
        val local = q.items.any { AudioQueueParser.targetsLocalTorrServer(it.url) }
        if (local && LocalTorrServer.running) TorrServerService.holdForAudio(this, true)
        else TorrServerService.holdForAudio(this, false)
    }

    private fun applyButtons(media: MediaSession?) {
        if (media == null) return
        val prev = SessionCommand(AudioSession.CMD_PREV, Bundle.EMPTY)
        val next = SessionCommand(AudioSession.CMD_NEXT, Bundle.EMPTY)
        media.setMediaButtonPreferences(
            listOf(
                customButton(CommandButton.ICON_PREVIOUS, CommandButton.SLOT_BACK, "audio.notify.prev", prev),
                playerButton(Player.COMMAND_SEEK_BACK, CommandButton.ICON_SKIP_BACK, CommandButton.SLOT_BACK_SECONDARY, "audio.notify.back"),
                playerButton(Player.COMMAND_SEEK_FORWARD, CommandButton.ICON_SKIP_FORWARD, CommandButton.SLOT_FORWARD_SECONDARY, "audio.notify.forward"),
                customButton(CommandButton.ICON_NEXT, CommandButton.SLOT_FORWARD, "audio.notify.next", next),
                playerButton(Player.COMMAND_STOP, CommandButton.ICON_STOP, CommandButton.SLOT_OVERFLOW, "audio.notify.stop"),
            ),
        )
    }

    private fun customButton(icon: Int, slot: Int, key: String, command: SessionCommand): CommandButton =
        CommandButton.Builder(icon)
            .setSessionCommand(command)
            .setSlots(slot)
            .setDisplayName(I18n.s(key))
            .build()

    private fun playerButton(command: Int, icon: Int, slot: Int, key: String): CommandButton =
        CommandButton.Builder(icon)
            .setPlayerCommand(command)
            .setSlots(slot)
            .setDisplayName(I18n.s(key))
            .build()

    private fun publish() {
        if (queue == null) return
        OmpNativePlugin.deliverAudio(snapshot(true))
    }

    private fun snapshot(active: Boolean): JSONObject {
        val p = player
        val q = queue
        val index = p?.currentMediaItemIndex ?: q?.start ?: 0
        val item = q?.items?.getOrNull(index)
        val speed = p?.playbackParameters?.speed ?: 1f
        val left = if (sleepDeadline > 0L) (sleepDeadline - SystemClock.elapsedRealtime()).coerceAtLeast(0) else 0L
        return AudioQueueParser.stateJson(
            active = active && q != null,
            playing = p?.isPlaying == true,
            index = index,
            positionMs = p?.currentPosition?.coerceAtLeast(0) ?: 0,
            durationMs = p?.duration?.takeIf { it > 0 } ?: 0,
            speed = AudioSession.clampSpeed(speed),
            sleep = sleepMode,
            title = item?.title ?: q?.book.orEmpty(),
            book = q?.book.orEmpty(),
            fileId = item?.fileId ?: 0,
            error = lastError,
            sleepLeftMs = left,
            count = q?.items?.size ?: 0,
            hash = q?.hash.orEmpty(),
        )
    }

    private fun openApp(hash: String): PendingIntent {
        val open = Intent(this, MainActivity::class.java)
            .setAction(AudioSession.OPEN_ACTION)
            .putExtra(AudioSession.EXTRA_HASH, hash)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        return PendingIntent.getActivity(this, 7, open, flags)
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(AudioSession.CHANNEL_ID, I18n.s("audio.channel"), NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_PLAY = "com.spacesarmat.omp.audio.PLAY"

        @Volatile
        var instance: AudioPlayerService? = null
            private set

        private val gate = Any()
        private var pending: AudioQueue? = null

        fun play(ctx: Context, queue: AudioQueue) {
            synchronized(gate) { pending = queue }
            ContextCompat.startForegroundService(
                ctx,
                Intent(ctx, AudioPlayerService::class.java).setAction(ACTION_PLAY),
            )
        }

        fun takePending(): AudioQueue? = synchronized(gate) {
            val q = pending
            pending = null
            q
        }

    }
}
