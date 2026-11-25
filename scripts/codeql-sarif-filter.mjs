// Drops CodeQL results that point into node_modules before they are uploaded.
// paths-ignore does not filter a compiled language: the java-kotlin job builds with Gradle, and Gradle
// compiles :capacitor-android straight out of node_modules, so those findings must be removed here.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const THIRD_PARTY = /(^|\/)node_modules\//;

function uriOf(loc) {
  return String((loc && loc.physicalLocation && loc.physicalLocation.artifactLocation && loc.physicalLocation.artifactLocation.uri) || '');
}

/**
 * True when the result is reported IN third-party code. Related locations and code flows are ignored on purpose:
 * a finding in our own file that merely passes through a library stays reported.
 */
export function thirdParty(result) {
  const uris = [];
  (result.locations || []).forEach((l) => uris.push(uriOf(l)));
  if (!uris.length) uris.push(uriOf(result.location));
  return uris.some((u) => THIRD_PARTY.test(u));
}

/** Removes third-party results from one SARIF document and counts what went. */
export function filterSarif(text) {
  const doc = JSON.parse(text);
  let dropped = 0;
  for (const run of doc.runs || []) {
    const kept = [];
    for (const result of run.results || []) {
      if (thirdParty(result)) dropped++;
      else kept.push(result);
    }
    run.results = kept;
  }
  return { doc, dropped };
}

/** Filters every *.sarif under dir in place; returns the per-file counts. */
export function filterDir(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.sarif')) continue;
    const file = join(dir, name);
    if (!statSync(file).isFile()) continue;
    const { doc, dropped } = filterSarif(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify(doc));
    out.push({ file: name, dropped });
  }
  return out;
}

if (process.argv[2]) {
  const rows = filterDir(process.argv[2]);
  if (!rows.length) console.log('codeql-sarif-filter: no sarif files in ' + process.argv[2]);
  for (const r of rows) console.log('codeql-sarif-filter: ' + r.file + ' dropped ' + r.dropped + ' result(s) from node_modules');
}
