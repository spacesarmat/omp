import { stashFile } from '../../../src/api/torrentFiles';

const HASH = /^[0-9a-fA-F]{40}$/;

export function magnetFromText(raw: string): string | null {
  const found = /magnet:\?[^\s]+/i.exec(raw);
  if (found) return found[0];
  const bare = raw.trim();
  if (HASH.test(bare)) return 'magnet:?xt=urn:btih:' + bare;
  return null;
}

export function linksFromDrop(text: string, files: { name: string; bytes: Uint8Array }[]): string[] {
  const links: string[] = [];
  const magnet = magnetFromText(text);
  if (magnet) links.push(magnet);
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.torrent') && file.bytes.length) links.push(stashFile(file.bytes));
  }
  return links;
}
