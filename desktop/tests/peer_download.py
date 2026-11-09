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

import libtorrent as lt

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    args = parser.parse_args()
    info = (
        b"d6:lengthi" + str(len(CONTENT)).encode() + b"e"
        b"4:name11:fixture.bin"
        b"12:piece lengthi16384e"
        b"6:pieces20:" + hashlib.sha1(CONTENT).digest() + b"e"
    )
    info_hash = hashlib.sha1(info).hexdigest()
    tracker = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=tracker.serve_forever, daemon=True).start()
    announce = f"http://127.0.0.1:{tracker.server_port}/announce"
    torrent = b"d8:announce" + str(len(announce)).encode() + b":" + announce.encode() + b"4:info" + info + b"e"
    seed = None
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
            Handler.peer = seed.listen_port()
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
        if seed is not None:
            del handle
            del seed
        tracker.shutdown()
        tracker.server_close()


if __name__ == "__main__":
    main()
