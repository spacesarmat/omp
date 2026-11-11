import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPreviewFixture } from '../src/preview/fixtures';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
});

describe('preview network isolation', () => {
  it('blocks external fetch and XHR while preserving same-origin calls and cleanup', async () => {
    const originalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const originalOpen = XMLHttpRequest.prototype.open;
    cleanup = installPreviewFixture({ serverConnected: false, language: 'ru' });

    const external = await fetch('https://external.invalid/data');
    expect(external.status).toBe(503);
    expect(originalFetch).not.toHaveBeenCalled();
    await fetch('/api/health');
    expect(originalFetch).toHaveBeenCalledTimes(1);
    const xhr = new XMLHttpRequest();
    expect(() => xhr.open('GET', 'https://external.invalid/data')).toThrow('Preview network is disabled');

    cleanup();
    cleanup = undefined;
    expect(globalThis.fetch).toBe(originalFetch);
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
  });
});
