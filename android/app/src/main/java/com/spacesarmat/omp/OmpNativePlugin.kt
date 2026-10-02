package com.spacesarmat.omp

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.net.toUri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PermissionState
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.spacesarmat.omp.control.TvRemote
import com.spacesarmat.omp.player.NativePlayerBridge
import com.spacesarmat.omp.player.PlayRequest
import com.spacesarmat.omp.player.PlayerActivity
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Transport for the phone client: SSDP, TV WebSockets, external player, APK update, magnet intake,
 * local player server (TV state in, commands out), embedded TorrServer ([TorrServerService]).
 * The SSAP protocol itself (register, requests, pairing) lives in TypeScript.
 *
 * Every PluginCall is settled exactly once (see [Once]). Blocking work runs on [io]; socket
 * callbacks arrive on OkHttp threads. Events: tvMessage { json }, tvClosed { reason },
 * apkProgress { percent }, magnetReceived { link }, playerMessage { body },
 * localServerState { running, error? }, nativePlayerState { session, index, time, duration, paused, buffering,
 * audio, subs }, nativePlayerClosed { session, index, time, duration, replaced? } (native player on Android TV);
 * phone remote on Android TV ([TvRemote]): remoteLaunch { params }, remoteAttach { report }, remoteKey { name },
 * remoteText { text | delete | enter }, phonePaired { phone }.
 */
@CapacitorPlugin(
    name = "OmpNative",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class OmpNativePlugin : Plugin() {
    private val io: ExecutorService = Executors.newCachedThreadPool()
    private val lock = Any()

    private var tv: TvSocket? = null
    private var tvIp: String? = null
    private var pendingConnect: Once? = null
    private var pointer: TvSocket? = null
    private var pendingPointer: Once? = null
    private val downloading = AtomicBoolean(false)
    private val player = PlayerServer { body -> notifyListeners("playerMessage", JSObject().put("body", body)) }
    // phone remote: only in TV mode
    private var remote: TvRemote? = null
    private val serverState = LocalTorrServer.Listener { running, error ->
        val o = JSObject().put("running", running)
        if (error != null) o.put("error", error)
        notifyListeners("localServerState", o)
    }

    override fun load() {
        instance = this
        NativePlayerBridge.emitter = { event, data -> notifyListeners(event, data) }
        LocalTorrServer.addListener(serverState)
        if (TvMode.isTv(context)) {
            val r = TvRemote(context.applicationContext) { event, data, retain -> notifyListeners(event, data, retain) }
            remote = r
            // binding a local port and NSD registration (async) are quick; synchronous so stop() never races start()
            r.start()
        }
        // a magnet that arrived before the bridge was ready
        synchronized(magnetLock) { pendingMagnet }?.let { emitMagnet(it) }
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        NativePlayerBridge.emitter = null
        LocalTorrServer.removeListener(serverState)
        closeAll()
        player.stop()
        remote?.stop()
        remote = null
        io.shutdownNow()
    }

    @PluginMethod
    fun isTv(call: PluginCall) {
        call.resolve(JSObject().put("tv", TvMode.isTv(context)))
    }

    // ---- discovery ----

    @PluginMethod
    fun discoverTvs(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
        io.execute {
            try {
                val tvs = Ssdp.discover(context, timeout)
                val arr = JSArray()
                for (t in tvs) {
                    val o = JSObject()
                    o.put("ip", t.ip)
                    o.put("name", t.name)
                    if (t.model != null) o.put("model", t.model)
                    arr.put(o)
                }
                once.resolve(JSObject().put("tvs", arr))
            } catch (e: Exception) {
                once.reject("Не удалось выполнить поиск телевизоров. Проверьте Wi-Fi")
            }
        }
    }

    // ---- main TV socket ----

    @PluginMethod
    fun tvConnect(call: PluginCall) {
        val once = Once(call)
        val ip = call.getString("ip")?.trim().orEmpty()
        val register = call.getString("register")
        if (!IPV4.matches(ip)) {
            once.reject("Некорректный адрес телевизора")
            return
        }
        if (register.isNullOrEmpty()) {
            once.reject("Нет сообщения регистрации")
            return
        }
        closeAll()
        var self: TvSocket? = null
        val socket = TvSocket(
            onOpen = { s ->
                if (!s.send(register)) {
                    s.close()
                    clearTv(s)
                    once.reject("Не удалось отправить запрос телевизору")
                } else {
                    synchronized(lock) { if (pendingConnect === once) pendingConnect = null }
                    once.resolve(JSObject().put("port", s.port))
                }
            },
            onFail = { _ ->
                clearTv(self)
                once.reject("Не удалось подключиться к телевизору")
            },
            onMessage = { text -> notifyListeners("tvMessage", JSObject().put("json", text)) },
            onClosed = { reason ->
                if (clearTv(self)) {
                    closePointer()
                    notifyListeners("tvClosed", JSObject().put("reason", reason))
                }
            },
        )
        self = socket
        synchronized(lock) {
            tv = socket
            tvIp = ip
            pendingConnect = once
        }
        val preferPort = call.getInt("preferPort")?.takeIf { it == 3000 || it == 3001 }
        socket.race(
            listOf(
                TvCandidate(3000, "ws://$ip:3000/", TvHttp.plain()),
                TvCandidate(3001, "wss://$ip:3001/", TvHttp.trustingOnly(ip)),
            ),
            preferPort,
        )
    }

    @PluginMethod
    fun tvSend(call: PluginCall) {
        val json = call.getString("json")
        val socket = synchronized(lock) { tv }
        when {
            json.isNullOrEmpty() -> call.reject("Пустое сообщение")
            socket == null || !socket.isOpen -> call.reject("Телевизор не подключён")
            !socket.send(json) -> call.reject("Не удалось отправить команду телевизору")
            else -> call.resolve()
        }
    }

    @PluginMethod
    fun tvDisconnect(call: PluginCall) {
        closeAll()
        call.resolve()
    }

    // ---- pointer socket ----

    @PluginMethod
    fun pointerConnect(call: PluginCall) {
        val once = Once(call)
        val raw = call.getString("url")?.trim().orEmpty()
        val ip = synchronized(lock) { if (tv?.isOpen == true) tvIp else null }
        if (ip == null) {
            once.reject("Телевизор не подключён")
            return
        }
        // OkHttp parses ws/wss as http/https
        val parsed = raw.replaceFirst(Regex("^ws", RegexOption.IGNORE_CASE), "http").toHttpUrlOrNull()
        if (parsed == null || !raw.matches(Regex("^wss?://.*", RegexOption.IGNORE_CASE)) || parsed.host != ip) {
            once.reject("Некорректный адрес пульта")
            return
        }
        closePointer()
        var self: TvSocket? = null
        val client = if (parsed.isHttps) TvHttp.trustingOnly(ip) else TvHttp.plain()
        val socket = TvSocket(
            onOpen = { _ ->
                synchronized(lock) { if (pendingPointer === once) pendingPointer = null }
                once.resolve()
            },
            onFail = { _ ->
                clearPointer(self)
                once.reject("Не удалось подключиться к пульту телевизора")
            },
            onMessage = { _ -> },
            onClosed = { _ -> clearPointer(self) },
        )
        self = socket
        synchronized(lock) {
            pointer = socket
            pendingPointer = once
        }
        socket.connect(listOf(raw), listOf(client))
    }

    @PluginMethod
    fun pointerSend(call: PluginCall) {
        val frame = call.getString("frame")
        val socket = synchronized(lock) { pointer }
        when {
            frame.isNullOrEmpty() -> call.reject("Пустая команда")
            socket == null || !socket.isOpen -> call.reject("Пульт телевизора не подключён")
            !socket.send(frame) -> call.reject("Не удалось отправить команду телевизору")
            else -> call.resolve()
        }
    }

    /** Forgets [only] if it is still the current TV socket; true if it was. */
    private fun clearTv(only: TvSocket?): Boolean =
        synchronized(lock) {
            if (only != null && tv === only) {
                tv = null
                tvIp = null
                pendingConnect = null
                true
            } else {
                false
            }
        }

    private fun clearPointer(only: TvSocket?) {
        synchronized(lock) {
            if (only != null && pointer === only) {
                pointer = null
                pendingPointer = null
            }
        }
    }

    private fun closePointer() {
        val (socket, pending) = synchronized(lock) {
            val r = pointer to pendingPointer
            pointer = null
            pendingPointer = null
            r
        }
        socket?.close()
        pending?.reject("Подключение отменено")
    }

    /** Silent close of both sockets; a pending tvConnect is rejected. No tvClosed event. */
    private fun closeAll() {
        closePointer()
        val (socket, pending) = synchronized(lock) {
            val r = tv to pendingConnect
            tv = null
            tvIp = null
            pendingConnect = null
            r
        }
        socket?.close()
        pending?.reject("Подключение отменено")
    }

    // ---- player server (TV -> phone state, phone -> TV commands) ----

    @PluginMethod
    fun startPlayerServer(call: PluginCall) {
        val once = Once(call)
        val ip = call.getString("tvIp")?.trim().orEmpty()
        io.execute {
            try {
                once.resolve(JSObject().put("url", player.start(ip)))
            } catch (e: UserError) {
                once.reject(e.message ?: "Не удалось запустить управление плеером")
            } catch (_: Exception) {
                once.reject("Не удалось запустить управление плеером")
            }
        }
    }

    @PluginMethod
    fun stopPlayerServer(call: PluginCall) {
        player.stop()
        call.resolve()
    }

    @PluginMethod
    fun queuePlayerCommands(call: PluginCall) {
        val json = call.getString("json")
        val cmds = try {
            if (json.isNullOrEmpty()) null else JSONArray(json)
        } catch (_: JSONException) {
            null
        }
        if (cmds == null) {
            call.reject("Некорректные команды")
            return
        }
        player.enqueue(cmds)
        call.resolve()
    }

    // ---- Wake-on-LAN ----

    @PluginMethod
    fun wakeOnLan(call: PluginCall) {
        val once = Once(call)
        val mac = call.getString("mac")?.trim().orEmpty()
        val ip = call.getString("ip")?.trim().orEmpty()
        val packet = WakeOnLan.magicPacket(mac)
        if (packet == null || !IPV4.matches(ip)) {
            once.reject("Не удалось включить телевизор")
            return
        }
        io.execute {
            try {
                WakeOnLan.send(packet, ip)
                once.resolve()
            } catch (_: Exception) {
                once.reject("Не удалось отправить сигнал включения")
            }
        }
    }

    // ---- external player ----

    @PluginMethod
    fun openExternal(call: PluginCall) {
        val url = call.getString("url")?.trim().orEmpty()
        val mime = call.getString("mime")?.trim().orEmpty().ifEmpty { "video/*" }
        if (url.isEmpty()) {
            call.reject("Нет ссылки на видео")
            return
        }
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(url.toUri(), mime)
        val chooser = Intent.createChooser(view, "Открыть в плеере")
        try {
            val act = activity
            if (act != null) act.startActivity(chooser)
            else context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (_: ActivityNotFoundException) {
            call.reject("Нет приложения для просмотра видео")
        } catch (_: RuntimeException) {
            call.reject("Не удалось открыть плеер")
        }
    }

    // ---- native player (Android TV) ----

    /** Opens [PlayerActivity] with the queue (an open player takes the new queue over); resolves once launched. */
    @PluginMethod
    fun playNative(call: PluginCall) {
        val req = PlayRequest.parse(call.data)
        if (req == null) {
            call.reject("Нечего воспроизводить")
            return
        }
        NativePlayerBridge.request = req
        // REORDER_TO_FRONT: an open player below the TV interface takes the queue over (no second instance)
        val intent = Intent(context, PlayerActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        try {
            val act = activity
            if (act != null) act.startActivity(intent)
            else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (_: RuntimeException) {
            call.reject("Не удалось запустить плеер")
        }
    }

    // ---- phone remote (Android TV) ----

    /** A new 4-digit pairing code (the previous one stops working): { code, expiresAt } (epoch ms). */
    @PluginMethod
    fun pairingCode(call: PluginCall) {
        val r = remote
        if (r == null) {
            call.reject("Управление с телефона недоступно")
            return
        }
        val c = r.pairing.newCode()
        call.resolve(JSObject().put("code", c.code).put("expiresAt", c.expiresAt))
    }

    /** The TV name the phone shows: { name }. */
    @PluginMethod
    fun tvName(call: PluginCall) {
        val r = remote
        if (r == null) {
            call.reject("Управление с телефона недоступно")
            return
        }
        call.resolve(JSObject().put("name", r.name()))
    }

    /** A phone command for the open native player ({ cmd: Cmd }). */
    @PluginMethod
    fun nativePlayerCommand(call: PluginCall) {
        val cmd = call.getObject("cmd")
        when {
            cmd == null -> call.reject("Некорректная команда")
            !NativePlayerBridge.command(cmd) -> call.reject("Плеер не открыт")
            else -> call.resolve()
        }
    }

    // ---- APK update ----

    @PluginMethod
    fun downloadAndInstallApk(call: PluginCall) {
        val once = Once(call)
        val url = call.getString("url")?.trim().orEmpty()
        val sha = call.getString("sha256").orEmpty()
        if (!ApkInstaller.canInstall(context)) {
            try {
                ApkInstaller.openInstallPermissionSettings(context)
            } catch (_: RuntimeException) {
            }
            once.reject("Разрешите установку из OMP и повторите установку")
            return
        }
        if (!downloading.compareAndSet(false, true)) {
            once.reject("Обновление уже скачивается")
            return
        }
        io.execute {
            try {
                val apk = ApkInstaller.download(context, url, sha) { p ->
                    notifyListeners("apkProgress", JSObject().put("percent", p))
                }
                ApkInstaller.install(context, apk)
                once.resolve()
            } catch (e: UserError) {
                once.reject(e.message ?: "Не удалось установить обновление")
            } catch (_: Exception) {
                once.reject("Не удалось установить обновление")
            } finally {
                downloading.set(false)
            }
        }
    }

    // ---- embedded TorrServer ----

    @PluginMethod
    fun localServerInfo(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(localInfo())
            } catch (_: Exception) {
                once.reject("Не удалось узнать состояние сервера")
            }
        }
    }

    @PluginMethod
    fun startLocalServer(call: PluginCall) {
        if (!LocalTorrServer.supported(context)) {
            call.reject(NOT_SUPPORTED)
            return
        }
        // without the permission the service still runs, only its notification is hidden
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "startAfterPermission")
            return
        }
        startLocal(call)
    }

    @PermissionCallback
    private fun startAfterPermission(call: PluginCall) {
        startLocal(call)
    }

    private fun startLocal(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                runLocal()
                once.resolve(localInfo())
            } catch (e: UserError) {
                once.reject(e.message ?: START_FAILED)
            } catch (_: Exception) {
                once.reject(START_FAILED)
            }
        }
    }

    @PluginMethod
    fun stopLocalServer(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                stopLocal()
                once.resolve()
            } catch (_: Exception) {
                once.reject("Не удалось остановить сервер")
            }
        }
    }

    @PluginMethod
    fun localServerCache(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(JSObject().put("usedBytes", LocalTorrServer.dirSize(LocalTorrServer.cacheDir(context))))
            } catch (_: Exception) {
                once.reject("Не удалось узнать размер кэша")
            }
        }
    }

    @PluginMethod
    fun clearLocalServerCache(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                val wasRunning = LocalTorrServer.running
                if (wasRunning) stopLocal()
                LocalTorrServer.clearDir(LocalTorrServer.cacheDir(context))
                if (wasRunning) runLocal()
                once.resolve(JSObject().put("usedBytes", LocalTorrServer.dirSize(LocalTorrServer.cacheDir(context))))
            } catch (e: UserError) {
                once.reject(e.message ?: "Не удалось очистить кэш")
            } catch (_: Exception) {
                once.reject("Не удалось очистить кэш")
            }
        }
    }

    @PluginMethod
    fun localIpv4(call: PluginCall) {
        call.resolve(JSObject().put("ip", LocalTorrServer.wifiIpv4(context) ?: JSONObject.NULL))
    }

    private fun localInfo(): JSObject {
        val o = JSObject()
        o.put("supported", LocalTorrServer.supported(context))
        val running = LocalTorrServer.running
        o.put("running", running)
        if (running) {
            val v = LocalTorrServer.version ?: LocalTorrServer.echo(500)?.also { LocalTorrServer.version = it }
            if (v != null) o.put("version", v)
        }
        LocalTorrServer.wifiIpv4(context)?.let { o.put("ip", it) }
        o.put("vpn", LocalTorrServer.vpnActive(context))
        LocalTorrServer.error?.let { o.put("error", it) }
        return o
    }

    /** Starts the service and waits for `/echo` (300 ms steps, 15 s); configures the cache once. Blocking. */
    private fun runLocal() {
        val failures = LocalTorrServer.failures
        try {
            TorrServerService.start(context)
        } catch (_: RuntimeException) {
            throw UserError(START_FAILED)
        }
        val deadline = System.currentTimeMillis() + 15_000
        var version: String? = null
        while (System.currentTimeMillis() < deadline) {
            // only our own process counts (another app may hold the port)
            if (LocalTorrServer.running) {
                version = LocalTorrServer.echo(1000)
                if (version != null) break
            } else if (LocalTorrServer.failures != failures) {
                // the process gave up (port taken, crashed twice)
                throw UserError(LocalTorrServer.error ?: START_FAILED)
            }
            Thread.sleep(300)
        }
        if (version == null) {
            TorrServerService.stop(context)
            throw UserError("TorrServer не ответил за 15 секунд")
        }
        LocalTorrServer.version = version
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(CACHE_SET, false) && LocalTorrServer.configureCache(context)) {
            prefs.edit().putBoolean(CACHE_SET, true).apply()
        }
    }

    /** Stops the service and waits up to 6 s for the process to end. Blocking. */
    private fun stopLocal() {
        TorrServerService.stop(context)
        val deadline = System.currentTimeMillis() + 6_000
        while (LocalTorrServer.running && System.currentTimeMillis() < deadline) Thread.sleep(100)
    }

    // ---- magnet ----

    @PluginMethod
    fun takePendingMagnet(call: PluginCall) {
        val link = synchronized(magnetLock) {
            val l = pendingMagnet
            pendingMagnet = null
            l
        }
        call.resolve(JSObject().put("link", link ?: JSONObject.NULL))
    }

    private fun emitMagnet(link: String) {
        // delivered to a live listener: no longer pending
        if (hasListeners("magnetReceived")) {
            synchronized(magnetLock) { if (pendingMagnet == link) pendingMagnet = null }
            notifyListeners("magnetReceived", JSObject().put("link", link))
        }
    }

    /** Settles a PluginCall at most once, from any thread. */
    private class Once(private val call: PluginCall) {
        private val done = AtomicBoolean(false)
        fun resolve(data: JSObject? = null) {
            if (done.compareAndSet(false, true)) {
                if (data == null) call.resolve() else call.resolve(data)
            }
        }
        fun reject(message: String) {
            if (done.compareAndSet(false, true)) call.reject(message)
        }
    }

    companion object {
        private const val NOT_SUPPORTED = "Встроенный сервер недоступен на этом телефоне"
        private const val START_FAILED = "Не удалось запустить сервер"
        private const val PREFS = "omp-native"
        private const val CACHE_SET = "torrserverCacheConfigured"
        private val IPV4 = Regex("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$")
        private val magnetLock = Any()
        private var pendingMagnet: String? = null

        @Volatile
        private var instance: OmpNativePlugin? = null

        /** Called by MainActivity for every incoming magnet: kept as pending and sent as an event. */
        fun deliverMagnet(link: String) {
            synchronized(magnetLock) { pendingMagnet = link }
            instance?.emitMagnet(link)
        }

        /** magnet link from VIEW magnet:… or SEND text/plain containing "magnet:?". */
        fun magnetFrom(intent: Intent?): String? {
            if (intent == null) return null
            return when (intent.action) {
                Intent.ACTION_VIEW -> {
                    val data = intent.data
                    if (data?.scheme.equals("magnet", ignoreCase = true)) intent.dataString else null
                }
                Intent.ACTION_SEND -> {
                    if (intent.type?.startsWith("text/plain") != true) return null
                    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
                    val start = text.indexOf("magnet:?", ignoreCase = true)
                    if (start < 0) return null
                    val end = text.indexOfFirst(start) { it.isWhitespace() }
                    text.substring(start, end)
                }
                else -> null
            }
        }

        private inline fun String.indexOfFirst(from: Int, pred: (Char) -> Boolean): Int {
            for (i in from until length) if (pred(this[i])) return i
            return length
        }
    }
}
