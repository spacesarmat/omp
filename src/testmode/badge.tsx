import type { ComponentChildren } from 'preact';
import { t } from '../i18n';
import { platformKind } from '../platform/env';
import { libraryTab } from '../store/library';
import { toast } from '../ui/toast';
import { currentRoute } from '../ui/nav';
import { testLabels } from './active';
import { anchorItem, dialogById, lookupScreen } from './registry';

/** The code to paint for a focus key, or '' when labels are off or the key is not registered. */
export function visibleCode(anchor: string, value?: string): string {
  if (!testLabels.value || !anchor) return '';
  const it = anchorItem(anchor);
  if (!it) return '';
  const options = it.options || [];
  if (value !== undefined) {
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === value) return options[i].code;
    }
  }
  return it.code;
}

export function visibleDialogCode(id: string): string {
  if (!testLabels.value || !id) return '';
  const d = dialogById(id);
  return d ? d.code : '';
}

/** A dialog-local anchor (`value:`, `index:N`, `input`, `ok`, `cancel`) or a focus key that belongs to this dialog. */
export function visibleDialogItem(id: string, anchor: string, value?: string): string {
  if (!testLabels.value || !id || !anchor) return '';
  const d = dialogById(id);
  if (!d) return '';
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i];
    let hit = false;
    for (let j = 0; j < it.anchors.length; j++) if (it.anchors[j] === anchor) hit = true;
    if (!hit) continue;
    const options = it.options || [];
    if (value !== undefined) {
      for (let o = 0; o < options.length; o++) {
        if (options[o].value === value) return options[o].code;
      }
    }
    return it.code;
  }
  const global = anchorItem(anchor);
  if (global && global.code.indexOf(d.code + '.') === 0) return global.code;
  return '';
}

/** Code of one row in a choose() / confirm() dialog. */
export function visibleDialogOption(id: string, value: unknown, index: number): string {
  const byValue = visibleDialogItem(id, 'value:' + String(value));
  if (byValue) return byValue;
  const byIndex = visibleDialogItem(id, 'index:' + index);
  if (byIndex) return byIndex;
  if (!testLabels.value || !id) return '';
  const d = dialogById(id);
  if (!d) return '';
  const s = String(value);
  for (let i = 0; i < d.items.length; i++) {
    const options = d.items[i].options || [];
    for (let o = 0; o < options.length; o++) {
      if (options[o].value === s) return options[o].code;
    }
  }
  return '';
}

/** Resolves the badge text for a focusable. Reads the test-mode signal. */
export function badgeFor(p: { testCode?: string; testAnchor?: string; focusKey?: string; testValue?: unknown }): string {
  if (!testLabels.value) return '';
  if (p.testCode !== undefined) return p.testCode;
  const anchor = p.testAnchor || p.focusKey || '';
  if (p.testValue === undefined) return visibleCode(anchor);
  return visibleCode(anchor, String(p.testValue));
}

export function testAnchorClass(base: string, code: string): string {
  return code ? base + ' test-anchor' : base;
}

/** Corner badge. Not focusable; pointer events are off so the remote and clicks hit the control. */
export function TestBadge(p: { code: string }): ComponentChildren {
  if (!p.code) return null;
  return <span class="test-badge" aria-hidden="true">{p.code}</span>;
}

/** The dialog's own code, in the corner of the box. */
export function DialogBadge(p: { id: string }): ComponentChildren {
  const code = visibleDialogCode(p.id);
  if (!code) return null;
  return <span class="test-badge" aria-hidden="true">{code}</span>;
}

/** The open screen's code, fixed in the corner. A pointer click copies it. Not in the focus tree. */
export function ScreenCodeBadge() {
  if (!testLabels.value) return null;
  const r = currentRoute.value;
  const screen = lookupScreen(r.name, libraryTab.value, platformKind());
  if (!screen) return null;
  const code = screen.code;
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    const clip = navigator.clipboard;
    if (clip && clip.writeText) {
      clip.writeText(code).then(() => undefined, () => undefined);
    }
    toast(t('settings.testModeCopied', { code: code }));
  };
  return (
    <div class="test-screen-badge" onClick={copy}>
      <span class="test-badge">{code}</span>
    </div>
  );
}
