// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultTheme } from '../../design/defaults';
import { checkGeneratedThemes, writeGeneratedThemes } from '../../design/generate';
import { activeOverrideIds, generateThemeCss, resolveThemeTokens, type ThemeContext } from '../../design/theme';
import { checkTheme } from '../../design/theme-checks';

const BASE = '0000000000000000000000000000000000000000';
const context: ThemeContext = {
  target: 'desktop-windows',
  screenId: 'settings',
  elementId: 'settings-continue',
  format: 'landscape',
  state: 'default',
};
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('theme resolver and generator', () => {
  it('keeps platform overrides isolated and orders scopes explicitly', () => {
    const theme = createDefaultTheme(BASE);
    theme.overrides.push(
      { id: 'win-accent', scope: 'target', target: 'desktop-windows', tokens: { '--omp-color-accent': '#111111' } },
      { id: 'mac-accent', scope: 'target', target: 'desktop-macos', tokens: { '--omp-color-accent': '#222222' } },
      { id: 'button', scope: 'element', elementId: 'settings-continue', tokens: { '--omp-size-space': '12px' } },
      { id: 'landscape', scope: 'format', format: 'landscape', elementId: 'settings-continue', tokens: { '--omp-size-space': '20px' } },
    );

    expect(activeOverrideIds(theme, context)).toEqual(['win-accent', 'button', 'landscape']);
    expect(resolveThemeTokens(theme, context)['--omp-size-space']).toBe('20px');
    const first = generateThemeCss(theme, 'desktop-windows');
    expect(first).toContain('#111111');
    expect(first).not.toContain('#222222');
    expect(first).toBe(generateThemeCss(theme, 'desktop-windows'));
    expect(first.indexOf('data-design-overrides~="win-accent"')).toBeLessThan(first.indexOf('data-design-overrides~="button"'));
    expect(first.indexOf('data-design-overrides~="button"')).toBeLessThan(first.indexOf('data-design-overrides~="landscape"'));
  });

  it('matches component overrides only for the requested component', () => {
    const theme = createDefaultTheme(BASE);
    theme.overrides.push(
      { id: 'button-component', scope: 'component', componentId: 'button', tokens: { '--omp-size-radius': '8px' } },
      { id: 'other-component', scope: 'component', componentId: 'sidebar', tokens: { '--omp-size-radius': '20px' } },
    );
    expect(activeOverrideIds(theme, { ...context, componentId: 'button' })).toEqual(['button-component']);
    expect(resolveThemeTokens(theme, { ...context, componentId: 'button' })['--omp-size-radius']).toBe('8px');
  });

  it('emits state overrides only for their actual interaction state', () => {
    const theme = createDefaultTheme(BASE);
    const states = ['hover', 'focus', 'active', 'disabled', 'error'] as const;
    for (const state of states) {
      theme.overrides.push({
        id: `button-${state}`,
        scope: 'state',
        target: 'desktop-windows',
        screenId: 'settings',
        elementId: 'settings-continue',
        format: 'landscape',
        state,
        tokens: { '--omp-color-accent': '#112233' },
      });
    }
    const css = generateThemeCss(theme, 'desktop-windows');
    expect(css).toContain('[data-design-overrides~="button-hover"]:where(:hover)');
    expect(css).toContain('[data-design-overrides~="button-focus"]:where(:focus-visible)');
    expect(css).toContain('[data-design-overrides~="button-active"]:where(:active)');
    expect(css).toContain('[data-design-overrides~="button-disabled"]:where(:disabled)');
    expect(css).toContain('[data-design-overrides~="button-error"]:where([data-design-error="true"])');
    expect(css).not.toContain('[data-design-overrides~="button-hover"] {');
  });

  it('keeps state and default override specificity equal', () => {
    const theme = createDefaultTheme(BASE);
    theme.overrides.push(
      { id: 'component-hover', scope: 'component', componentId: 'button', state: 'hover', tokens: { '--omp-color-accent': '#111111' } },
      { id: 'element-default', scope: 'element', elementId: 'settings-continue', tokens: { '--omp-color-accent': '#222222' } },
    );
    const css = generateThemeCss(theme, 'desktop-windows');
    expect(css).toContain('[data-design-overrides~="component-hover"]:where(:hover)');
    expect(css.indexOf('component-hover')).toBeLessThan(css.indexOf('element-default'));
    expect(resolveThemeTokens(theme, { ...context, componentId: 'button', state: 'hover' })['--omp-color-accent']).toBe('#222222');
  });

  it('reports contrast and font size errors with their context', () => {
    const theme = createDefaultTheme(BASE);
    expect(checkTheme(theme, [context])).toEqual([]);
    theme.tokens['--omp-color-accent'] = '#000000';
    theme.tokens['--omp-size-font'] = '8px';
    expect(checkTheme(theme, [context])).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CONTRAST', target: 'desktop-windows' }),
      expect.objectContaining({ code: 'FONT_SIZE', token: '--omp-size-font' }),
    ]));
  });

  it('writes deterministic files and detects stale generated output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omp-theme-'));
    temporary.push(root);
    await mkdir(join(root, 'design', 'themes'), { recursive: true });
    await writeFile(join(root, 'design', 'themes', 'test.json'), JSON.stringify(createDefaultTheme(BASE)), 'utf8');

    const files = await writeGeneratedThemes(root);
    expect(files.map((file) => file.path)).toEqual([
      'design/generated/android-phone.css',
      'design/generated/android-tv.css',
      'design/generated/desktop-linux.css',
      'design/generated/desktop-macos.css',
      'design/generated/desktop-windows.css',
      'design/generated/layout.ts',
      'design/generated/lg-webos.css',
    ]);
    const windowsPath = join(root, 'design', 'generated', 'desktop-windows.css');
    const initial = await readFile(windowsPath, 'utf8');
    const second = await writeGeneratedThemes(root);
    expect(second).toEqual(files);
    expect(await readFile(windowsPath, 'utf8')).toBe(initial);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();

    await writeFile(windowsPath, initial + '\n/* stale */\n', 'utf8');
    await expect(checkGeneratedThemes(root)).rejects.toThrow('GENERATED_OUTDATED');
    expect(await readFile(windowsPath, 'utf8')).toBe(initial + '\n/* stale */\n');
  });

  it('accepts an empty themes directory before the first export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omp-theme-empty-'));
    temporary.push(root);
    expect(await writeGeneratedThemes(root)).toEqual([]);
    await expect(checkGeneratedThemes(root)).resolves.toBeUndefined();
  });
});
