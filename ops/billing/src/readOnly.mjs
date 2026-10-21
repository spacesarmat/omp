/**
 * BILLING_READONLY=1: the cutover window (docs/billing/postgres-cutover.md). Reads keep working, every write
 * is refused with 503 so nothing lands in the database while a copy is taken or restored: POST routes answer 503
 * (YooMoney retries its notification later), the store refuses update() and registry writes, lastSeen
 * touches are skipped, and the bot poller, reminders and retention do not start (Telegram keeps the
 * updates for 24 hours and hands them over after the switch).
 */

export function readOnlyMode(env) {
  const raw = String(((env || process.env).BILLING_READONLY) || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}

export class ReadOnlyError extends Error {
  constructor() {
    super('billing is read-only (cutover in progress)');
    this.code = 'READ_ONLY';
  }
}

export function isReadOnlyError(e) {
  return !!e && e.code === 'READ_ONLY';
}

const REGISTRY_WRITES = ['revokeRow', 'setRevokeReason', 'setDeviceName', 'issuePair', 'refreshPair', 'upgradePair'];

/** The same store with every write refused (touchRow becomes a no-op). */
export function readOnlyStore(store) {
  const registry = { ...store.registry };
  for (const name of REGISTRY_WRITES) {
    if (typeof registry[name] === 'function') registry[name] = async () => { throw new ReadOnlyError(); };
  }
  if (typeof registry.touchRow === 'function') registry.touchRow = async () => null;
  // Ads: images are still served; counters and uploads are refused like every other write.
  const ads = store.ads
    ? {
        ...store.ads,
        bump: async () => {
          throw new ReadOnlyError();
        },
        putImage: async () => {
          throw new ReadOnlyError();
        },
        gcImages: async () => 0,
      }
    : undefined;
  return {
    ...store,
    ads,
    engine: store.engine,
    readOnly: true,
    read: () => store.read(),
    update: async () => {
      throw new ReadOnlyError();
    },
    registry,
    info: () => store.info(),
    close: () => (store.close ? store.close() : undefined),
  };
}
