import type { PlayerState } from '../../../src/phone/protocol';

const cssUrl = (u: string) => u.replace(/["()\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export const hasPosterImage = (s: PlayerState) => /^https?:\/\//i.test(s.poster || '');

export function playerPosterStyle(s: PlayerState): string {
  const gradient = 'linear-gradient(160deg, #2B3A55, #151A26 80%)';
  return hasPosterImage(s) ? `background: url("${cssUrl(s.poster || '')}") center / cover, ${gradient}` : `background: ${gradient}`;
}
