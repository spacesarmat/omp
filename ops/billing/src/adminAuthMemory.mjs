/**
 * Admin login tokens kept in memory during BILLING_READONLY.
 * Sessions already live in memory; these pending tokens must too, so login does not
 * write billing user data while the cutover snapshot is frozen.
 */
import { sha256 } from './crypto.mjs';
import {
  confirmAdminPanelLogin,
  startAdminPanelLogin,
  takeAdminPanelLogin,
  takeCliAdminLogin,
} from './logic.mjs';

export function createAdminAuthMemory() {
  let adminLogins = [];
  const cliConsumed = new Set();

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
     * consumption is recorded only in memory so the database stays untouched.
     */
    takeCli(dbState, { token, now }) {
      const rows = (dbState.adminCliLogins || []).map((l) =>
        l && cliConsumed.has(l.hash) ? { ...l, consumedAt: l.consumedAt || 1 } : l,
      );
      const out = takeCliAdminLogin({ ...dbState, adminCliLogins: rows }, { token, now });
      if (out.result && out.result.status === 'ok') {
        const raw = String(token || '');
        if (raw) cliConsumed.add(sha256(raw));
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