// Built-in tracker parsers. They work through the native Android http only, so they are registered by the
// Android entry points (phone app, and the TV bundle when platformKind() === 'androidtv'), never on LG.
// Anidub has no magnets: its results carry an http(s) .torrent link in Link, which TorrServer adds itself.
import { anidub } from './anidub';
import { nnmclub } from './nnmclub';
import { registerSource } from './registry';
import { rutor } from './rutor';
import { rutracker } from './rutracker';
import type { Source } from './types';

export function builtinParsers(): Source[] {
  return [rutor, nnmclub, anidub, rutracker];
}

/** Adds the built-in parsers to the registry (calling it again is harmless). */
export function registerBuiltinSources(): void {
  builtinParsers().forEach(registerSource);
}
