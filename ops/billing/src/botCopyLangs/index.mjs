/**
 * CIS language packs for the bot replies. One file per language: `catalog` holds the template
 * bodies by id, `strings` the plain UI strings by id, `samples` the preview values by variable
 * key. RU/EN stay in botCopy.mjs; these packs only add the new codes. Variables in every text
 * must match the RU/EN source exactly.
 */
import * as uk from './uk.mjs';
import * as be from './be.mjs';
import * as kk from './kk.mjs';
import * as ky from './ky.mjs';
import * as uz from './uz.mjs';
import * as tg from './tg.mjs';
import * as tk from './tk.mjs';
import * as hy from './hy.mjs';
import * as az from './az.mjs';
import * as ka from './ka.mjs';
import * as ro from './ro.mjs';

export const LANG_PACKS = { uk, be, kk, ky, uz, tg, tk, hy, az, ka, ro };