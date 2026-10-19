/**
 * The SQLite store behind the storage interface (db/index.mjs): the JSON snapshot in billing.db
 * (store.mjs) and the device registry tables (registry.mjs), unchanged. Every method resolves the
 * same value the synchronous functions return, so behaviour is identical to the code before the interface.
 */
import { readState, registryDb, resolveDbPath, storageInfo, updateState } from '../store.mjs';
import {
  activeRowForCode,
  deviceRow,
  issuePair,
  listDevices,
  refreshPair,
  revokeRow,
  setDeviceName,
  setRevokeReason,
  tokenSecret,
  touchRow,
  upgradePair,
  verifyAccess,
} from '../registry.mjs';

export function createSqliteStore(file) {
  const path = resolveDbPath(file);
  const db = () => registryDb(path);
  const registry = {
    async deviceRow(id) {
      return deviceRow(db(), id);
    },
    async activeRowForCode(codeId) {
      return activeRowForCode(db(), codeId);
    },
    /** Active rows by code id (the bot's device list reads names and lastSeen from it). */
    async activeRowsByCode() {
      const rows = db().prepare("SELECT * FROM devices WHERE status = 'active' ORDER BY created_at").all();
      const out = new Map();
      for (let i = 0; i < rows.length; i++) out.set(rows[i].code_id, rows[i]);
      return out;
    },
    async listDevices(subscriptionId) {
      return listDevices(db(), subscriptionId);
    },
    async revokeRow(id, reason, now) {
      return revokeRow(db(), id, reason, now);
    },
    async setRevokeReason(id, reason) {
      return setRevokeReason(db(), id, reason);
    },
    async touchRow(id, opts) {
      return touchRow(db(), id, opts);
    },
    async setDeviceName(id, raw) {
      return setDeviceName(db(), id, raw);
    },
    async tokenSecret(env) {
      return tokenSecret(db(), env);
    },
    async verifyAccess(secret, token, deviceId, now) {
      return verifyAccess(db(), secret, token, deviceId, now);
    },
    async issuePair(secret, row, now) {
      return issuePair(db(), secret, row, now);
    },
    async refreshPair(secret, args) {
      return refreshPair(db(), secret, args);
    },
    async upgradePair(secret, args) {
      return upgradePair(db(), secret, args);
    },
  };
  return {
    engine: 'sqlite',
    path,
    async read() {
      return readState(path);
    },
    update(fn) {
      return updateState(path, fn);
    },
    registry,
    async info() {
      return storageInfo(path);
    },
    async close() {
      /* the shared SQLite connection stays open for the process, as before */
    },
  };
}
