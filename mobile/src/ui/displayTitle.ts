import { stripExt } from '../../../src/lib/episodes';

const FILE_EXT = /\.(mkv|mp4|avi|mov|m4v|ts|webm|wmv|flv|mpg|mpeg|m2ts)$/i;

/** File-name-like titles lose the extension and get dots/underscores replaced by spaces; other titles stay as they are. */
export function displayTitle(title: string): string {
  if (!FILE_EXT.test(title)) return title;
  const clean = stripExt(title).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || title;
}
