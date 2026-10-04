package com.spacesarmat.omp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
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
import com.spacesarmat.omp.control.AppForeground
import com.spacesarmat.omp.control.CloudflareProtocol
import com.spacesarmat.omp.control.CloudflareRelay
import com.spacesarmat.omp.control.CloudflareWatch
import com.spacesarmat.omp.control.HttpWatchTransport
import com.spacesarmat.omp.control.SourcesDone
import com.spacesarmat.omp.control.TvRemote
import com.spacesarmat.omp.install.AdbIdentity
import com.spacesarmat.omp.install.AdbIdentityStore
import com.spacesarmat.omp.install.AesGcmWrapper
import com.spacesarmat.omp.install.ApkAbi
import com.spacesarmat.omp.install.AtvAdbInstaller
import com.spacesarmat.omp.install.CancelToken
import com.spacesarmat.omp.install.DadbConnector
import com.spacesarmat.omp.install.DevModeReminder
import com.spacesarmat.omp.install.HttpKeyServer
import com.spacesarmat.omp.install.InstallCodes
import com.spacesarmat.omp.install.InstallRequest
import com.spacesarmat.omp.install.InstallRunner
import com.spacesarmat.omp.install.JschConnector
import com.spacesarmat.omp.install.LgDevModeInstaller
import com.spacesarmat.omp.install.OkReleaseHttp
import com.spacesarmat.omp.install.ReleaseDownloader
import com.spacesarmat.omp.install.Releases
import com.spacesarmat.omp.install.failureOf
import com.spacesarmat.omp.monitor.MonitorNotifier
import com.spacesarmat.omp.monitor.MonitorPlan
import com.spacesarmat.omp.monitor.MonitorScheduler
import com.spacesarmat.omp.player.NativePlayerBridge
import com.spacesarmat.omp.player.PlayRequest
import com.spacesarmat.omp.player.PlayerActivity
import com.spacesarmat.omp.sources.CheckTarget
import com.spacesarmat.omp.sources.CheckTexts
import com.spacesarmat.omp.sources.CloudflareCheckDialog
import com.spacesarmat.omp.sources.CloudflareSolver
import com.spacesarmat.omp.sources.MainScheduler
import com.spacesarmat.omp.sources.VisibleCheck
import com.spacesarmat.omp.sources.WebViewCloudflareBrowser
import com.spacesarmat.omp.sources.HttpSpec
import com.spacesarmat.omp.sources.SiteHttp
import com.spacesarmat.omp.sources.SiteHttpException
import com.spacesarmat.omp.sources.SourceServices
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Transport for the phone client: SSDP and NSD discovery, TV WebSockets, external player, APK update, magnet intake,
 * local player server (TV state in, commands out), embedded TorrServer ([TorrServerService]).
 * Search sources: site HTTP ([SiteHttp], cookies per site) and Keystore-encrypted secrets ([SecretStorage]).
 * The SSAP protocol itself (register, requests, pairing) lives in TypeScript.
 *
 * Every PluginCall is settled exactly once (see [Once]). Blocking work runs on [io]; socket
 * callbacks arrive on OkHttp threads. Events: tvMessage { json }, tvClosed { reason },
 * apkProgress { percent }, magnetReceived { link }, playerMessage { body }, monitorOpen { url }, monitorDone { summary? },
 * localServerState { running, error? }, localServerDownload { percent? , phase: download|verify }, nativePlayerState { session, index, time, duration, paused, buffering,
 * audio, subs }, nativePlayerClosed { session, index, time, duration, replaced? } (native player on Android TV);
 * phone remote on Android TV ([TvRemote]): remoteLaunch { params }, remoteAttach { report }, remoteKey { name },
 * remoteText { text | delete | enter }, phonePaired { phone }, remoteSources { id, sources, rutracker, phone }.
 * Install assistant ([com.spacesarmat.omp.install]): installProgress { phase, item, percent?, version? }.
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
    private val installing = AtomicBoolean(false)
    @Volatile
    private var installCancel: CancelToken? = null
    private val player = PlayerServer { body -> notifyListeners("playerMessage", JSObject().put("body", body)) }
    // phone remote: only in TV mode
    private var remote: TvRemote? = null
    // search sources: created on first use (Keystore access off the main thread)
    // one per process, shared with the background monitor page ([SourceServices])
    private val sources by lazy { SourceServices.get(context) }
    private val serverState = LocalTorrServer.Listener { running, error ->
        val o = JSObject().put("running", running)
        if (error != null) o.put("error", error)
        notifyListeners("localServerState", o)
    }

    private val downloadProgress = LocalTorrServer.DownloadListener { phase, percent ->
        val o = JSObject().put("phase", phase)
        if (percent != null) o.put("percent", percent)
        notifyListeners("localServerDownload", o)
    }

    override fun load() {
        instance = this
        LocalTorrServer.addDownloadListener(downloadProgress)
        purgeSharedFiles(10 * 60 * 1000L)
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
        synchronized(magnetLock) { pendingOpen }?.let { emitMonitorOpen(it) }
    }

    override fun handleOnDestroy() {
        cfCheck?.let { c -> activity?.runOnUiThread { c.cancel() } ?: c.cancel() }
        if (instance === this) instance = null
        NativePlayerBridge.emitter = null
        LocalTorrServer.removeListener(serverState)
        LocalTorrServer.removeDownloadListener(downloadProgress)
        closeAll()
        player.stop()
        remote?.stop()
        remote = null
        // blocking socket I/O ignores interrupts: close the install's sockets so it ends now
        installCancel?.cancel()
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

    /** NSD search for OMP on Android TV: { tvs: [{ ip, port, name, version }] }. */
    @PluginMethod
    fun discoverOmpTvs(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
        val group = searchGroup(call)
        io.execute {
            try {
                val arr = JSArray()
                for (t in OmpDiscovery.discover(context, timeout, group)) {
                    arr.put(
                        JSObject().put("ip", t.ip).put("port", t.port).put("name", t.name).put("version", t.version),
                    )
                }
                once.resolve(JSObject().put("tvs", arr))
            } catch (e: Exception) {
                once.reject("Не удалось выполнить поиск телевизоров. Проверьте Wi-Fi")
            }
        }
    }

    /** Install assistant: NSD search for Google Cast devices: { tvs: [{ ip, name, model? }] }. */
    @PluginMethod
    fun discoverCastTvs(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: 3000).coerceIn(500, 15000).toLong()
        val group = searchGroup(call)
        io.execute {
            try {
                val arr = JSArray()
                for (t in CastDiscovery.discover(context, timeout, group)) {
                    val o = JSObject().put("ip", t.ip).put("name", t.name)
                    if (t.model != null) o.put("model", t.model)
                    arr.put(o)
                }
                once.resolve(JSObject().put("tvs", arr))
            } catch (e: Exception) {
                once.reject("Не удалось выполнить поиск телевизоров. Проверьте Wi-Fi")
            }
        }
    }

    /** Optional search group of a discovery call (one per screen); at most 64 characters. */
    private fun searchGroup(call: PluginCall): String? = call.getString("group")?.trim()?.take(64)?.takeIf { it.isNotEmpty() }

    /** { group }: stops only the NSD searches started with that group (the screen has gone); they return what they found. */
    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        searchGroup(call)?.let { OmpDiscovery.cancelGroup(it) }
        call.resolve()
    }

    /** Install assistant: which of the install ports ([PortProbe.ALLOWED]) answer on a home-network IP: { open: [] }. */
    @PluginMethod
    fun probePorts(call: PluginCall) {
        val once = Once(call)
        val ip = call.getString("ip")?.trim().orEmpty()
        val timeout = (call.getInt("timeoutMs") ?: 1500).coerceIn(200, 5000)
        val ports = ArrayList<Int>()
        val raw = call.getArray("ports")
        if (raw != null) {
            for (i in 0 until raw.length()) {
                val p = raw.optInt(i, -1)
                if (p > 0) ports.add(p)
            }
        }
        if (!PortProbe.isPrivateIpv4(ip)) {
            once.reject("Неверный адрес телевизора")
            return
        }
        io.execute {
            val arr = JSArray()
            for (p in PortProbe.open(ip, ports, timeout)) arr.put(p)
            once.resolve(JSObject().put("open", arr))
        }
    }

    /**
     * «Источники поиска»: hosts of the device's /24 that answer on the Jackett / Prowlarr / FlareSolverr ports ([LanScan.ALLOWED]):
     * { hits: [{ ip, port }], lan }. Without a Wi-Fi IPv4 (mobile data) lan is false and nothing is scanned. Nothing is logged.
     */
    @PluginMethod
    fun scanLan(call: PluginCall) {
        val once = Once(call)
        val timeout = (call.getInt("timeoutMs") ?: LanScan.DEFAULT_TIMEOUT_MS).coerceIn(150, 1500)
        val ports = ArrayList<Int>()
        val raw = call.getArray("ports")
        if (raw != null) {
            for (i in 0 until raw.length()) {
                val p = raw.optInt(i, -1)
                if (p > 0) ports.add(p)
            }
        }
        io.execute {
            val arr = JSArray()
            val ip = LocalTorrServer.wifiIpv4(context)
            if (ip != null) {
                for (h in LanScan.scan(ip, ports, timeout)) arr.put(JSObject().put("ip", h.ip).put("port", h.port))
            }
            once.resolve(JSObject().put("hits", arr).put("lan", ip != null))
        }
    }

    // ---- install assistant: install OMP on a TV ----

    /**
     * Installs OMP on an LG TV in Developer Mode ({ method: 'lg-devmode', ip, passphrase, withHbc }) or an Android TV
     * over adb ({ method: 'atv-adb', ip }). Progress: events installProgress { phase, percent?, item, version? }.
     * Resolves { version, hbcVersion?, hbcError?, sdkInt?, abi? }; rejects with an InstallCodes code as message and
     * code. One install at a time; nothing is logged (addresses, passphrase, key).
     */
    @PluginMethod
    fun installStart(call: PluginCall) {
        val once = Once(call)
        val method = call.getString("method").orEmpty()
        val ip = call.getString("ip")?.trim().orEmpty()
        val withHbc = call.getBoolean("withHbc", false) == true
        val pass = call.getString("passphrase")?.toCharArray()
        if (!PortProbe.isPrivateIpv4(ip) || (method != InstallRequest.LG && method != InstallRequest.ATV)) {
            pass?.fill('\u0000')
            once.reject(InstallCodes.BAD_TARGET, InstallCodes.BAD_TARGET)
            return
        }
        if (!installing.compareAndSet(false, true)) {
            pass?.fill('\u0000')
            once.reject(InstallCodes.BUSY, InstallCodes.BUSY)
            return
        }
        val cancel = CancelToken()
        installCancel = cancel
        val req = InstallRequest(method, ip, pass, withHbc)
        io.execute {
            try {
                val http = OkReleaseHttp()
                val runner = InstallRunner(
                    Releases(http),
                    ReleaseDownloader(http, File(context.cacheDir, "install")),
                    LgDevModeInstaller(HttpKeyServer(), JschConnector()),
                    AtvAdbInstaller(DadbConnector(adbIdentities())),
                )
                val out = runner.run(req, { phase, percent, item, version ->
                    val o = JSObject().put("phase", phase.id).put("item", item.id)
                    if (percent != null) o.put("percent", percent)
                    if (version != null) o.put("version", version)
                    notifyListeners("installProgress", o)
                }, cancel)
                val r = JSObject().put("version", out.version)
                out.hbcVersion?.let { r.put("hbcVersion", it) }
                out.hbcError?.let { r.put("hbcError", it) }
                out.sdkInt?.let { r.put("sdkInt", it) }
                out.abi?.let { r.put("abi", it) }
                once.resolve(r)
            } catch (e: Throwable) {
                val f = failureOf(e, cancel)
                once.reject(f.code, f.code)
            } finally {
                req.wipe()
                installCancel = null
                installing.set(false)
            }
        }
    }

    /** The phone's adb identity, encrypted with a Keystore key, in noBackupFilesDir (not backed up or transferred). */
    private fun adbIdentities(): AdbIdentityStore {
        // earlier builds kept the key in plain text here, or briefly as temporary files while generating it
        File(context.filesDir, "adb").deleteRecursively()
        File(context.cacheDir, "adbtmp").deleteRecursively()
        return AdbIdentityStore(
            File(context.noBackupFilesDir, "adb/identity.enc"),
            AesGcmWrapper { AesGcmWrapper.keystoreKey("omp-adb-aes") },
        ) { AdbIdentity.generate() }
    }

    /** Stops the running install (downloads and temp files are removed). */
    @PluginMethod
    fun installCancel(call: PluginCall) {
        installCancel?.cancel()
        call.resolve()
    }

    /**
     * { tv, id?, name?, at: unix ms } schedules the Developer Mode reminder for that TV (tv = its address, id = a stable
     * TV id when known; both stored only as hashes, an older reminder of the same TV under either key is replaced);
     * { tv, id?, at: null } cancels it.
     */
    @PluginMethod
    fun devModeReminder(call: PluginCall) {
        val tv = call.getString("tv")?.trim().orEmpty()
        val at = call.getLong("at")
        if (tv.isEmpty()) {
            call.reject("Не указан телевизор")
        } else if (at == null) {
            DevModeReminder.cancel(context, tv, stableId(call))
            call.resolve()
        } else if (DevModeReminder.schedule(context, tv, call.getString("name"), at, stableId = stableId(call))) {
            call.resolve()
        } else {
            call.reject("Некорректное время напоминания")
        }
    }

    private fun stableId(call: PluginCall): String? = call.getString("id")?.trim()?.take(128)?.takeIf { it.isNotEmpty() }

    /** { tv, id? } → { at? }: when the reminder for that TV is due; absent when none is scheduled. */
    @PluginMethod
    fun devModeReminderState(call: PluginCall) {
        val once = Once(call)
        val tv = call.getString("tv")?.trim().orEmpty()
        if (tv.isEmpty()) {
            once.reject("Не указан телевизор")
            return
        }
        val id = stableId(call)
        io.execute {
            val o = JSObject()
            try {
                DevModeReminder.scheduledAt(context, tv, id)?.let { o.put("at", it) }
            } catch (_: Exception) {
            }
            once.resolve(o)
        }
    }

    /** Phone model for the TV's list of paired phones, e.g. «Google Pixel 7». */
    @PluginMethod
    fun phoneName(call: PluginCall) {
        val maker = Build.MANUFACTURER.orEmpty().trim()
        val model = Build.MODEL.orEmpty().trim()
        val name = when {
            model.isEmpty() -> maker
            maker.isEmpty() || model.startsWith(maker, ignoreCase = true) -> model
            else -> maker.replaceFirstChar { it.uppercase() } + " " + model
        }
        call.resolve(JSObject().put("name", name))
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

    /** Writes [text] to cache/logs/[name] and opens the system share sheet for it (FileProvider, text/plain).
     *  Older shared files are removed first (a settings copy holds secrets); [title] is the chooser title. */
    @Synchronized
    @PluginMethod
    fun shareText(call: PluginCall) {
        val name = shareFileName(call.getString("name"))
        val text = call.getString("text")
        if (text == null) {
            call.reject("Нет текста для файла")
            return
        }
        try {
            val dir = File(context.cacheDir, "logs").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, name)
            file.writeText(text, Charsets.UTF_8)
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            // ClipData carries the read grant to the chooser and its preview
            send.clipData = ClipData.newRawUri("", uri)
            val chooser = Intent.createChooser(send, call.getString("title")?.trim().orEmpty().take(60).ifEmpty { "Поделиться файлом" })
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val act = activity
            if (act != null) act.startActivity(chooser)
            else context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve()
        } catch (_: ActivityNotFoundException) {
            call.reject("Нет приложения для отправки файла")
        } catch (_: java.io.IOException) {
            call.reject("Не удалось сохранить файл")
        } catch (_: RuntimeException) {
            call.reject("Не удалось поделиться файлом")
        }
    }

    /** Removes shared files (settings copies hold secrets) older than [maxAgeMs] from cache/logs. */
    @Synchronized
    private fun purgeSharedFiles(maxAgeMs: Long) {
        val now = System.currentTimeMillis()
        File(context.cacheDir, "logs").listFiles()?.forEach { if (now - it.lastModified() > maxAgeMs) it.delete() }
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
        NativePlayerBridge.resetSkips()
        NativePlayerBridge.resetDonate()
        NativePlayerBridge.resetAss()
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
        // the port could not be bound: a code would be useless
        if (!r.running) {
            call.reject("Сервер управления не запустился")
            return
        }
        val c = r.pairing.newCode()
        call.resolve(JSObject().put("code", c.code).put("expiresAt", c.expiresAt))
    }

    /** The pairing screen closed: the code shown there stops working. */
    @PluginMethod
    fun clearPairingCode(call: PluginCall) {
        remote?.pairing?.clearCode()
        call.resolve()
    }

    /** The TV name the phone sees (the registered NSD name): { name }. */
    @PluginMethod
    fun tvName(call: PluginCall) {
        val r = remote
        if (r == null) {
            call.reject("Управление с телефона недоступно")
            return
        }
        call.resolve(JSObject().put("name", r.name()))
    }

    /** «Передать на телевизор»: the page applied remoteSources { id } (rutracker = login result) or { failed }. */
    @PluginMethod
    fun remoteSourcesDone(call: PluginCall) {
        val r = remote
        if (r == null) {
            call.reject("Управление с телефона недоступно")
            return
        }
        val d = r.sourcesDone(call.getString("id"), call.getString("rutracker"), call.getBoolean("failed") == true, call.getInt("indexers"))
        // stored = false: the verified login could not be written, the page must not claim it
        call.resolve(JSObject().put("stored", d != SourcesDone.NOT_STORED))
    }

    /**
     * The transfer still waiting for the page ({ event: remoteSources data } or { event: null }): the event is not
     * retained, so a page that starts listening late asks for the one current transfer, never an old backlog.
     */
    @PluginMethod
    fun remoteSourcesPending(call: PluginCall) {
        val e = remote?.pendingSources()
        call.resolve(JSObject().put("event", e ?: JSONObject.NULL))
    }

    /** A phone command for the open native player ({ cmd: Cmd }). */
    @PluginMethod
    fun nativePlayerCommand(call: PluginCall) {
        val cmd = call.getObject("cmd")
        when {
            cmd == null -> call.reject("Некорректная команда")
            // the page's data for the overlay, not a remote command (the player may still be opening)
            cmd.optString("type") == "segments" -> if (NativePlayerBridge.segments(cmd)) call.resolve() else call.reject("Некорректная команда")
            cmd.optString("type") == "toast" -> if (NativePlayerBridge.toast(cmd)) call.resolve() else call.reject("Некорректная команда")
            cmd.optString("type") == "donate" -> if (NativePlayerBridge.donate(cmd)) call.resolve() else call.reject("Некорректная команда")
            cmd.optString("type") == "assSubs" -> if (NativePlayerBridge.assSubs(cmd)) call.resolve() else call.reject("Некорректная команда")
            !NativePlayerBridge.command(cmd) -> call.reject("Плеер не открыт")
            else -> call.resolve()
        }
    }

    // ---- APK update ----

    /** Whether libVLC runs on this device (its native libraries are present and load): { available }. */
    @PluginMethod
    fun vlcAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", com.spacesarmat.omp.player.VlcAvailability.available(context)))
    }

    /** Feed key of this device's APK («arm64» / «armv7»; "" = universal), the same rule as downloadAndInstallApk. */
    @PluginMethod
    fun deviceAbiKey(call: PluginCall) {
        call.resolve(JSObject().put("key", ApkAbi.key(Build.SUPPORTED_ABIS.toList()) ?: ""))
    }

    @PluginMethod
    fun downloadAndInstallApk(call: PluginCall) {
        val once = Once(call)
        // the feed's per-ABI APK for this device (arm64 / armv7) when the page passed them, else the universal one
        val apk = ApkAbi.choose(
            Build.SUPPORTED_ABIS.toList(),
            ApkAbi.Apk(call.getString("url")?.trim().orEmpty(), call.getString("sha256").orEmpty(), 0L),
            ApkAbi.parseApks(call.getObject("apks")),
        )
        val url = apk.url
        val sha = apk.sha256
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

    /**
     * Downloads the pinned TorrServer binary (GitHub release asset, sha256 + size checked). Progress: events
     * localServerDownload { phase: 'download', percent } then { phase: 'verify' }. A call while a download runs joins
     * it (no second download). Resolves the server info; rejects with Russian text (next step included) and the
     * InstallCodes code.
     */
    @PluginMethod
    fun downloadLocalServer(call: PluginCall) {
        val once = Once(call)
        if (!LocalTorrServer.supported()) {
            once.reject(NOT_SUPPORTED, "unsupported")
            return
        }
        io.execute {
            try {
                LocalTorrServer.download(context)
                once.resolve(localInfo())
            } catch (e: Throwable) {
                val f = failureOf(e)
                val mb = try {
                    LocalTorrServer.pin(context).size / (1024 * 1024)
                } catch (_: Exception) {
                    0L
                }
                once.reject(TorrServerBinary.downloadError(f.code, mb), f.code)
            }
        }
    }

    @PluginMethod
    fun cancelLocalServerDownload(call: PluginCall) {
        LocalTorrServer.cancelDownload()
        call.resolve()
    }

    @PluginMethod
    fun startLocalServer(call: PluginCall) {
        if (!LocalTorrServer.supported()) {
            call.reject(NOT_SUPPORTED)
            return
        }
        val runnable = try {
            LocalTorrServer.installation(context).runnable()
        } catch (_: Exception) {
            false
        }
        if (!runnable) {
            call.reject(NOT_DOWNLOADED, "not-downloaded")
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
        val supported = LocalTorrServer.supported()
        o.put("supported", supported)
        if (supported) {
            try {
                val install = LocalTorrServer.installation(context)
                o.put("binary", install.state().id)
                o.put("downloadBytes", install.pin.size)
                o.put("pinVersion", install.pin.tag)
                if (LocalTorrServer.downloading()) {
                    o.put("downloading", true)
                    LocalTorrServer.downloadPercent?.let { o.put("downloadPercent", it) }
                }
                o.put("mobileData", LocalTorrServer.onMobileData(context))
            } catch (_: Exception) {
                o.put("binary", BinaryState.MISSING.id)
            }
        }
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

    // ---- search sources: site HTTP and encrypted secrets ----

    /**
     * { url, method?: GET|POST, headers?, form?, formCharset?, body?, timeoutMs?, cloudflare?, flaresolverr? } →
     * { status, url, text, cloudflare? }.
     * Cookies per site, body decoded by its charset. Values are never logged.
     */
    @PluginMethod
    fun http(call: PluginCall) {
        val once = Once(call)
        val spec = try {
            HttpSpec.parse(call.data)
        } catch (e: SiteHttpException) {
            return once.reject(e.reason)
        }
        io.execute {
            try {
                val r = sources.request(spec)
                once.resolve(JSObject.fromJSONObject(HttpSpec.reply(r)))
            } catch (e: SiteHttpException) {
                // a Cloudflare failure carries its kind as the code (the page offers the visible check for -interactive)
                if (e.code != null) once.reject(e.reason, e.code) else once.reject(e.reason)
            } catch (e: Exception) {
                once.reject(SiteHttp.NO_ANSWER)
            }
        }
    }

    /** Forgets the cookies of the site of { url } (logout). */
    @PluginMethod
    fun httpClearCookies(call: PluginCall) {
        val once = Once(call)
        val url = call.getString("url") ?: return once.reject(SiteHttp.BAD_URL)
        io.execute {
            try {
                sources.siteHttp.clearCookies(url)
                once.resolve()
            } catch (e: SiteHttpException) {
                once.reject(e.reason)
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    @PluginMethod
    fun secretGet(call: PluginCall) {
        val once = Once(call)
        val key = secretKey(call) ?: return once.reject(SECRETS_FAILED)
        io.execute {
            try {
                once.resolve(JSObject().put("value", sources.secrets.get(key) ?: JSONObject.NULL))
            } catch (e: Exception) {
                // transient Keystore failure: the stored value is kept
                once.reject(SECRETS_FAILED)
            }
        }
    }

    @PluginMethod
    fun secretSet(call: PluginCall) {
        val once = Once(call)
        val key = secretKey(call) ?: return once.reject(SECRETS_FAILED)
        val value = call.getString("value") ?: return once.reject(SECRETS_FAILED)
        io.execute {
            try {
                sources.secrets.set(key, value)
                once.resolve()
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    @PluginMethod
    fun secretDelete(call: PluginCall) {
        val once = Once(call)
        val key = secretKey(call) ?: return once.reject(SECRETS_FAILED)
        io.execute {
            try {
                sources.secrets.delete(key)
                once.resolve()
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    /** JS keys live in their own namespace: page code cannot read the cookie entries. */
    private fun secretKey(call: PluginCall): String? = SourceServices.jsSecretKey(call.getString("key"))

    // ---- Cloudflare: the visible check, «Пройти на телефоне» ----

    private val cfOpen = AtomicBoolean(false)
    // the open visible check (cancelled when the plugin goes away, so the gate and the call are never held)
    @Volatile
    private var cfCheck: VisibleCheck? = null

    private fun cfText(call: PluginCall, key: String): String? =
        call.getString(key)?.filterNot { it.isISOControl() }?.take(400)?.ifEmpty { null }

    /**
     * The visible check ([VisibleCheck] + [CloudflareCheckDialog]): { url, site, mode: phone|tv, title, text, note?,
     * cancel, phone?, remote?, hint?, noPhone?, phoneClosed?, waiting?, gateWait?, errors?: { OUTCOME: text }, forTv?:
     * request id } → { result: solved|cancelled|busy|failed|done, sent?, via? }. With forTv the phone passes the TV's
     * waiting request (its own address, never the page's) and the cookies go only to that TV. Cookies never reach the page.
     */
    @PluginMethod
    fun cloudflareVisible(call: PluginCall) {
        val once = Once(call)
        val act = activity ?: return once.reject(CF_UNAVAILABLE)
        val forTv = call.getString("forTv")
        val watch = if (forTv != null && !TvMode.isTv(context)) cfWatch(context) else null
        val req = if (forTv != null) watch?.pending()?.takeIf { it.id == forTv } ?: return once.reject(CF_GONE) else null
        val url = req?.url ?: call.getString("url")
        val root = (url?.toHttpUrlOrNull() ?: return once.reject(SiteHttp.BAD_URL)).let { CloudflareSolver.siteRoot(it) }
        val site = CloudflareProtocol.cleanSite(call.getString("site")) ?: req?.site ?: root.host
        val tvMode = call.getString("mode") == "tv" && TvMode.isTv(context)
        val title = cfText(call, "title") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val text = cfText(call, "text") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val cancel = cfText(call, "cancel") ?: return once.reject(SiteHttp.BAD_REQUEST)
        val errors = HashMap<String, String>()
        call.getObject("errors")?.let { o ->
            for (k in CloudflareRelay.Outcome.values()) (o.opt(k.name) as? String)?.take(400)?.let { errors[k.name] = it }
        }
        val texts = CheckTexts(
            title, text, cfText(call, "note"), cancel, cfText(call, "phone"), cfText(call, "remote"), cfText(call, "hint"),
            cfText(call, "noPhone"), cfText(call, "phoneClosed"), cfText(call, "waiting"), cfText(call, "gateWait"), errors,
        )
        if (!cfOpen.compareAndSet(false, true)) return once.resolve(JSObject().put("result", "busy"))
        val relay = if (tvMode) remote?.cloudflare else null
        val target = if (watch != null && req != null) {
            CheckTarget.Tv { pairs, ua, until ->
                if (pairs == null) {
                    watch.answer(req.id, CloudflareProtocol.endedJson(req.id, cancelled = true))
                } else {
                    val body = CloudflareProtocol.solvedJson(req.id, root.host, pairs, ua, until)
                        ?: CloudflareProtocol.endedJson(req.id, cancelled = false)
                    watch.answer(req.id, body)
                }
            }
        } else {
            CheckTarget.Local { pairs, until -> sources.importClearance(root, pairs, null, until) }
        }
        act.runOnUiThread {
            try {
                val dialog = CloudflareCheckDialog(act, tvMode, texts, phoneButton = relay != null)
                val check = VisibleCheck(
                    root, site, texts, { WebViewCloudflareBrowser(act, visible = true) }, MainScheduler(), sources::userAgent,
                    System::currentTimeMillis, { io.execute(it) }, target, relay,
                    { r ->
                        cfCheck = null
                        cfOpen.set(false)
                        val o = JSObject().put("result", r.result)
                        r.sent?.let { o.put("sent", it) }
                        r.via?.let { o.put("via", it) }
                        once.resolve(o)
                    },
                )
                cfCheck = check
                dialog.show(check)
            } catch (e: Exception) {
                val c = cfCheck
                cfCheck = null
                c?.cancel()
                cfOpen.set(false)
                once.resolve(JSObject().put("result", "failed"))
            }
        }
    }

    /** Phone: the page refused the TV's request (not a site it knows with the switch on): the TV hears «failed». */
    @PluginMethod
    fun cloudflareDecline(call: PluginCall) {
        val id = call.getString("id")
        if (TvMode.isTv(context) || !CloudflareProtocol.validId(id)) return call.resolve()
        val w = cfWatch(context)
        io.execute { w.answer(id!!, CloudflareProtocol.endedJson(id, cancelled = false)) }
        call.resolve()
    }

    /** { url } → { until: epoch ms | null }: when the stored Cloudflare clearance of the site ends. */
    @PluginMethod
    fun cloudflareClearance(call: PluginCall) {
        val once = Once(call)
        val url = call.getString("url")?.toHttpUrlOrNull() ?: return once.reject(SiteHttp.BAD_URL)
        io.execute {
            try {
                once.resolve(JSObject().put("until", sources.clearanceUntil(url) ?: JSONObject.NULL))
            } catch (e: Exception) {
                once.reject(SECRETS_FAILED)
            }
        }
    }

    /**
     * Phone: poll the paired Android TV for «Пройти на телефоне» ({ url: http://ip:port, token, notify: text with %s })
     * or stop ({}). A request comes as the event cloudflareRequest { id, site, url } with the app open, else as a
     * notification (cloudflarePending gives it to the page later).
     */
    @PluginMethod
    fun cloudflareWatch(call: PluginCall) {
        if (TvMode.isTv(context)) return call.resolve()
        val url = call.getString("url")
        val token = call.getString("token")
        cfText(call, "notify")?.let { cfNotify = it }
        val w = cfWatch(context)
        if (url == null || token == null) {
            w.configure(null, null)
            return call.resolve()
        }
        if (!CF_BASE.matches(url) || !CF_TOKEN.matches(token)) return call.reject(SiteHttp.BAD_REQUEST)
        w.configure(url, token)
        w.start()
        call.resolve()
    }

    /** { request: { id, site, url } | null }: the TV's check still waiting for the person. */
    @PluginMethod
    fun cloudflarePending(call: PluginCall) {
        val r = if (TvMode.isTv(context)) null else cfWatch(context).pending()
        call.resolve(JSObject.fromJSONObject(CloudflareProtocol.requestJson(r)))
    }

    private fun emitCloudflare(r: CloudflareProtocol.Request): Boolean {
        if (!hasListeners("cloudflareRequest")) return false
        notifyListeners("cloudflareRequest", JSObject().put("id", r.id).put("site", r.site).put("url", r.url))
        return true
    }

    // ---- monitoring (WorkManager, notifications); phone only ----

    /** { enabled, hours: 1|3|6|12, wifiOnly }: schedules or cancels the periodic background check. */
    @PluginMethod
    fun monitorSchedule(call: PluginCall) {
        if (TvMode.isTv(context)) return call.reject(MONITOR_PHONE_ONLY)
        val s = MonitorPlan.schedule(call.getBoolean("enabled"), call.getInt("hours"), call.getBoolean("wifiOnly"))
        val once = Once(call)
        io.execute {
            try {
                MonitorScheduler.apply(context, s)
                // the channels show up in the system settings as soon as monitoring is on
                if (s.enabled) MonitorNotifier.ensureChannels(context)
                once.resolve()
            } catch (e: Exception) {
                once.reject(MONITOR_FAILED)
            }
        }
    }

    /** «Проверить сейчас»: a one-time check. */
    @PluginMethod
    fun monitorRunNow(call: PluginCall) {
        if (TvMode.isTv(context)) return call.reject(MONITOR_PHONE_ONLY)
        val once = Once(call)
        io.execute {
            try {
                MonitorScheduler.runNow(context)
                once.resolve()
            } catch (e: Exception) {
                once.reject(MONITOR_FAILED)
            }
        }
    }

    /** { enabled, hours, wifiOnly, running, lastRun?, lastSummary? (JSON string), lastError?, nextRun? }. */
    @PluginMethod
    fun monitorStatus(call: PluginCall) {
        val once = Once(call)
        io.execute {
            try {
                once.resolve(JSObject.fromJSONObject(MonitorScheduler.status(context)))
            } catch (e: Exception) {
                once.reject(MONITOR_FAILED)
            }
        }
    }

    /** { state: granted | denied | prompt } of the notifications (POST_NOTIFICATIONS on Android 13+). */
    @PluginMethod
    fun monitorNotifyPermission(call: PluginCall) {
        call.resolve(JSObject().put("state", notifyState()))
    }

    /** Asks for POST_NOTIFICATIONS when it can still be asked; resolves with the new { state }. */
    @PluginMethod
    fun requestMonitorNotifyPermission(call: PluginCall) {
        MonitorNotifier.ensureChannels(context)
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            return call.resolve(JSObject().put("state", notifyState()))
        }
        requestPermissionForAlias("notifications", call, "monitorPermissionDone")
    }

    @PermissionCallback
    private fun monitorPermissionDone(call: PluginCall) {
        call.resolve(JSObject().put("state", notifyState()))
    }

    private fun notifyState(): String {
        if (Build.VERSION.SDK_INT >= 33) {
            when (getPermissionState("notifications")) {
                PermissionState.GRANTED -> {}
                PermissionState.DENIED -> return "denied"
                else -> return "prompt"
            }
        }
        return if (MonitorNotifier.canNotify(context)) "granted" else "denied"
    }

    /** The link of a tapped monitoring notification not delivered yet ({ url: omp:news?... | null }). */
    @PluginMethod
    fun takeMonitorOpen(call: PluginCall) {
        val url = synchronized(magnetLock) {
            val u = pendingOpen
            pendingOpen = null
            u
        }
        call.resolve(JSObject().put("url", url ?: JSONObject.NULL))
    }

    private fun emitMonitorOpen(url: String) {
        if (hasListeners("monitorOpen")) {
            synchronized(magnetLock) { if (pendingOpen == url) pendingOpen = null }
            notifyListeners("monitorOpen", JSObject().put("url", url))
        }
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
        fun reject(message: String, code: String) {
            if (done.compareAndSet(false, true)) call.reject(message, code)
        }
    }

    companion object {
        private const val NOT_SUPPORTED = "Встроенный сервер недоступен на этом телефоне"
        private const val START_FAILED = "Не удалось запустить сервер"
        private const val NOT_DOWNLOADED = "Сначала скачайте TorrServer"
        private const val SECRETS_FAILED = SourceServices.SECRETS_FAILED
        private const val PREFS = "omp-native"
        private const val CACHE_SET = "torrserverCacheConfigured"
        private val IPV4 = Regex("^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$")
        private val magnetLock = Any()
        private var pendingMagnet: String? = null
        // link of a tapped monitoring notification (omp:news?...), see takeMonitorOpen
        private var pendingOpen: String? = null
        private const val MONITOR_PHONE_ONLY = "Мониторинг работает только на телефоне"
        private const val CF_UNAVAILABLE = "Проверка недоступна"
        private const val CF_GONE = "Телевизор уже не ждёт эту проверку"
        private val CF_BASE = Regex("^http://((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d):\\d{1,5}$")
        private val CF_TOKEN = Regex("^[0-9a-f]{32}$")
        private const val CF_CHANNEL = "omp-tv-requests"
        private const val CF_NOTIFICATION = 7101
        @Volatile
        private var cfNotify = "Телевизор просит пройти проверку на %s"
        private var watch: CloudflareWatch? = null

        /** The phone's one watch of the paired TV (process-wide: it outlives a recreated plugin). */
        @Synchronized
        private fun cfWatch(ctx: Context): CloudflareWatch {
            watch?.let { return it }
            val app = ctx.applicationContext
            val w = CloudflareWatch(
                HttpWatchTransport(),
                { AppForeground.main },
                { onLan(app) },
                { r, fg -> (fg && instance?.emitCloudflare(r) == true) || notifyCloudflare(app, r.site) },
            )
            watch = w
            // a sleeping watch looks again when the phone joins (or leaves) a network
            try {
                app.getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) = w.wake()
                    override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = w.wake()
                    override fun onLost(network: Network) = w.wake()
                })
            } catch (e: RuntimeException) {
                // without the callback the watch still looks again when the app comes back
            }
            return w
        }

        /** The phone is on Wi-Fi or Ethernet (the TV is on the home network; never on mobile data). */
        private fun onLan(ctx: Context): Boolean = try {
            val cm = ctx.getSystemService(ConnectivityManager::class.java)
            val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
            caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        } catch (e: RuntimeException) {
            false
        }

        /** MainActivity.onResume: the watch polls again (its background grace may have ended). */
        fun wakeCloudflare() {
            watch?.wake()
        }

        /** «Телевизор просит пройти проверку на …»; a tap opens OMP, which asks cloudflarePending. false = not shown. */
        private fun notifyCloudflare(ctx: Context, site: String): Boolean {
            if (!MonitorNotifier.canNotify(ctx)) return false
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
            if (nm.getNotificationChannel(CF_CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CF_CHANNEL, "Запросы телевизора", NotificationManager.IMPORTANCE_HIGH))
            }
            if (nm.getNotificationChannel(CF_CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return false
            val open = PendingIntent.getActivity(
                ctx, CF_NOTIFICATION,
                Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val text = cfNotify.replace("%s", site)
            val n = NotificationCompat.Builder(ctx, CF_CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_monitor)
                .setContentTitle("OMP")
                .setContentText(text)
                .setContentIntent(open)
                .setAutoCancel(true)
                .setTimeoutAfter(CloudflareWatch.REQUEST_TTL_MS)
                .build()
            return try {
                NotificationManagerCompat.from(ctx).notify(CF_NOTIFICATION, n)
                true
            } catch (e: SecurityException) {
                false
            }
        }
        private const val MONITOR_FAILED = "Не удалось настроить фоновую проверку"

        @Volatile
        private var instance: OmpNativePlugin? = null

        /** Called by MainActivity for a tapped monitoring notification (MonitorLinks): pending + event monitorOpen. */
        fun deliverMonitorOpen(url: String) {
            synchronized(magnetLock) { pendingOpen = url }
            instance?.emitMonitorOpen(url)
        }

        /** A background run finished: event monitorDone { summary: JSON string | absent } for an open app. */
        fun deliverMonitorDone(summary: JSONObject?) {
            val o = JSObject()
            if (summary != null) o.put("summary", summary.toString())
            instance?.notifyListeners("monitorDone", o)
        }

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

/** A safe file name for the share cache: no directories, only letters, digits and `.-_`; `.txt` when it has no extension. */
internal fun shareFileName(raw: String?): String {
    val cleaned = (raw ?: "").substringAfterLast('/').substringAfterLast('\\')
        .map { if (it.isLetterOrDigit() || it == '.' || it == '-' || it == '_') it else '_' }
        .joinToString("").trim('.', '_')
    val base = cleaned.take(100).trim('.', '_').ifEmpty { "omp-log.txt" }
    return if (base.contains('.')) base else "$base.txt"
}
