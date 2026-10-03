package com.spacesarmat.omp.monitor

import android.content.Context
import androidx.core.util.AtomicFile
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Dedup markers of the background page, kept outside localStorage: Chromium writes localStorage to disk lazily, and a
 * process killed right after a run could lose the seen keys and notify the same release again. The page sends a
 * marker before every notification and after every button ({ s: subId, e: seen entry } / { s, k: key, a: add|replace });
 * the next run gets them back at start and merges them into localStorage (mobile/src/monitor/journal.ts).
 * Only keys and normalized titles, no secrets. Pure list logic here; [MonitorJournalFile] stores it.
 */
object MonitorJournal {
    const val MAX_ITEMS = 500
    const val MAX_FIELD = 1000

    /** A well-formed marker, re-built from known fields only; null otherwise. */
    fun item(v: Any?): JSONObject? {
        if (v !is JSONObject) return null
        val s = (v.opt("s") as? String)?.takeIf { it.isNotEmpty() && it.length <= MonitorAction.MAX_ID } ?: return null
        val e = v.opt("e") as? String
        if (e != null) return if (e.isNotEmpty() && e.length <= MAX_FIELD) JSONObject().put("s", s).put("e", e) else null
        val k = (v.opt("k") as? String)?.takeIf { it.isNotEmpty() && it.length <= MonitorAction.MAX_ID } ?: return null
        val a = v.opt("a") as? String
        if (a != MonitorAction.ADD && a != MonitorAction.REPLACE) return null
        return JSONObject().put("s", s).put("k", k).put("a", a)
    }

    /** Stored text → markers (garbage dropped). */
    fun parse(text: String?): List<JSONObject> {
        if (text.isNullOrEmpty()) return emptyList()
        val arr = try {
            JSONArray(text)
        } catch (e: Exception) {
            return emptyList()
        }
        val out = ArrayList<JSONObject>()
        for (i in 0 until arr.length()) item(arr.opt(i))?.let { out.add(it) }
        return out
    }

    /** [old] + the valid [added] (a repeated marker moves to the end), the newest [MAX_ITEMS]. */
    fun append(old: List<JSONObject>, added: JSONArray?): List<JSONObject> {
        val fresh = ArrayList<JSONObject>()
        if (added != null) for (i in 0 until added.length()) item(added.opt(i))?.let { fresh.add(it) }
        val keys = fresh.map { it.toString() }.toSet()
        val all = old.filter { it.toString() !in keys } + fresh
        return if (all.size > MAX_ITEMS) all.subList(all.size - MAX_ITEMS, all.size) else all
    }

    fun toJson(items: List<JSONObject>): JSONArray = JSONArray().also { a -> items.forEach { a.put(it) } }
}

/** The journal in app-private files, written atomically with fsync (androidx AtomicFile). */
class MonitorJournalFile(ctx: Context) {
    private val file = AtomicFile(File(ctx.filesDir, "monitor-journal.json"))

    fun read(): List<JSONObject> = synchronized(LOCK) {
        try {
            MonitorJournal.parse(String(file.readFully(), Charsets.UTF_8))
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Throws when the file cannot be written. */
    fun append(added: JSONArray?) = synchronized(LOCK) {
        val next = MonitorJournal.append(read(), added)
        val out = file.startWrite()
        try {
            out.write(MonitorJournal.toJson(next).toString().toByteArray(Charsets.UTF_8))
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            throw e
        }
    }

    companion object {
        private val LOCK = Any()
    }
}
