/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { YandexAdsCard } from '../admin/src/panels/YandexAdsCard.tsx';
import type { YandexAdsSettings } from '../admin/src/lib/ads.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const value: YandexAdsSettings = {
  nativeUnitPhone: '',
  nativeUnitTv: '',
  bannerUnit: '',
  enabled: false,
  fallbackHouse: true,
  androidUnit: '',
  iosUnit: '',
  groups: {
    free: { enabled: true, everyN: 10, afterInstallDays: 3, maxPerSession: 0, maxPerDay: 0 },
    sub: { enabled: false, everyN: 10, afterInstallDays: 3, maxPerSession: 0, maxPerDay: 0 },
  },
};

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = createRoot(document.getElementById('app')!);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('Yandex ads card', () => {
  it('shows the master switch, both units and the two groups with their defaults', () => {
    act(() => {
      root.render(createElement(YandexAdsCard, { value, busy: false, onChange: () => {}, onSave: () => {} }));
    });
    expect(document.body.textContent).toContain('Реклама Яндекса');
    expect(document.body.textContent).toContain('Без подписки');
    expect(document.body.textContent).toContain('С подпиской');
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, true, false]);
    expect((document.getElementById('yandex-free-everyN') as HTMLInputElement).value).toBe('10');
    expect((document.getElementById('yandex-sub-everyN') as HTMLInputElement).value).toBe('10');
    expect((document.getElementById('yandex-android') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('yandex-ios') as HTMLInputElement).value).toBe('');
  });

  it('saves the subscription group and the Android unit the admin typed', () => {
    const onSave = vi.fn();
    let current = value;
    const render = () => {
      act(() => {
        root.render(
          createElement(YandexAdsCard, {
            value: current,
            busy: false,
            onChange: (next) => {
              current = next;
              render();
            },
            onSave,
          }),
        );
      });
    };
    render();
    const sub = document.querySelector('fieldset:nth-of-type(2) input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      sub.click();
    });
    const unit = document.getElementById('yandex-android') as HTMLInputElement;
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    act(() => {
      proto!.set!.call(unit, 'R-M-100-1');
      unit.dispatchEvent(new Event('input', { bubbles: true }));
      unit.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const every = document.getElementById('yandex-free-everyN') as HTMLInputElement;
    act(() => {
      proto!.set!.call(every, '8');
      every.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Сохранить рекламу Яндекса');
    act(() => save!.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    const sent = onSave.mock.calls[0][0] as YandexAdsSettings;
    expect(sent.androidUnit).toBe('R-M-100-1');
    expect(sent.fallbackHouse).toBe(true);
    expect(sent.groups.free.everyN).toBe('8');
    expect(sent.groups.sub.enabled).toBe(true);
    expect(sent.groups.free.enabled).toBe(true);
  });
});
