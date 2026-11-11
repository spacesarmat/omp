import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let shellStyle: HTMLStyleElement;
let mobileStyle: HTMLStyleElement;
let host: HTMLDivElement;

beforeEach(() => {
  const shellCss = readFileSync(join(process.cwd(), 'desktop/src/shell/shell.css'), 'utf8')
    .replace(/var\(--omp-size-radius, 12px\)/g, '24px');
  const mobileCss = readFileSync(join(process.cwd(), 'mobile/src/mobile.css'), 'utf8');
  shellStyle = document.createElement('style');
  mobileStyle = document.createElement('style');
  shellStyle.textContent = shellCss;
  mobileStyle.textContent = mobileCss;
  document.head.append(shellStyle, mobileStyle);
  host = document.createElement('div');
  host.innerHTML = '<div class="desktop-legacy"><button class="m-btn"></button><div class="m-card"></div></div>';
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  shellStyle.remove();
  mobileStyle.remove();
});

describe('legacy page CSS adapter', () => {
  it('applies the edited radius over legacy mobile rules', () => {
    expect(getComputedStyle(host.querySelector('.m-btn')!).borderRadius).toBe('24px');
  });

  it('does not add a radius to cards that have no legacy radius', () => {
    expect(getComputedStyle(host.querySelector('.m-card')!).borderRadius).toBe('');
  });
});
