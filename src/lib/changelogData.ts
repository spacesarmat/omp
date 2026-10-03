import raw from '../../CHANGELOG.md?raw';
import { parseChangelog } from './changelog';

/** The latest versions only: the full history is on GitHub. */
export const CHANGELOG = parseChangelog(raw).slice(0, 8);
export const CHANGELOG_URL = 'https://github.com/spacesarmat/omp/blob/main/CHANGELOG.md';
