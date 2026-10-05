// «Нет аккаунта?»: the registration page of a site that needs an account (rutracker, Kinozal, rustorka). Pure.
// The paths are the engines' registration forms: rutracker and rustorka are phpBB-style (profile.php?mode=register),
// Kinozal is TBDev (signup.php). A mirror host (Kinozal) comes from the caller; a bare host name only.
import { urlHost } from './mirrors';

const HOST = /^[a-z0-9.-]+$/;

function cleanHost(host: string | undefined, fallback: string): string {
  const h = (host || '').toLowerCase();
  return HOST.test(h) ? h : fallback;
}

/** Registration page of the site, null for a site without an account. */
export function registrationUrl(sourceId: string, activeHost?: string): string | null {
  if (sourceId === 'rutracker') return 'https://rutracker.org/forum/profile.php?mode=register';
  if (sourceId === 'kinozal') return 'https://' + cleanHost(activeHost, 'kinozal.tv') + '/signup.php';
  if (sourceId === 'rustorka') return 'https://' + cleanHost(activeHost, 'rustorka.com') + '/forum/profile.php?mode=register';
  return null;
}

/** The same for a source: Kinozal's page goes to the mirror the source is on now. */
export function registrationOf(s: { id: string; siteUrl?: string }): string | null {
  return registrationUrl(s.id, urlHost(s.siteUrl || ''));
}
