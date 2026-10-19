/**
 * Admin login tokens kept in memory during BILLING_READONLY.
 * Sessions already live in memory; these pending tokens must too, so login does not
 * write billing user data while the cutover snapshot is frozen.
 *
 * CLI once-link consumption is also kept out of Postgres: hashes go to an optional
 * side file (BILLING_ADMIN_AUTH_FILE, or BILLING_PG_BACKUP_DIR/.cli-consumed.json)
 * so a restart or leaving read-only cannot reuse a redeemed URL.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256 } from './crypto.mjs';
import {
  confirmAdminPanelLogin,
  startAdminPanelLogin,
  takeAdminPanelLogin,
  takeCliAdminLogin,
} from './logic.mjs';

/** Side-file path for redeemed CLI hashes, or '' when nowhere safe to persist. */
export function adminAuthConsumedPath(env) {
  const explicit = String((env && env.BILLING_ADMIN_AUTH_FILE) || '').trim();
  if (explicit) return explicit;
  const backup = String((env && env.BILLING_PG_BACKUP_DIR) || '').trim();
  if (backup) return join(backup, '.cli-consumed.json');
  return '';
}

function loadHashes(path) {
  if (!path || !existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((h) => String(h || '')).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function saveHashes(path, hashes) {
  if (!path) return;
  const dir = dirname(path);
  if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify([...hashes]), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * After leaving BILLING_READONLY: mark side-file hashes consumed in Postgres, then remove the file.
 * Safe no-op when the file is missing or empty.
 */
export async function flushCliConsumedToStore(store, path) {
  const hashes = loadHashes(path);
  if (!hashes.length) {
    if (path && existsSync(path)) {
      try {
        writeFileSync(path, '[]', { encoding: 'utf8', mode: 0o600 });
      } catch (e) {
        /* ignore */
      }
    }
    return { applied: 0 };
  }
  const set = new Set(hashes);
  let applied = 0;
  await store.update((cur) => {
    const rows = cur.adminCliLogins || [];
    const next = rows.map((l) => {
      if (!l || !set.has(l.hash) || l.consumedAt) return l;
      applied += 1;
      return { ...l, consumedAt: Date.now() };
    });
    return { state: { ...cur, adminCliLogins: next }, result: null };
  });
  try {
    writeFileSync(path, '[]', { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    /* ignore */
  }
  return { applied };
}

export function createAdminAuthMemory(opts) {
  const consumedPath = (opts && opts.consumedPath) || '';
  let adminLogins = [];
  const cliConsumed = new Set(loadHashes(consumedPath));

  return {
    /** Start a Telegram panel login (same shape as store.update result). */
    startPanel(now) {
      const out = startAdminPanelLogin({ adminLogins }, { now });
      adminLogins = out.state.adminLogins;
      return out.result;
    },
    /** Confirm from the bot after /start admin_TOKEN. settings come from a store read. */
    confirmPanel(settings, { token, telegramId, now }) {
      const out = confirmAdminPanelLogin({ adminLogins, settings }, { token, telegramId, now });
      adminLogins = out.state.adminLogins;
      return out.result;
    },
    /** Browser poll for the Telegram login. */
    takePanel({ token, now }) {
      const out = takeAdminPanelLogin({ adminLogins }, { token, now });
      adminLogins = out.state.adminLogins;
      return out.result;
    },
    /**
     * Redeem a CLI once-link. Hashes live in the DB (minted by adminLoginLink.mjs);
     * consumption is recorded in memory and the side file so the database stays untouched.
     */
    takeCli(dbState, { token, now }) {
      const rows = (dbState.adminCliLogins || []).map((l) =>
        l && cliConsumed.has(l.hash) ? { ...l, consumedAt: l.consumedAt || 1 } : l,
      );
      const out = takeCliAdminLogin({ ...dbState, adminCliLogins: rows }, { token, now });
      if (out.result && out.result.status === 'ok') {
        const raw = String(token || '');
        if (raw) {
          const hash = sha256(raw);
          cliConsumed.add(hash);
          saveHashes(consumedPath, cliConsumed);
        }
      }
      return out.result;
    },
    /** Current in-memory panel logins (for a botReply that must not touch the store). */
    panelLogins() {
      return adminLogins.slice();
    },
    replacePanelLogins(next) {
      adminLogins = Array.isArray(next) ? next.slice() : [];
    },
  };
}