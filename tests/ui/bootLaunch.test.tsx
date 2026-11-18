import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression of the beta.11 incident: the TV start must apply the phone launch even on
// the old WebView (SVG elements without dataset) and when the design runtime throws.

const LAUNCH = JSON.stringify({ play: 'http://h/v.mp4', title: 'T' });

let svgDataset: PropertyDescriptor | undefined;

async function boot(): Promise<void> {
  document.body.innerHTML = '<div id="app"></div><svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
  (window as unknown as { PalmSystem?: unknown }).PalmSystem = { launchParams: LAUNCH };
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
  await import('../../src/main');
}

async function routeName(): Promise<string> {
  const { currentRoute } = await import('../../src/ui/nav');
  return currentRoute.value.name;
}

beforeEach(() => {
  vi.resetModules();
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  svgDataset = Object.getOwnPropertyDescriptor(window.SVGElement.prototype, 'dataset');
});

afterEach(() => {
  if (svgDataset) Object.defineProperty(window.SVGElement.prototype, 'dataset', svgDataset);
  else delete (window.SVGElement.prototype as { dataset?: unknown }).dataset;
  delete (window as unknown as { PalmSystem?: unknown }).PalmSystem;
  // main.tsx registers the design runtime cleanup on pagehide: stop the observers
  // before the next test boots, so the cases do not share a live runtime.
  window.dispatchEvent(new Event('pagehide'));
  document.body.innerHTML = '';
  vi.doUnmock('../../design/production.ts');
  vi.unstubAllGlobals();
});

describe('TV boot applies the phone launch', () => {
  it('old WebView: SVG without dataset does not abort the start', async () => {
    Object.defineProperty(window.SVGElement.prototype, 'dataset', { get: () => undefined, configurable: true });
    await boot();
    expect(await routeName()).toBe('player');
  });

  it('a design runtime failure does not swallow the launch', async () => {
    vi.doMock('../../design/production.ts', () => ({
      installProductionDesign: () => {
        throw new Error("Cannot read property 'designId' of undefined");
      },
    }));
    await boot();
    expect(await routeName()).toBe('player');
  });
});
