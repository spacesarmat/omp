// CI: node scripts/changelog-en.mjs <version> → the English bullets of that version from CHANGELOG.en.md ("- ..." lines), nothing when it is missing.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { changelogNotes } from './hb-lib.mjs';

/** "- bullet" lines for one version of the English changelog; '' when the version is missing. */
export function englishNotes(md, version) {
  return changelogNotes(md, version).map((n) => `- ${n}`).join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) throw new Error('usage: node scripts/changelog-en.mjs <version>');
  let md = '';
  try {
    md = readFileSync('CHANGELOG.en.md', 'utf8');
  } catch (e) {
    md = '';
  }
  const out = englishNotes(md, version);
  if (out) process.stdout.write(out + '\n');
}
