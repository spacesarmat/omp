import { listStamp } from './time';

export type BotPollView = {
  enabled?: boolean;
  lastOkAt?: number;
  conflictAt?: number;
  conflictRecent?: boolean;
};

function msk(ms?: number) {
  if (!ms) return '';
  return listStamp(ms) + ' МСК';
}

/** One status line: last successful getUpdates, and whether a 409 was recent. */
export function botPollStatusText(poll?: BotPollView | null) {
  if (!poll) return 'Опрос бота: нет данных';
  if (!poll.enabled) return 'Опрос бота выключен (BILLING_BOT_POLL=0).';
  const ok = poll.lastOkAt ? msk(poll.lastOkAt) : 'ещё не было';
  let conflict = 'Конфликт 409 не фиксировался.';
  if (poll.conflictRecent) {
    const when = msk(poll.conflictAt);
    conflict = 'Конфликт 409 был недавно' + (when ? ' (' + when + ')' : '') + '.';
  } else if (poll.conflictAt) {
    conflict = 'Последний конфликт 409: ' + msk(poll.conflictAt) + '.';
  }
  return 'Опрос бота: последний успешный getUpdates ' + ok + '. ' + conflict;
}
