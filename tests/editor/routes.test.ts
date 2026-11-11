import { describe, expect, it } from 'vitest';
import { DESIGN_TARGETS } from '../../design/schema';
import { createDefaultDraft, parseEditorDraft } from '../../editor/shared/draft';
import { getDefaultElementId, getEditorPages, getEditorViewport, isEditorRoute } from '../../editor/shared/routes';

const BASE = '0000000000000000000000000000000000000000';

describe('editor platform routes', () => {
  it('supports all design targets with platform-specific pages', () => {
    expect(DESIGN_TARGETS).toHaveLength(6);
    expect(getEditorPages('desktop-windows').map((page) => page.id)).toEqual(['library', 'news', 'search', 'remote', 'settings', 'connect']);
    expect(getEditorPages('android-phone').map((page) => page.id)).toEqual(['library', 'news', 'search', 'remote', 'settings', 'connect']);
    for (const target of ['android-tv', 'lg-webos'] as const) {
      expect(getEditorPages(target).map((page) => page.id)).toEqual(['library', 'search', 'settings', 'connect']);
      expect(isEditorRoute(target, 'settings')).toBe(true);
      expect(isEditorRoute(target, 'news')).toBe(false);
    }
  });

  it('uses native viewport dimensions per platform', () => {
    expect(getEditorViewport('desktop-windows', 'landscape')).toEqual({ width: 1280, height: 720 });
    expect(getEditorViewport('desktop-windows', 'portrait')).toEqual({ width: 720, height: 960 });
    expect(getEditorViewport('android-phone', 'portrait')).toEqual({ width: 720, height: 960 });
    expect(getEditorViewport('android-phone', 'landscape')).toEqual({ width: 960, height: 720 });
    expect(getEditorViewport('android-tv', 'portrait')).toEqual({ width: 1920, height: 1080 });
    expect(getEditorViewport('lg-webos', 'landscape')).toEqual({ width: 1920, height: 1080 });
  });

  it('accepts phone and TV drafts and selects valid default elements', () => {
    for (const target of ['android-phone', 'android-tv', 'lg-webos'] as const) {
      const draft = createDefaultDraft('draft-1', BASE);
      draft.target = target;
      expect(parseEditorDraft(draft).target).toBe(target);
      expect(getDefaultElementId(target)).toBe('legacy-page');
    }
    expect(getDefaultElementId('desktop-windows')).toBe('content');
  });
});
