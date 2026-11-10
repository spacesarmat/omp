import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE_FILES = ['index.html', 'download.js', 'en/index.html', 'assets/logo.svg', 'assets/manrope-latin.woff2', 'assets/manrope-cyrillic.woff2'];

export function copyDownloadPages(sourceDir, destinationDir) {
  for (const file of PAGE_FILES) {
    const source = join(sourceDir, file);
    if (!existsSync(source)) throw new Error(`Missing download page input: ${file}`);
  }
  for (const file of PAGE_FILES) {
    const target = join(destinationDir, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(sourceDir, file), target);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [sourceDir, destinationDir] = process.argv.slice(2);
  if (!sourceDir || !destinationDir) throw new Error('usage: node scripts/publish-pages.mjs <source-dir> <destination-dir>');
  copyDownloadPages(sourceDir, destinationDir);
}
