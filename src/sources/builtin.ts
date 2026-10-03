// Built-in tracker parsers. They work through the native Android http only, so they are registered by the
// Android entry points (phone app, and the TV bundle when platformKind() === 'androidtv'), never on LG.
// Anidub is left out: its pages have no magnet links (only .torrent files), see the v0.12 task 7 report.
import { nnmclub } from './nnmclub';
import { registerSource } from './registry';
import { rutor } from './rutor';
import { rutracker } from './rutracker';
import type { Source } from './types';

export function builtinParsers(): Source[] {
  return [rutor, nnmclub, rutracker];
}

/** Adds the built-in parsers to the registry (calling it again is harmless). */
export function registerBuiltinSources(): void {
  builtinParsers().forEach(registerSource);
}
