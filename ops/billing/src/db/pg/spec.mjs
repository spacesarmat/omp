/**
 * How the billing state maps onto Postgres tables (migration 001 in schema.mjs creates them).
 *
 * Every collection row is one table row: a known field goes to its typed column when its value has
 * that type; anything else (unknown fields, null, a number where a string is expected, …) is kept
 * as is in the row's `extra jsonb`. A NULL column means «the row has no such field». So a row read
 * back is the same JSON as the row written. Times stay epoch milliseconds (bigint), as in the code.
 *
 * `ord` keeps the array order. `key` is the row identity: `id` (stable ids, meta.rowIds) or a natural
 * key for token rows. `appendOnly` collections (logs) are never deleted by a write: a row the code
 * trimmed from the array is marked `live = false` and stays for history (retention is a separate job);
 * a read loads the live rows only, so the state is the same as the array.
 * Reserved: a row key starting with "$" is stored in extra as "$$…" ("$arrays" marks which child arrays exist).
 * Child arrays (subscription swaps and bonus slots, promo uses, account linked devices) live in their
 * own tables keyed by (parent id, ord) and are rewritten when the parent row changes.
 */

/** [js field, column, type]; type: text | int (safe integer, bigint) | num (double) | bool | json */
export const COLLECTIONS = [
  {
    name: 'accounts',
    table: 'accounts',
    key: 'id',
    cols: [
      ['email', 'email', 'text'],
      ['telegramId', 'telegram_id', 'text'],
      ['telegramUsername', 'telegram_username', 'text'],
      ['telegramName', 'telegram_name', 'text'],
      ['createdAt', 'created_at', 'int'],
    ],
    children: [{ field: 'linkedDevices', table: 'account_devices', scalar: ['device_id', 'text'] }],
  },
  {
    name: 'subscriptions',
    table: 'subscriptions',
    key: 'id',
    cols: [
      ['accountId', 'account_id', 'text'],
      ['product', 'product', 'text'],
      ['paidUntil', 'paid_until', 'int'],
      ['deviceLimit', 'device_limit', 'int'],
      ['limitOverride', 'limit_override', 'int'],
      ['extraSlots', 'extra_slots', 'int'],
      ['extraUntil', 'extra_until', 'int'],
      ['creditRub', 'credit_rub', 'int'],
      ['swapsResetAt', 'swaps_reset_at', 'int'],
      ['createdAt', 'created_at', 'int'],
      ['extendedAt', 'extended_at', 'int'],
      // { until, sent: {kind: ms}, tries: {kind: n} } for the current paidUntil: a small state document.
      ['reminders', 'reminders', 'json'],
    ],
    children: [
      { field: 'swaps', table: 'device_swaps', cols: [['id', 'id', 'text'], ['at', 'at', 'int'], ['device', 'device', 'text']] },
      {
        field: 'bonusSlots',
        table: 'bonus_slots',
        cols: [
          ['id', 'id', 'text'],
          ['count', 'count', 'int'],
          ['until', 'until', 'int'],
          ['reason', 'reason', 'text'],
          ['source', 'source', 'text'],
          ['grantedAt', 'granted_at', 'int'],
        ],
      },
    ],
  },
  {
    name: 'codes',
    table: 'activation_codes',
    key: 'id',
    cols: [
      ['subscriptionId', 'subscription_id', 'text'],
      ['hash', 'hash', 'text'],
      ['plain', 'plain', 'text'],
      ['deviceId', 'device_id', 'text'],
      ['boundAt', 'bound_at', 'int'],
      ['lastSeenAt', 'last_seen_at', 'int'],
      ['lastIp', 'last_ip', 'text'],
      ['revoked', 'revoked', 'bool'],
      ['createdAt', 'created_at', 'int'],
    ],
  },
  {
    name: 'sessions',
    table: 'legacy_sessions',
    key: 'hash',
    cols: [
      ['hash', 'hash', 'text'],
      ['codeId', 'code_id', 'text'],
      ['createdAt', 'created_at', 'int'],
      ['upgradedAt', 'upgraded_at', 'int'],
    ],
  },
  {
    name: 'attempts',
    table: 'activation_attempts',
    key: 'id',
    appendOnly: true,
    cols: [
      ['at', 'at', 'int'],
      ['hash', 'hash', 'text'],
      ['deviceId', 'device_id', 'text'],
      ['ok', 'ok', 'bool'],
      ['reason', 'reason', 'text'],
      ['accountId', 'account_id', 'text'],
    ],
  },
  {
    name: 'payments',
    table: 'payments',
    key: 'id',
    cols: [
      ['operationId', 'operation_id', 'text'],
      ['label', 'label', 'text'],
      ['amount', 'amount', 'text'],
      ['currency', 'currency', 'text'],
      ['at', 'at', 'int'],
      ['accountId', 'account_id', 'text'],
      ['error', 'error', 'text'],
      ['pending', 'pending', 'bool'],
      ['credited', 'credited', 'num'],
      ['confirmedBy', 'confirmed_by', 'text'],
      ['heldAt', 'held_at', 'int'],
      ['rejectedAt', 'rejected_at', 'int'],
    ],
  },
  {
    name: 'webhooks',
    table: 'webhook_problems',
    key: 'id',
    appendOnly: true,
    cols: [
      ['kind', 'kind', 'text'],
      ['operationId', 'operation_id', 'text'],
      ['label', 'label', 'text'],
      ['amount', 'amount', 'text'],
      ['at', 'at', 'int'],
    ],
  },
  {
    name: 'promos',
    table: 'promos',
    key: 'id',
    cols: [
      ['code', 'code', 'text'],
      ['days', 'days', 'int'],
      ['maxUses', 'max_uses', 'int'],
      ['bonusSlots', 'bonus_slots', 'int'],
      ['bonusDays', 'bonus_days', 'int'],
      ['createdAt', 'created_at', 'int'],
      ['revoked', 'revoked', 'bool'],
    ],
    children: [
      {
        field: 'uses',
        table: 'promo_uses',
        cols: [
          ['id', 'id', 'text'],
          ['accountId', 'account_id', 'text'],
          ['at', 'at', 'int'],
          ['subscriptionId', 'subscription_id', 'text'],
          ['code', 'code', 'text'],
        ],
      },
    ],
  },
  {
    name: 'links',
    table: 'device_links',
    key: 'token',
    cols: [
      ['token', 'token', 'text'],
      ['deviceId', 'device_id', 'text'],
      ['accountId', 'account_id', 'text'],
      ['createdAt', 'created_at', 'int'],
      ['expiresAt', 'expires_at', 'int'],
      ['usedAt', 'used_at', 'int'],
    ],
  },
  {
    name: 'adminLogins',
    table: 'admin_logins',
    key: 'token',
    cols: [
      ['token', 'token', 'text'],
      ['telegramId', 'telegram_id', 'text'],
      ['createdAt', 'created_at', 'int'],
      ['expiresAt', 'expires_at', 'int'],
      ['confirmedAt', 'confirmed_at', 'int'],
      ['consumedAt', 'consumed_at', 'int'],
      ['deniedAt', 'denied_at', 'int'],
    ],
  },
  {
    name: 'adminCliLogins',
    table: 'admin_cli_logins',
    key: 'hash',
    cols: [
      ['hash', 'hash', 'text'],
      ['createdAt', 'created_at', 'int'],
      ['expiresAt', 'expires_at', 'int'],
      ['consumedAt', 'consumed_at', 'int'],
    ],
  },
  {
    name: 'supportMessages',
    table: 'support_messages',
    key: 'id',
    appendOnly: true,
    cols: [
      ['telegramId', 'telegram_id', 'text'],
      ['text', 'text', 'text'],
      ['direction', 'direction', 'text'],
      ['at', 'at', 'int'],
      ['via', 'via', 'text'],
    ],
  },
  {
    name: 'supportReplies',
    table: 'support_replies',
    key: 'key',
    cols: [
      ['key', 'key', 'text'],
      ['telegramId', 'telegram_id', 'text'],
      ['at', 'at', 'int'],
    ],
  },
  {
    name: 'audit',
    table: 'audit',
    key: 'id',
    appendOnly: true,
    cols: [
      ['at', 'at', 'int'],
      ['action', 'action', 'text'],
      ['detail', 'detail', 'text'],
      ['accountId', 'account_id', 'text'],
      // { kind, id, label }: who did it
      ['actor', 'actor', 'json'],
    ],
  },
  {
    name: 'purchases',
    table: 'purchases',
    key: 'id',
    cols: [
      ['kind', 'kind', 'text'],
      ['accountId', 'account_id', 'text'],
      ['subscriptionId', 'subscription_id', 'text'],
      ['price', 'price', 'num'],
      ['extras', 'extras', 'int'],
      ['credit', 'credit', 'num'],
      ['addExtra', 'add_extra', 'int'],
      ['paidUntil', 'paid_until', 'int'],
      ['currency', 'currency', 'text'],
      ['at', 'at', 'int'],
    ],
  },
];

/** Top-level keys stored elsewhere: settings (key/value), meta (key/value), supportClosed (telegram id → ms). */
export const SPECIAL_KEYS = ['settings', 'meta', 'supportClosed'];

export function fits(type, v) {
  if (type === 'text') return typeof v === 'string';
  if (type === 'int') return typeof v === 'number' && Number.isSafeInteger(v);
  if (type === 'num') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'bool') return typeof v === 'boolean';
  // JSON null is kept in extra: a NULL column already means «no such field».
  if (type === 'json') return v !== undefined && v !== null;
  return false;
}
