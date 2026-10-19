# Jackett indexer monitor

Runs on the OMP VPS every 30 minutes (systemd timer, at :07 and :37 plus up to 60 s jitter).
It tests every configured Jackett indexer and disables broken ones. Once a disabled indexer
works again, the monitor turns it back on by itself.

## How it works

- **Test**: Jackett's own check, `POST /api/v2.0/indexers/{id}/test` (admin session cookie). This is the
  same test as the "Test" button in the Jackett UI: a search that must return results through
  FlareSolverr/WARP. Indexers are tested one at a time with a 75 s timeout and a 2 s pause between them.
  Testing new indexers stops after 12 minutes. A full run normally takes about 3 minutes.
- **Disable**: Jackett has no on/off switch, so "disable" means `DELETE /api/v2.0/indexers/{id}`.
  First the indexer's config (`GET .../config`) and a copy of its on-disk JSON are saved to
  `/var/lib/jackett-monitor/saved-configs/` (root only).
- **Re-check / re-enable**: on each run the saved config is applied again with `POST .../config`, followed by a test.
  The indexer only stays enabled after `OK_THRESHOLD` passes in a row. Until then it is removed again right after the probe.
  After re-enabling, the settings are compared with the saved copy.
- **Thresholds**: `FAIL_THRESHOLD = 2` failed runs in a row before disabling. `OK_THRESHOLD = 2` passed runs in a row before re-enabling.
- **Only its own indexers**: the monitor re-adds only indexers that it removed itself (`state.json` → `disabled`).
  It never re-adds indexers that were already off before the monitor existed. `monitor.py init` snapshots
  those into `manual-disabled.json`, from `Jackett/Indexers-disabled/`.
  - If you remove an indexer by hand, the monitor stops tracking it.
  - If you re-add an indexer that the monitor disabled, the monitor just tracks it again.
  - Ids listed in `/etc/jackett-monitor/ignore` are never disabled or re-added.
- **Outage guard**: the monitor disables nothing and sends one alert when any of these happens:
  - every tested indexer fails, or at least 80 % of them fail with 5 or more tested;
  - Jackett does not answer two runs in a row;
  - the Jackett container is stopped.

  It sends one more message when Jackett recovers.
- **Weekly update**: runs are skipped on Sunday 03:45-04:45 MSK, when the image update restarts Jackett,
  and for 10 minutes after the Jackett container starts. A lock file stops two runs from overlapping.

## Files on the VPS

| Path | What |
|---|---|
| `/opt/omp-vps/jackett-monitor/monitor.py` | script (stdlib Python 3) |
| `/etc/systemd/system/jackett-monitor.{service,timer}` | schedule |
| `/var/lib/jackett-monitor/state.json` | failure/success streaks, disabled-by-monitor list, outage flag |
| `/var/lib/jackett-monitor/manual-disabled.json` | snapshot of pre-existing manually disabled indexers |
| `/var/lib/jackett-monitor/saved-configs/` | configs of indexers the monitor removed |
| `/var/log/jackett-monitor/monitor.log` | log, rotated at 1 MB, 5 files kept |
| `/etc/jackett-monitor/ignore` | optional: ids to never touch |
| `/etc/jackett-monitor/telegram.env` | optional: `TG_BOT_TOKEN`, `TG_CHAT_ID` (chmod 600) |

The script reads its secrets on the VPS from these files:
- the Jackett admin password from `/root/jackett-admin-password.txt`;
- the Telegram token from `/etc/jackett-monitor/telegram.env`.

It never logs them. Telegram goes through the `omp-warp` HTTP proxy, because the VPS IP cannot reach
api.telegram.org directly. Messages are sent only on state changes (disabled, re-enabled, outage, recovered).
Without `telegram.env` they are only written to the log.

## Commands

```bash
python3 /opt/omp-vps/jackett-monitor/monitor.py status             # state as JSON
python3 /opt/omp-vps/jackett-monitor/monitor.py run --dry-run      # test only, change nothing
systemctl start jackett-monitor.service                            # one real run now
journalctl -u jackett-monitor.service -n 50                        # or the log file
python3 /opt/omp-vps/jackett-monitor/monitor.py roundtrip <id>     # disable->enable check for one indexer
```

To keep a monitor-disabled indexer off for good, add its id to `/etc/jackett-monitor/ignore`.

## Install / update

Copy this directory to the VPS, then run `sudo ./install.sh`.
