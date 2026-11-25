import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterDir, filterSarif, thirdParty } from '../../scripts/codeql-sarif-filter.mjs';

const loc = (uri: string) => ({ physicalLocation: { artifactLocation: { uri } } });
const at = (uri: string) => ({ locations: [loc(uri)] });

describe('codeql sarif third-party filter', () => {
  it('recognizes the Gradle module that comes out of node_modules', () => {
    expect(thirdParty(at('../node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java'))).toBe(true);
    expect(thirdParty(at('node_modules/x/Y.java'))).toBe(true);
    expect(thirdParty(at('android/app/src/main/java/com/spacesarmat/omp/MainActivity.kt'))).toBe(false);
    // a finding in our code that only mentions a library stays
    expect(thirdParty({ ...at('ops/billing/src/server.mjs'), relatedLocations: [loc('node_modules/express/index.js')] })).toBe(false);
  });

  it('drops only the third-party results and keeps the rest of the document', () => {
    const doc = {
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'CodeQL' } }, results: [at('src/a.ts'), at('node_modules/@capacitor/android/X.java'), at('ops/billing/src/server.mjs')] }],
    };
    const { doc: out, dropped } = filterSarif(JSON.stringify(doc));
    expect(dropped).toBe(1);
    const uris = (out.runs![0].results || []).map((r) => r.locations![0].physicalLocation!.artifactLocation!.uri);
    expect(uris).toEqual(['src/a.ts', 'ops/billing/src/server.mjs']);
    expect(out.runs![0].tool).toEqual({ driver: { name: 'CodeQL' } });
  });

  it('rewrites every sarif file in a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeql-sarif-'));
    try {
      const one = { runs: [{ results: [at('node_modules/a/B.java'), at('src/c.ts')] }] };
      const two = { runs: [{ results: [at('src/d.ts')] }] };
      writeFileSync(join(dir, 'java.sarif'), JSON.stringify(one));
      writeFileSync(join(dir, 'js.sarif'), JSON.stringify(two));
      writeFileSync(join(dir, 'notes.txt'), 'skip me');
      const rows = filterDir(dir);
      expect(rows.map((r) => r.file).sort()).toEqual(['java.sarif', 'js.sarif']);
      expect(rows.find((r) => r.file === 'java.sarif')!.dropped).toBe(1);
      expect(JSON.parse(readFileSync(join(dir, 'java.sarif'), 'utf8')).runs[0].results).toHaveLength(1);
      expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('skip me');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
