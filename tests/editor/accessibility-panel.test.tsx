import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibilityPanel } from '../../editor/src/components/AccessibilityPanel';
import type { LayoutIssue } from '../../design/layout-checks';

let host: HTMLDivElement;

function mount(props: Partial<Parameters<typeof AccessibilityPanel>[0]> = {}) {
  const onGeometryConfirm = props.onGeometryConfirm ?? vi.fn();
  act(() => render(h(AccessibilityPanel, {
    issues: [],
    geometryConfirmed: false,
    onGeometryConfirm,
    ...props,
  }), host));
  return { onGeometryConfirm };
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
});

const ERROR: LayoutIssue = { code: 'CONTRAST', nodeId: 'title', severity: 'error', message: 'contrast 2.10:1 below 4.5:1' };
const WARNING: LayoutIssue = { code: 'OVERLAP', nodeId: 'card-2', severity: 'warning', message: 'overlaps interactive node card-1' };

describe('AccessibilityPanel', () => {
  it('renders the summary and every issue with severity, code, node and message', () => {
    mount({ issues: [ERROR, WARNING] });
    expect(host.textContent).toContain('Доступность');
    const summary = host.querySelector('[data-testid="accessibility-summary"]')!;
    expect(summary.textContent).toContain('1');
    const items = [...host.querySelectorAll('[data-testid="accessibility-issues"] li')];
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-severity')).toBe('error');
    expect(items[0].textContent).toContain('CONTRAST');
    expect(items[0].textContent).toContain('title');
    expect(items[0].textContent).toContain('contrast 2.10:1 below 4.5:1');
    expect(items[1].getAttribute('data-severity')).toBe('warning');
    expect(items[1].textContent).toContain('OVERLAP');
    expect(items[1].textContent).toContain('card-2');
  });

  it('shows the geometry confirmation checkbox only while warnings are unresolved', () => {
    const onGeometryConfirm = vi.fn();
    mount({ issues: [ERROR], onGeometryConfirm });
    expect(host.querySelector('[data-testid="confirm-geometry-warnings"]')).toBeNull();
    act(() => render(null, host));
    mount({ issues: [ERROR, WARNING], onGeometryConfirm });
    const checkbox = host.querySelector<HTMLInputElement>('[data-testid="confirm-geometry-warnings"]')!;
    expect(checkbox.checked).toBe(false);
    act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onGeometryConfirm).toHaveBeenCalledWith(true);
  });

  it('reflects the confirmed state and a clean bill', () => {
    mount({ issues: [WARNING], geometryConfirmed: true });
    const checkbox = host.querySelector<HTMLInputElement>('[data-testid="confirm-geometry-warnings"]')!;
    expect(checkbox.checked).toBe(true);
    act(() => render(null, host));
    mount({ issues: [] });
    expect(host.textContent).toContain('Проблем не найдено');
    expect(host.querySelector('[data-testid="confirm-geometry-warnings"]')).toBeNull();
  });
});
