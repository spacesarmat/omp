#!/usr/bin/env python3
"""Jackett indexer monitor for the OMP VPS.

Tests every configured Jackett indexer with Jackett's own test endpoint.
After FAIL_THRESHOLD consecutive failures an indexer is removed from Jackett
(DELETE, the only "disable" Jackett has) after its config is saved locally.
Indexers removed by this monitor are re-checked every run by re-applying the
saved config and running the test; after OK_THRESHOLD consecutive passes the
indexer stays enabled again. Indexers the monitor did not remove itself are
never re-added.

No secrets live in this file: the Jackett admin password and Telegram token
are read from files on the VPS. Nothing secret is ever logged.
"""
import argparse
import datetime as dt
import fcntl
import http.cookiejar
import json
import logging
import logging.handlers
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    from zoneinfo import ZoneInfo
    MSK = ZoneInfo("Europe/Moscow")
except Exception:  # pragma: no cover
    MSK = dt.timezone(dt.timedelta(hours=3))

# --- settings ---------------------------------------------------------------
JACKETT_CONTAINER = "omp-jackett"
WARP_CONTAINER = "omp-warp"
JACKETT_PORT = 9117
WARP_PROXY_PORT = 1080
ADMIN_PASSWORD_FILE = "/root/jackett-admin-password.txt"
JACKETT_DATA_DIR = "/opt/omp-vps/data/jackett/Jackett"
STATE_DIR = "/var/lib/jackett-monitor"
STATE_FILE = os.path.join(STATE_DIR, "state.json")
SAVED_DIR = os.path.join(STATE_DIR, "saved-configs")
MANUAL_FILE = os.path.join(STATE_DIR, "manual-disabled.json")
IGNORE_FILE = "/etc/jackett-monitor/ignore"          # one indexer id per line
TELEGRAM_FILE = "/etc/jackett-monitor/telegram.env"  # TG_BOT_TOKEN=..., TG_CHAT_ID=...
LOG_FILE = "/var/log/jackett-monitor/monitor.log"
LOCK_FILE = "/run/jackett-monitor.lock"

FAIL_THRESHOLD = 2          # consecutive failed runs before disabling
OK_THRESHOLD = 2            # consecutive passed runs before re-enabling
TEST_TIMEOUT = 75           # seconds per Jackett test (Jackett's FlareSolverr timeout is 55 s)
DELAY_BETWEEN = 2           # seconds between indexers
RUN_BUDGET = 12 * 60        # stop testing new indexers after this many seconds
MIN_JACKETT_UPTIME = 10 * 60
OUTAGE_SHARE = 0.8          # this share (or all) failing at once = Jackett/WARP outage
OUTAGE_MIN_TESTED = 5
# Weekly image update runs Sunday 04:00 MSK and restarts Jackett.
QUIET_WINDOWS = [(6, (3, 45), (4, 45))]  # (weekday Mon=0, start, end) in MSK

log = logging.getLogger("jackett-monitor")


def setup_logging():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = logging.handlers.RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=5)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    log.addHandler(fh)
    log.addHandler(sh)
    log.setLevel(logging.INFO)


def now_iso():
    return dt.datetime.now(MSK).strftime("%Y-%m-%d %H:%M:%S MSK")


# --- docker helpers ---------------------------------------------------------
def container_ip(name):
    out = subprocess.check_output(
        ["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", name],
        text=True, timeout=20)
    ips = out.split()
    if not ips:
        raise RuntimeError(f"{name}: no IP")
    return ips[0]


def container_uptime(name):
    out = subprocess.check_output(
        ["docker", "inspect", "-f", "{{.State.Running}} {{.State.StartedAt}}", name], text=True, timeout=20).split()
    if out[0] != "true":
        return None
    started = out[1]
    started = started.split(".")[0].rstrip("Z")
    t = dt.datetime.strptime(started, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
    return (dt.datetime.now(dt.timezone.utc) - t).total_seconds()


# --- Jackett client ---------------------------------------------------------
class Jackett:
    def __init__(self):
        self.base = f"http://{container_ip(JACKETT_CONTAINER)}:{JACKETT_PORT}"
        self.cj = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.cj))

    def login(self):
        with open(ADMIN_PASSWORD_FILE) as f:
            pw = f.read().strip()
        data = urllib.parse.urlencode({"password": pw}).encode()
        self.op.open(self.base + "/UI/Dashboard", data=data, timeout=30).read()
        if not any(c.name == "Jackett" for c in self.cj):
            raise RuntimeError("Jackett login failed (no session cookie)")

    def _req(self, method, path, body=None, timeout=60):
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        elif method == "POST":
            data = b""
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.op.open(req, timeout=timeout) as r:
                raw = r.read()
                return r.status, raw
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def configured(self):
        st, raw = self._req("GET", "/api/v2.0/indexers?configured=true")
        if st != 200:
            raise RuntimeError(f"indexer list HTTP {st}")
        items = json.loads(raw)
        if isinstance(items, dict):  # login page or error
            raise RuntimeError("unexpected indexer list response")
        return {i["id"]: i for i in items}

    def test(self, iid):
        t0 = time.time()
        try:
            st, raw = self._req("POST", f"/api/v2.0/indexers/{urllib.parse.quote(iid)}/test", timeout=TEST_TIMEOUT)
        except Exception as e:  # timeout, connection reset ...
            return False, f"{type(e).__name__}: {e}"[:300], time.time() - t0
        if 200 <= st < 300:
            return True, "", time.time() - t0
        return False, f"HTTP {st}: {error_text(raw)}"[:300], time.time() - t0

    def get_config(self, iid):
        st, raw = self._req("GET", f"/api/v2.0/indexers/{urllib.parse.quote(iid)}/config")
        if st != 200:
            raise RuntimeError(f"get config {iid}: HTTP {st}")
        cfg = json.loads(raw)
        if not isinstance(cfg, list):
            raise RuntimeError(f"get config {iid}: unexpected body")
        return cfg

    def post_config(self, iid, cfg):
        try:
            st, raw = self._req("POST", f"/api/v2.0/indexers/{urllib.parse.quote(iid)}/config", body=cfg,
                                timeout=TEST_TIMEOUT)
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"[:300]
        if 200 <= st < 300:
            return True, ""
        return False, f"HTTP {st}: {error_text(raw)}"[:300]

    def delete(self, iid):
        st, raw = self._req("DELETE", f"/api/v2.0/indexers/{urllib.parse.quote(iid)}")
        if not 200 <= st < 300:
            raise RuntimeError(f"delete {iid}: HTTP {st}: {error_text(raw)}"[:300])


def error_text(raw):
    try:
        j = json.loads(raw)
        if isinstance(j, dict):
            return str(j.get("error") or j.get("message") or j)[:250]
    except Exception:
        pass
    return raw.decode("utf-8", "replace").strip().replace("\n", " ")[:250]


def comparable(cfg):
    """Config items that must survive a round trip (hidden runtime data excluded)."""
    return {c.get("id"): c.get("value") for c in cfg if c.get("type") not in ("hiddendata", "displayinfo")}


# --- state ------------------------------------------------------------------
def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json(path, data):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(tmp, path)


def read_ignore():
    try:
        with open(IGNORE_FILE) as f:
            return {l.split("#")[0].strip() for l in f if l.split("#")[0].strip()}
    except FileNotFoundError:
        return set()


def manual_ids():
    return set(load_json(MANUAL_FILE, {}).get("ids", []))


# --- telegram ---------------------------------------------------------------
def read_env(path):
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return env


def notify(text):
    log.info("NOTIFY: %s", text)
    env = read_env(TELEGRAM_FILE)
    token, chat = env.get("TG_BOT_TOKEN"), env.get("TG_CHAT_ID")
    if not token or not chat:
        log.warning("telegram not configured (%s missing or incomplete); message only logged", TELEGRAM_FILE)
        return False
    data = urllib.parse.urlencode({"chat_id": chat, "text": text, "disable_web_page_preview": "true"}).encode()
    url = "https://api.telegram.org/bot" + token + "/sendMessage"
    handlers = [urllib.request.ProxyHandler({})]
    try:
        handlers = [urllib.request.ProxyHandler(
            {"https": f"http://{container_ip(WARP_CONTAINER)}:{WARP_PROXY_PORT}"})]
    except Exception as e:
        log.warning("warp proxy unavailable, trying direct: %s", e)
    for attempt in range(2):
        try:
            op = urllib.request.build_opener(*handlers)
            with op.open(url, data=data, timeout=30) as r:
                if r.status == 200:
                    return True
        except Exception as e:
            # never log the URL: it contains the token
            log.warning("telegram send failed (%s)", type(e).__name__)
        handlers = [urllib.request.ProxyHandler({})]  # second try: direct
    return False


# --- main logic -------------------------------------------------------------
def in_quiet_window():
    n = dt.datetime.now(MSK)
    for wd, (sh, sm), (eh, em) in QUIET_WINDOWS:
        if n.weekday() == wd and (sh, sm) <= (n.hour, n.minute) < (eh, em):
            return True
    return False


def outage_alert(state, reason):
    if not state.get("outage"):
        state["outage"] = {"since": now_iso(), "reason": reason}
        notify(f"Jackett монитор: похоже на сбой Jackett/WARP ({reason}). Индексаторы не отключаю, жду восстановления.")
    else:
        log.warning("outage continues (%s)", reason)


def outage_clear(state):
    if state.get("outage"):
        since = state["outage"].get("since")
        state["outage"] = None
        notify(f"Jackett монитор: Jackett снова отвечает (сбой с {since}).")


def disable(j, state, iid, name, reason):
    cfg = j.get_config(iid)
    save_json(os.path.join(SAVED_DIR, iid + ".json"), cfg)
    disk = os.path.join(JACKETT_DATA_DIR, "Indexers", iid + ".json")
    if os.path.exists(disk):  # exact on-disk copy as an extra backup
        with open(disk, "rb") as src:
            raw = src.read()
        fd = os.open(os.path.join(SAVED_DIR, iid + ".disk.json"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as dst:
            dst.write(raw)
    j.delete(iid)
    if iid in j.configured():
        raise RuntimeError(f"{iid} still configured after delete")
    state["disabled"][iid] = {"name": name, "since": now_iso(), "reason": reason, "ok_streak": 0,
                              "last_check": now_iso(), "last_error": reason}
    state["indexers"].pop(iid, None)


def probe_disabled(j, state, iid, info):
    """Re-apply saved config + test. Keep it only after OK_THRESHOLD passes in a row."""
    cfg = load_json(os.path.join(SAVED_DIR, iid + ".json"), None)
    if cfg is None:
        log.error("%s: saved config missing, cannot re-check", iid)
        return
    ok, err = j.post_config(iid, cfg)
    if ok:
        ok, err, secs = j.test(iid)
    info["last_check"] = now_iso()
    if ok:
        info["ok_streak"] = info.get("ok_streak", 0) + 1
        info["last_error"] = ""
    else:
        info["ok_streak"] = 0
        info["last_error"] = err
    if ok and info["ok_streak"] >= OK_THRESHOLD:
        live = j.configured()
        if iid not in live:
            raise RuntimeError(f"{iid} not configured after re-apply")
        diff = comparable(j.get_config(iid)) != comparable(cfg)
        if diff:
            log.warning("%s: re-applied config differs from saved one", iid)
        state["disabled"].pop(iid, None)
        state["indexers"][iid] = {"name": info.get("name", iid), "fail_streak": 0, "last_ok": now_iso(),
                                  "last_error": ""}
        log.info("%s: re-enabled after %d passes", iid, info["ok_streak"])
        notify(f"Jackett монитор: снова включил {info.get('name', iid)} ({iid}) - "
               f"{OK_THRESHOLD} проверки подряд успешны. Был отключён с {info.get('since')}.")
        return
    # not (yet) trusted: take it out again
    try:
        if iid in j.configured():
            j.delete(iid)
    except Exception as e:
        log.error("%s: could not remove after probe: %s", iid, e)
    log.info("%s: still disabled (probe %s, ok_streak=%d%s)", iid, "ok" if ok else "failed",
             info["ok_streak"], "" if ok else ", " + err)


def run(args):
    state = load_json(STATE_FILE, {"indexers": {}, "disabled": {}, "outage": None})
    state.setdefault("indexers", {})
    state.setdefault("disabled", {})
    state.setdefault("outage", None)
    manual = manual_ids()
    ignore = read_ignore()

    if in_quiet_window() and not args.force:
        log.info("skip: weekly update window")
        return 0
    up = container_uptime(JACKETT_CONTAINER)
    if up is None:
        outage_alert(state, "контейнер omp-jackett не запущен")
        save_json(STATE_FILE, state)
        return 0
    if up < MIN_JACKETT_UPTIME and not args.force:
        log.info("skip: Jackett started %d s ago", up)
        return 0

    try:
        j = Jackett()
        j.login()
        live = j.configured()
    except Exception as e:
        log.warning("Jackett unreachable: %s", e)
        if state.get("jackett_down_runs", 0) >= 1:
            outage_alert(state, "Jackett не отвечает")
        state["jackett_down_runs"] = state.get("jackett_down_runs", 0) + 1
        save_json(STATE_FILE, state)
        return 0
    state["jackett_down_runs"] = 0

    # The monitor's own disabled list wins; anything an operator re-added or
    # removed by hand is reconciled here.
    for iid in list(state["disabled"]):
        if iid in live:
            log.info("%s: re-added outside the monitor, tracking it as enabled again", iid)
            state["disabled"].pop(iid)
        elif iid in manual or iid in ignore:
            log.info("%s: listed as manual/ignored, monitor forgets it and will not re-add it", iid)
            state["disabled"].pop(iid)
    for iid in list(state["indexers"]):
        if iid not in live:
            log.info("%s: removed outside the monitor, no longer tracked", iid)
            state["indexers"].pop(iid)

    t_start = time.time()
    results = {}
    for iid in sorted(live):
        if iid in ignore:
            continue
        if time.time() - t_start > RUN_BUDGET:
            log.warning("run budget exhausted, %s and later untested this run", iid)
            break
        ok, err, secs = j.test(iid)
        results[iid] = (ok, err, secs)
        log.info("test %-16s %s %5.1fs %s", iid, "OK  " if ok else "FAIL", secs, err)
        time.sleep(DELAY_BETWEEN)

    tested = len(results)
    failed = [i for i, r in results.items() if not r[0]]
    outage = tested > 0 and (len(failed) == tested or
                             (tested >= OUTAGE_MIN_TESTED and len(failed) >= OUTAGE_SHARE * tested))
    if outage:
        outage_alert(state, f"не прошли {len(failed)} из {tested} индексаторов")
    else:
        outage_clear(state)
        for iid, (ok, err, secs) in results.items():
            name = live[iid].get("name", iid)
            rec = state["indexers"].setdefault(iid, {"name": name, "fail_streak": 0})
            rec["name"] = name
            if ok:
                rec["fail_streak"] = 0
                rec["last_ok"] = now_iso()
                rec["last_error"] = ""
                continue
            rec["fail_streak"] = rec.get("fail_streak", 0) + 1
            rec["last_error"] = err
            rec["last_fail"] = now_iso()
            if rec["fail_streak"] >= FAIL_THRESHOLD and not args.dry_run:
                try:
                    disable(j, state, iid, name, err)
                    log.info("%s: disabled after %d failed runs", iid, rec["fail_streak"])
                    notify(f"Jackett монитор: отключил {name} ({iid}) - {FAIL_THRESHOLD} проверки подряд "
                           f"с ошибкой: {err[:200]}. Буду проверять каждые 30 мин и включу сам, когда заработает.")
                except Exception as e:
                    log.error("%s: disable failed: %s", iid, e)

        if not args.dry_run:
            for iid in sorted(state["disabled"]):
                if time.time() - t_start > RUN_BUDGET:
                    break
                try:
                    probe_disabled(j, state, iid, state["disabled"][iid])
                except Exception as e:
                    log.error("%s: probe failed: %s", iid, e)
                time.sleep(DELAY_BETWEEN)

    state["last_run"] = {"at": now_iso(), "tested": tested, "failed": failed, "outage": outage,
                         "seconds": round(time.time() - t_start)}
    if not args.dry_run:
        save_json(STATE_FILE, state)
    log.info("run done: tested=%d failed=%d outage=%s disabled_by_monitor=%s", tested, len(failed), outage,
             sorted(state["disabled"]))
    return 0


def init(args):
    """Snapshot indexers that are disabled right now (by hand) so the monitor never touches them."""
    j = Jackett()
    j.login()
    live = j.configured()
    off_dir = os.path.join(JACKETT_DATA_DIR, "Indexers-disabled")
    manual = set()
    if os.path.isdir(off_dir):
        for fn in os.listdir(off_dir):
            if fn.endswith(".json"):
                iid = fn[:-5]
                if iid not in live:
                    manual.add(iid)
    prev = manual_ids()
    data = {"created": load_json(MANUAL_FILE, {}).get("created", now_iso()), "updated": now_iso(),
            "ids": sorted(prev | manual),
            "note": "Disabled by hand before the monitor existed. The monitor never re-adds these."}
    save_json(MANUAL_FILE, data)
    print(json.dumps({"configured": sorted(live), "manual_disabled": data["ids"]}, ensure_ascii=False, indent=2))
    return 0


def status(args):
    state = load_json(STATE_FILE, {})
    print(json.dumps({"manual_disabled": sorted(manual_ids()), "ignored": sorted(read_ignore()),
                      "state": state}, ensure_ascii=False, indent=2))
    return 0


def roundtrip(args):
    """Disable -> re-enable one indexer and verify its config survives."""
    iid = args.id
    j = Jackett()
    j.login()
    if iid not in j.configured():
        print(f"{iid} is not configured")
        return 1
    before = j.get_config(iid)
    save_json(os.path.join(SAVED_DIR, iid + ".roundtrip.json"), before)
    j.delete(iid)
    gone = iid not in j.configured()
    ok, err = j.post_config(iid, before)
    back = iid in j.configured()
    after = j.get_config(iid) if back else []
    same = comparable(before) == comparable(after)
    print(json.dumps({"id": iid, "removed": gone, "reapplied": ok, "reapply_error": err, "configured_again": back,
                      "settings_identical": same, "keys": sorted(comparable(before))}, indent=2))
    return 0 if (gone and back and same) else 1


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--dry-run", action="store_true", help="test only, change nothing")
    r.add_argument("--force", action="store_true", help="ignore quiet window / fresh-restart skip")
    sub.add_parser("init")
    sub.add_parser("status")
    rt = sub.add_parser("roundtrip")
    rt.add_argument("id")
    args = p.parse_args()
    setup_logging()
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    lock = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.info("another run is active, exiting")
        return 0
    return {"run": run, "init": init, "status": status, "roundtrip": roundtrip}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
