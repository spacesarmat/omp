#!/usr/bin/env node
// Exit non-zero when CHANGELOG.md / CHANGELOG.en.md are not strict UTF-8 or look corrupted.
import { readChangelogUtf8 } from './changelog-encoding.mjs';

readChangelogUtf8('CHANGELOG.md', { russian: true });
readChangelogUtf8('CHANGELOG.en.md');
console.log('changelog encoding ok');
