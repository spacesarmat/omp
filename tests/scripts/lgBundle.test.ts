import { describe, it, expect } from 'vitest';
// @ts-ignore node builtin, no @types/node in this project
import { existsSync, readdirSync, readFileSync } from 'node:fs';
// @ts-ignore node builtin, no @types/node in this project
import { dirname, join, resolve } from 'node:path';

// The LG bundle (src/main.tsx) must not statically reach the site parsers: they are loaded with a dynamic import on
// Android TV only (vite makes them a separate chunk). Walks the static imports of the entry point.
// every module the built-in source list pulls in (the parsers), except the shared registry and types
const BUILTIN = resolve('src/sources/builtin.ts');
const PARSERS = [BUILTIN].concat(
  (readFileSync(BUILTIN, 'utf8').match(/from '[.][/][a-z]+'/g) || [])
    .map((x: string) => x.slice(8, -1))
    .filter((n: string) => n !== 'registry' && n !== 'types')
    .map((n: string) => resolve('src/sources', n + '.ts')),
);

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]) if (existsSync(c)) return c;
  return null;
}

/** Files reachable from `entry` through static `import … from` / `export … from` (dynamic import() and type-only imports do not count). */
function staticGraph(entry: string): string[] {
  const seen: { [f: string]: true } = {};
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen[f]) continue;
    seen[f] = true;
    const src = readFileSync(f, 'utf8');
    const re = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (m[1]) continue;
      const r = resolveImport(f, m[2]);
      if (r) todo.push(r);
    }
  }
  return Object.keys(seen);
}

describe('LG bundle', () => {
  it('has no site parser in the static import graph of the TV entry', () => {
    const graph = staticGraph(resolve('src/main.tsx'));
    expect(graph.length).toBeGreaterThan(20);
    const hit = PARSERS.filter((p) => graph.indexOf(p) >= 0);
    expect(hit).toEqual([]);
  });

  it('the parser list is derived from builtin.ts and is not empty', () => {
    expect(PARSERS.length).toBeGreaterThanOrEqual(7);
  });

  it('the built LG entry (dist) has no parser code; skipped when dist is not built', () => {
    const dir = resolve('dist/assets');
    const entry = existsSync(dir) ? readdirSync(dir).filter((f: string) => /^index-legacy-.*[.]js$/.test(f))[0] : undefined;
    if (!entry) {
      console.warn('lgBundle: dist/assets/index-legacy-*.js not found, build check skipped (run npm run build first)');
      return;
    }
    const code = readFileSync(join(dir, entry), 'utf8');
    expect(code.indexOf('tracker.php?nm=')).toBe(-1);
    expect(code.indexOf('rutor.info')).toBe(-1);
  });

  it('the Android TV entry loads the parsers with a dynamic import', () => {
    const main = readFileSync(resolve('src/main.tsx'), 'utf8');
    expect(main).toMatch(/import\('\.\/sources\/builtin'\)/);
    expect(main).toMatch(/platformKind\(\) === 'androidtv'/);
  });
});
