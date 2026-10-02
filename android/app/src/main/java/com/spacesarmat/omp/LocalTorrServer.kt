package com.spacesarmat.omp

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.io.File
import java.io.RandomAccessFile
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Locale
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * The embedded TorrServer process (`libtorrserver.so` from nativeLibraryDir), one per app process.
 * Owned by [TorrServerService]; every state change runs on the single [worker] thread, so a stop
 * followed by a start never races for port 8090. An unexpected exit is restarted once after 3 s,
 * then the server is reported stopped with an error.
 */
object LocalTorrServer {
    const val PORT = 8090
    const val BASE = "http://127.0.0.1:$PORT"
    const val CRASHED = "Сервер остановился с ошибкой"

    /** (running, error) after every change. */
    fun interface Listener {
        fun changed(running: Boolean, error: String?)
    }

    @Volatile var running = false
        private set
    @Volatile var error: String? = null
        private set
    /** Last `/echo` answer. */
    @Volatile var version: String? = null
    /** Grows on every give-up, so a waiting start can tell a fresh failure from an old [error]. */
    @Volatile var failures = 0
        private set

    private val listeners = CopyOnWriteArraySet<Listener>()
    private val worker: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    // worker-thread state
    private var proc: Process? = null
    private var wanted = false
    private var restarted = false
    private var startedAt = 0L
    private var onFatal: (() -> Unit)? = null

    fun addListener(l: Listener) = listeners.add(l)
    fun removeListener(l: Listener) = listeners.remove(l)

    fun binary(ctx: Context) = File(ctx.applicationInfo.nativeLibraryDir, "libtorrserver.so")
    fun supported(ctx: Context) = binary(ctx).isFile
    fun dataDir(ctx: Context) = File(ctx.filesDir, "torrserver")
    fun cacheDir(ctx: Context) = File(ctx.cacheDir, "torrserver")

    /** Starts the process unless it runs; [fatal] is called when it gives up (service stops itself). */
    fun start(ctx: Context, fatal: () -> Unit) {
        val app = ctx.applicationContext
        worker.execute {
            onFatal = fatal
            wanted = true
            if (proc != null) return@execute
            restarted = false
            launch(app)
        }
    }

    /** Stops the process (destroy, then destroyForcibly after 3 s). Keeps the last error. */
    fun stop() {
        worker.execute {
            wanted = false
            onFatal = null
            val p = proc
            proc = null
            if (p != null) kill(p)
            set(false, error)
        }
    }

    private fun launch(app: Context) {
        try {
            val data = dataDir(app).apply { mkdirs() }
            cacheDir(app).mkdirs()
            trimLog(File(data, "server.log"))
            val pidFile = File(data, "server.pid")
            killOrphan(pidFile)
            if (echo(400) != null) {
                fail("Порт $PORT занят другим приложением")
                return
            }
            // sh records its pid and execs the server, so the pid is the server's own
            val pb = ProcessBuilder(
                "/system/bin/sh", "-c", "echo \$\$ > \"\$0\"; exec \"\$@\"",
                pidFile.absolutePath,
                binary(app).absolutePath,
                "--port", PORT.toString(),
                "--path", data.absolutePath,
                "--logpath", File(data, "server.log").absolutePath,
            )
            pb.directory(data)
            pb.redirectErrorStream(true)
            pb.redirectOutput(File(data, "stdout.log"))
            pb.environment()["HOME"] = data.absolutePath
            pb.environment()["TMPDIR"] = app.cacheDir.absolutePath
            val p = pb.start()
            proc = p
            startedAt = System.currentTimeMillis()
            set(true, null)
            Thread({
                try {
                    p.waitFor()
                } catch (_: InterruptedException) {
                }
                worker.execute { exited(app, p) }
            }, "torrserver-watch").apply { isDaemon = true }.start()
        } catch (_: Exception) {
            fail("Не удалось запустить сервер")
        }
    }

    private fun exited(app: Context, p: Process) {
        if (proc !== p) return // stopped on purpose or replaced
        proc = null
        // a server that ran for a while gets its one restart again
        if (System.currentTimeMillis() - startedAt > 60_000) restarted = false
        if (wanted && !restarted) {
            restarted = true
            worker.schedule({ if (wanted && proc == null) launch(app) }, 3, TimeUnit.SECONDS)
        } else {
            fail(CRASHED)
        }
    }

    /** The service could not go foreground: give up now so a waiting start does not time out. */
    fun failStart(message: String) {
        worker.execute { if (proc == null) fail(message) }
    }

    private var logCheckedAt = 0L

    /** Trims server.log of a running server, at most once an hour (the server appends to it). */
    fun trimLogHourly(ctx: Context) {
        val now = System.currentTimeMillis()
        if (now - logCheckedAt < 3_600_000) return
        logCheckedAt = now
        trimLog(File(dataDir(ctx.applicationContext), "server.log"))
    }

    /** Keeps the last 512 KB of a log grown over 2 MB. */
    private fun trimLog(log: File) {
        try {
            val size = log.length()
            if (size <= 2L * 1024 * 1024) return
            val keep = 512 * 1024
            val tail = ByteArray(keep)
            RandomAccessFile(log, "r").use { f ->
                f.seek(size - keep)
                f.readFully(tail)
            }
            log.writeBytes(tail)
        } catch (_: Exception) {
            log.delete()
        }
    }

    private fun fail(message: String) {
        wanted = false
        failures++
        set(false, message)
        val f = onFatal
        onFatal = null
        f?.invoke()
    }

    private fun set(run: Boolean, err: String?) {
        val changed = run != running || err != error
        running = run
        error = err
        if (!run) version = null
        if (changed) for (l in listeners) l.changed(run, err)
    }

    private fun kill(p: Process) {
        try {
            p.destroy()
            if (!p.waitFor(3, TimeUnit.SECONDS)) {
                p.destroyForcibly()
                p.waitFor(2, TimeUnit.SECONDS)
            }
        } catch (_: InterruptedException) {
        }
    }

    /** A server left running by a killed app process still holds the port: end it. */
    private fun killOrphan(pidFile: File) {
        val pid = try {
            pidFile.readText().trim().toInt()
        } catch (_: Exception) {
            return
        }
        val cmd = try {
            File("/proc/$pid/cmdline").readText()
        } catch (_: Exception) {
            ""
        }
        if (cmd.contains("libtorrserver")) {
            android.os.Process.killProcess(pid)
            var waited = 0
            while (File("/proc/$pid").exists() && waited < 2000) {
                Thread.sleep(100)
                waited += 100
            }
        }
        pidFile.delete()
    }

    // ---- HTTP API of the local server ----

    private val http = OkHttpClient.Builder()
        .connectTimeout(1, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()
    private val JSON = "application/json; charset=utf-8".toMediaType()

    /** `/echo` body (the server version) or null. */
    fun echo(timeoutMs: Long = 1000): String? = try {
        val client = http.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build()
        client.newCall(Request.Builder().url("$BASE/echo").build()).execute().use { r ->
            if (r.isSuccessful) r.body?.string()?.trim()?.ifEmpty { null } else null
        }
    } catch (_: Exception) {
        null
    }

    /** POST JSON; the body on 2xx, else null. */
    fun post(path: String, body: JSONObject): String? = try {
        val req = Request.Builder().url("$BASE$path").post(body.toString().toRequestBody(JSON)).build()
        http.newCall(req).execute().use { r -> if (r.isSuccessful) r.body?.string().orEmpty() else null }
    } catch (_: Exception) {
        null
    }

    /** Disk cache in `<cacheDir>/torrserver`, 1 GB; other settings are kept. True on success. */
    fun configureCache(ctx: Context): Boolean {
        val current = post("/settings", JSONObject().put("action", "get")) ?: return false
        val sets = try {
            JSONObject(current)
        } catch (_: Exception) {
            return false
        }
        val dir = cacheDir(ctx).apply { mkdirs() }
        sets.put("UseDisk", true)
        sets.put("TorrentsSavePath", dir.absolutePath)
        sets.put("CacheSize", 1_073_741_824L)
        return post("/settings", JSONObject().put("action", "set").put("sets", sets)) != null
    }

    /** Torrent count, summed download speed (bytes/s, null if none reports one), torrents open in the engine. */
    data class Stats(val count: Int, val speed: Double?, val active: Int) {
        /** Something is loading or streaming: keep the CPU and Wi-Fi awake. */
        val busy get() = active > 0 || (speed ?: 0.0) > 0.0
    }

    fun stats(): Stats? {
        val body = post("/torrents", JSONObject().put("action", "list")) ?: return null
        val arr = try {
            JSONArray(body)
        } catch (_: Exception) {
            return null
        }
        var speed: Double? = null
        var active = 0
        for (i in 0 until arr.length()) {
            val t = arr.optJSONObject(i) ?: continue
            if (t.has("download_speed")) speed = (speed ?: 0.0) + t.optDouble("download_speed", 0.0)
            // TorrServer stat: 0 added … 3 working, 4 closed, 5 only in the database
            if (t.optInt("stat", 0) < 4) active++
        }
        return Stats(arr.length(), speed, active)
    }

    fun dirSize(f: File): Long =
        if (f.isDirectory) f.listFiles()?.sumOf { dirSize(it) } ?: 0L else if (f.isFile) f.length() else 0L

    /** Deletes everything inside [dir], keeping the directory. */
    fun clearDir(dir: File) {
        dir.listFiles()?.forEach { it.deleteRecursively() }
    }

    // ---- network ----

    /** IPv4 of the Wi-Fi network (or the phone's hotspot), null if none. */
    fun wifiIpv4(ctx: Context): String? {
        try {
            val cm = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?
            if (cm != null) {
                @Suppress("DEPRECATION")
                for (n in cm.allNetworks) {
                    val caps = cm.getNetworkCapabilities(n) ?: continue
                    if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue
                    // a VPN over Wi-Fi also reports TRANSPORT_WIFI: its tunnel address is useless to the TV
                    if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ||
                        !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                    ) continue
                    val lp = cm.getLinkProperties(n) ?: continue
                    for (la in lp.linkAddresses) {
                        val a = la.address
                        if (a is Inet4Address && !a.isLoopbackAddress && !a.isLinkLocalAddress) return a.hostAddress
                    }
                }
            }
        } catch (_: Exception) {
        }
        // hotspot / Wi-Fi interfaces not exposed as a network; never a VPN or mobile-data tunnel
        try {
            var best: String? = null
            var bestRank = 0
            for (ni in NetworkInterface.getNetworkInterfaces() ?: return null) {
                val name = ni.name ?: continue
                if (!ni.isUp) continue
                if (name.startsWith("tun") || name.startsWith("ppp") || name.startsWith("ipsec")) continue
                if (!(name.startsWith("wlan") || name.startsWith("swlan") || name.startsWith("ap"))) continue
                for (a in ni.inetAddresses) {
                    if (a !is Inet4Address || !a.isSiteLocalAddress) continue
                    // 192.168/16, 172.16/12 and 10/8 on wlan0 first
                    val rank = if (name == "wlan0") 2 else 1
                    if (rank > bestRank) {
                        best = a.hostAddress
                        bestRank = rank
                    }
                }
            }
            if (best != null) return best
        } catch (_: Exception) {
        }
        return null
    }

    /** True when any network is a VPN: other devices may then not reach the phone. */
    fun vpnActive(ctx: Context): Boolean {
        return try {
            val cm = ctx.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager?
            @Suppress("DEPRECATION")
            cm?.allNetworks?.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true } == true
        } catch (_: Exception) {
            false
        }
    }

    // ---- notification text ----

    private val ru: Locale = Locale.forLanguageTag("ru")

    fun torrents(n: Int): String {
        val m10 = n % 10
        val m100 = n % 100
        val word = when {
            m10 == 1 && m100 != 11 -> "раздача"
            m10 in 2..4 && m100 !in 12..14 -> "раздачи"
            else -> "раздач"
        }
        return "$n $word"
    }

    /** 4404019 → «4,2 МБ/с», 52000 → «51 КБ/с». */
    fun speed(bytesPerSec: Double): String {
        val mb = bytesPerSec / (1024.0 * 1024.0)
        return if (mb >= 1) String.format(ru, "%.1f МБ/с", mb)
        else "${Math.round(bytesPerSec / 1024.0)} КБ/с"
    }

    /** «192.168.1.50:8090 · 1 раздача · 4,2 МБ/с». */
    fun statusLine(ip: String?, stats: Stats?): String {
        val parts = mutableListOf(if (ip != null) "$ip:$PORT" else "IP не найден")
        if (stats != null) {
            parts.add(torrents(stats.count))
            stats.speed?.let { parts.add(speed(it)) }
        }
        return parts.joinToString(" · ")
    }
}
