// A pairing link from the TV QR (https://omp-player.online/pair?...) connects the server
// and, when a TV is already chosen, links the remote. The camera opens this URL; the app claims it.
import { parsePairUri } from '../../../src/lib/pairing';
import { t } from '../../../src/i18n';
import { connectServer } from '../connect/connectServer';
import { navigate } from '../nav';
import { showToast } from '../ui/toast';
import { activeTv } from '../tv/tvStore';
import { attachIfOmpForeground } from '../tv/playerLink';

/** True when `url` is a pairing link. The connect itself is applyPairUrl. */
export function isPairUrl(url: string): boolean {
  return parsePairUri(url) !== null;
}

/**
 * Connects the server from a pairing link and finishes the remote link when a TV is already chosen.
 * Returns false when the URL is not a pairing link.
 */
export async function applyPairUrl(url: string): Promise<boolean> {
  const data = parsePairUri(url);
  if (!data) return false;
  const name = data.name || data.url.replace(/^https?:\/\//, '');
  const cfg: { name: string; url: string; user?: string; password?: string } = { name, url: data.url };
  if (data.user) cfg.user = data.user;
  if (data.password) cfg.password = data.password;
  const r = await connectServer(cfg);
  if (!r.ok) {
    showToast(r.error);
    return true;
  }
  showToast(t('connect.addedToast', { name: r.server.name || name }));
  if (activeTv.value) void attachIfOmpForeground();
  else navigate({ name: 'tv' });
  return true;
}
