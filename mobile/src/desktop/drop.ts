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
  const torrents = files.filter((file) => file.name.toLowerCase().endsWith('.torrent') && file.bytes.length > 0);
  // The first link is the one that opens. Stash that file last: the stash keeps eight, and an older
  // one would be gone before the open.
  const order = magnet || torrents.length < 2 ? torrents : torrents.slice(1).concat(torrents[0]);
  for (const file of order) links.push(stashFile(file.bytes));
  if (!magnet && torrents.length > 1) {
    const opened = links.pop();
    if (opened) links.unshift(opened);
  }
  return links;
}
