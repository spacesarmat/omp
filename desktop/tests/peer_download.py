import argparse
import hashlib
import json
import socket
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CONTENT = b"OMP peer download fixture\n"


class Handler(BaseHTTPRequestHandler):
    peer = 0

    def do_GET(self):
        body = b"d8:intervali30e5:peers6:" + socket.inet_aton("127.0.0.1") + self.peer.to_bytes(2, "big") + b"e"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def post(origin, path, payload):
    request = urllib.request.Request(origin + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        data = response.read()
        return json.loads(data) if data else None


def upload(origin, torrent):
    boundary = "omp-peer-test-boundary"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"save\"\r\n\r\ntrue\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"release.torrent\"\r\n"
        "Content-Type: application/x-bittorrent\r\n\r\n"
    ).encode() + torrent + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(origin + "/torrent/upload", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def isolate(origin):
    post(origin, "/settings", {
        "action": "set",
        "sets": {
            "DisableDHT": True,
            "DisableUPNP": True,
            "DisablePEX": True,
            "EnableLPD": False,
            "EnableBonjour": False,
            "DefaultTrackers": "",
            "TrackersListURL": "",
        },
    })


def read_stream(origin, info_hash):
    with urllib.request.urlopen(f"{origin}/stream?link={info_hash}&stat", timeout=15) as response:
        json.load(response)
    url = f"{origin}/stream/fixture.bin?link={info_hash}&index=1&play"
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


class Tracker(ThreadingHTTPServer):
    # ThreadingHTTPServer sets daemon_threads = True. server_close() does not
    # join those request threads, so they can still write to stderr while the
    # interpreter is finalizing. On Windows Python then aborts with
    # _enter_buffered_busy after the download has already succeeded.
    daemon_threads = False


def close_tracker(tracker, thread):
    tracker.shutdown()
    tracker.server_close()
    thread.join(timeout=5)
    if thread.is_alive():
        raise RuntimeError("tracker thread did not stop")


def wait_for_bound_port(seed, attempts=100, pause=0.05):
    last = 0
    for _ in range(attempts):
        last = int(seed.listen_port() or 0)
        if last and seed.is_listening():
            return last
        if pause:
            time.sleep(pause)
    raise RuntimeError(f"libtorrent listen port was not bound: {last}")


class _FakeSeed:
    def __init__(self, ports, listening_at):
        self.ports = ports
        self.listening_at = listening_at
        self.calls = 0

    def listen_port(self):
        port = self.ports[min(self.calls, len(self.ports) - 1)]
        self.calls += 1
        return port

    def is_listening(self):
        return self.calls >= self.listening_at


def check_shutdown():
    ready = wait_for_bound_port(_FakeSeed([0, 0, 4312], 3), attempts=5, pause=0)
    if ready != 4312:
        raise SystemExit(f"listen port wait returned {ready}")
    try:
        wait_for_bound_port(_FakeSeed([0], 9), attempts=2, pause=0)
    except RuntimeError as error:
        if "was not bound" not in str(error):
            raise
    else:
        raise SystemExit("zero listen port was accepted")

    started = threading.Event()
    release = threading.Event()

    class BlockingHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            started.set()
            if not release.wait(timeout=5):
                raise RuntimeError("blocked tracker request was not released")
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_):
            pass

    class Probe(Tracker):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.entered_close = threading.Event()
            self.left_close = threading.Event()

        def server_close(self):
            self.entered_close.set()
            super().server_close()
            self.left_close.set()

    tracker = Probe(("127.0.0.1", 0), BlockingHandler)
    thread = threading.Thread(
        target=lambda: tracker.serve_forever(poll_interval=0.05),
        name="omp-peer-tracker",
    )
    thread.start()

    def client():
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{tracker.server_port}/announce", timeout=5).read()
        except Exception:
            return

    threading.Thread(target=client, name="omp-peer-client", daemon=True).start()
    try:
        if not started.wait(timeout=5):
            raise RuntimeError("tracker request did not start")
        request_threads = [
            item
            for item in threading.enumerate()
            if item is not threading.current_thread()
            and item is not thread
            and item.name != "omp-peer-client"
            and item.is_alive()
        ]
        if not request_threads:
            raise SystemExit("tracker request thread was not running")
        if any(item.daemon for item in request_threads):
            raise SystemExit("tracker request thread is a daemon and will outlive shutdown")
        done = threading.Event()

        def closer():
            close_tracker(tracker, thread)
            done.set()

        threading.Thread(target=closer, name="omp-peer-closer").start()
        if not tracker.entered_close.wait(timeout=5):
            raise SystemExit("shutdown did not reach server_close while the request was blocked")
        if tracker.left_close.wait(timeout=0.3):
            raise SystemExit("shutdown returned while a tracker request was still blocked")
        release.set()
        if not done.wait(timeout=5):
            raise SystemExit("shutdown did not finish after the tracker request completed")
        still = [item.name for item in request_threads if item.is_alive()]
        if still:
            raise SystemExit(f"tracker request threads still running after shutdown: {still}")
    finally:
        release.set()
        if thread.is_alive():
            tracker.shutdown()
            tracker.server_close()
            thread.join(timeout=2)
    print("shutdown clean")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin")
    parser.add_argument("--check-shutdown", action="store_true")
    args = parser.parse_args()
    if args.check_shutdown:
        check_shutdown()
        return
    if not args.origin:
        parser.error("--origin is required")
    import libtorrent as lt
    info = (
        b"d6:lengthi" + str(len(CONTENT)).encode() + b"e"
        b"4:name11:fixture.bin"
        b"12:piece lengthi16384e"
        b"6:pieces20:" + hashlib.sha1(CONTENT).digest() + b"e"
    )
    info_hash = hashlib.sha1(info).hexdigest()
    tracker = Tracker(("127.0.0.1", 0), Handler)
    thread = threading.Thread(
        target=lambda: tracker.serve_forever(poll_interval=0.05),
        name="omp-peer-tracker",
    )
    thread.start()
    announce = f"http://127.0.0.1:{tracker.server_port}/announce"
    torrent = b"d8:announce" + str(len(announce)).encode() + b":" + announce.encode() + b"4:info" + info + b"e"
    seed = None
    handle = None
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as root:
            (Path(root) / "fixture.bin").write_bytes(CONTENT)
            seed = lt.session({
                "listen_interfaces": "127.0.0.1:0",
                "enable_dht": False,
                "enable_lsd": False,
                "enable_natpmp": False,
                "enable_upnp": False,
                "allow_multiple_connections_per_ip": True,
            })
            params = lt.add_torrent_params()
            params.ti = lt.torrent_info(torrent)
            params.save_path = root
            params.flags = lt.torrent_flags.seed_mode | lt.torrent_flags.disable_dht | lt.torrent_flags.disable_lsd
            handle = seed.add_torrent(params)
            for _ in range(50):
                status = handle.status()
                if status.state == lt.torrent_status.seeding:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError(f"libtorrent is not seeding: {status.state}")
            Handler.peer = wait_for_bound_port(seed)
            isolate(args.origin)
            upload(args.origin, torrent)
            try:
                body = read_stream(args.origin, info_hash)
            except Exception:
                print("seed status on failure:", handle.status())
                print("torrent status on failure:", post(args.origin, "/torrents", {"action": "get", "hash": info_hash}))
                raise
            assert body == CONTENT, (len(body), body[:100])
            for _ in range(50):
                uploaded = handle.status().total_payload_upload
                if uploaded >= len(CONTENT):
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError(f"seed uploaded only {uploaded} bytes")
            print(f"Controlled peer download verified: {len(body)} bytes, seed uploaded {uploaded}")
    finally:
        # Drop the session before the tracker so its native thread is joined
        # while stderr is still alive, then join every tracker thread.
        try:
            handle = None
            seed = None
        finally:
            close_tracker(tracker, thread)


if __name__ == "__main__":
    main()
