package com.spacesarmat.omp

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.core.net.toUri
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Transport for the phone client: SSDP, TV WebSockets, external player, APK update, magnet intake,
 * local player server (TV state in, commands out).
 * The SSAP protocol itself (register, requests, pairing) lives in TypeScript.
 *
 * Every PluginCall is settled exactly once (see [Once]). Blocking work runs on [io]; socket
 * callbacks arrive on OkHttp threads. Events: tvMessage { json }, tvClosed { reason },
 * apkProgress { percent }, magnetReceived { link }, playerMessage { body }.
 */
@CapacitorPlugin(name = "OmpNative")
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

    override fun load() {
        instance = this
        // a magnet that arrived before the bridge was ready
        synchronized(magnetLock) { pendingMagnet }?.let { emitMagnet(it) }
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
        closeAll()
        player.stop()
        io.shutdownNow()
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
            once.reject("Разрешите установку из OMP и нажмите «Установить» ещё раз")
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
