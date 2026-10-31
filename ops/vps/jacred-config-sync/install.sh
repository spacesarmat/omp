#!/usr/bin/env bash
# Install / update the JacRed config copy-back on the server. Run from this directory as root.
set -euo pipefail
install -d -m 755 /opt/omp-vps/jacred-config-sync
install -m 755 jacred-config-sync.sh /opt/omp-vps/jacred-config-sync/jacred-config-sync.sh
install -d -m 700 /var/backups/jacred-config
install -m 644 jacred-config-sync.service /etc/systemd/system/jacred-config-sync.service
install -m 644 jacred-config-sync.timer /etc/systemd/system/jacred-config-sync.timer
systemctl daemon-reload
systemctl enable --now jacred-config-sync.timer
systemctl list-timers jacred-config-sync.timer --no-pager
