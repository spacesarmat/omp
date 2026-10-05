// Built-in tracker parsers. They work through the native Android http only, so they are registered by the
// Android entry points (phone app, and the TV bundle when platformKind() === 'androidtv'), never on LG.
// Anidub and BigFANGroup have no magnets: their results carry an http(s) .torrent link in Link, which TorrServer
// adds itself.
import { anidub } from './anidub';
import { bigfangroup } from './bigfangroup';
import { startIndexerSources } from './indexer';
import { nnmclub } from './nnmclub';
import { registerSource } from './registry';
import { rutor } from './rutor';
import { rutracker } from './rutracker';
import { kinozal } from './kinozal';
import { rustorka } from './rustorka';
import { torrentby } from './torrentby';
import type { Source } from './types';

export function builtinParsers(): Source[] {
  // the sites behind Cloudflare last: off until signed in («Сайты за Cloudflare»)
  return [rutor, nnmclub, anidub, bigfangroup, torrentby, rutracker, kinozal, rustorka];
}

/** Adds the built-in parsers and the saved indexer connections to the registry (calling it again is harmless). */
export function registerBuiltinSources(): void {
  builtinParsers().forEach(registerSource);
  // Jackett / Prowlarr connections: one source each, and the path selection against ts-torznab
  startIndexerSources();
}
