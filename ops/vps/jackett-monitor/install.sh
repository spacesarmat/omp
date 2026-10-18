#!/usr/bin/env bash
# Install / update the Jackett monitor on the VPS. Run from this directory as root.
set -euo pipefail
install -d -m 755 /opt/omp-vps/jackett-monitor
install -m 755 monitor.py /opt/omp-vps/jackett-monitor/monitor.py
install -d -m 700 /etc/jackett-monitor /var/lib/jackett-monitor
install -d -m 750 /var/log/jackett-monitor
[ -f /etc/jackett-monitor/ignore ] || printf '# indexer ids the monitor must never disable or re-add, one per line\n' > /etc/jackett-monitor/ignore
install -m 644 jackett-monitor.service /etc/systemd/system/jackett-monitor.service
install -m 644 jackett-monitor.timer /etc/systemd/system/jackett-monitor.timer
systemctl daemon-reload
# Snapshot indexers disabled by hand right now (kept forever, merged on re-run).
python3 /opt/omp-vps/jackett-monitor/monitor.py init
systemctl enable --now jackett-monitor.timer
systemctl list-timers jackett-monitor.timer --no-pager
