import { describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { IrPanel } from '../src/ui/IrPanel';
import { MacForm } from '../src/ui/MacForm';
import { PowerBanner } from '../src/ui/PowerBanner';

let el: HTMLElement;

function mount(node: preact.VNode) {
  document.body.innerHTML = '<div id="app"></div>';
  el = document.getElementById('app')!;
  act(() => render(node, el));
}

function click(sel: string) {
  act(() => (el.querySelector(sel) as HTMLElement).click());
}

describe('power banner', () => {
  it('shows Включить and the Wake-on-LAN hint for an offline device', () => {
    const onWake = vi.fn();
    mount(<PowerBanner offline name="LG OLED" onWake={onWake} />);
    const wake = el.querySelector('[data-code="P08.2"]') as HTMLButtonElement;
    expect(wake.textContent).toBe('Включить');
    click('[data-code="P08.2"]');
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(el.textContent).not.toContain('Wake-on-LAN');
    click('[data-code="P08.3"]');
    expect(el.textContent).toContain('LG');
    expect(el.textContent).toContain('Samsung');
    expect(el.textContent).toContain('Android TV');
  });

  it('hides the banner while the device is online', () => {
    mount(<PowerBanner offline={false} name="LG OLED" onWake={vi.fn()} />);
    expect(el.querySelector('[data-code="P08.2"]')).toBeNull();
  });
});

describe('manual MAC', () => {
  it('rejects a bad MAC and saves a good one', () => {
    const onAdd = vi.fn();
    mount(<MacForm onAdd={onAdd} />);
    const mac = el.querySelector('input[name="mac"]') as HTMLInputElement;
    const name = el.querySelector('input[name="name"]') as HTMLInputElement;
    mac.value = 'nope';
    name.value = 'Зал';
    mac.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('input', { bubbles: true }));
    click('[data-code="P10.2"]');
    expect(onAdd).not.toHaveBeenCalled();
    expect(el.textContent).toContain('MAC');
    mac.value = 'AA-BB-CC-DD-EE-FF';
    mac.dispatchEvent(new Event('input', { bubbles: true }));
    click('[data-code="P10.2"]');
    expect(onAdd).toHaveBeenCalledWith({ name: 'Зал', mac: 'aa:bb:cc:dd:ee:ff', ip: undefined });
  });
});

describe('IR panel', () => {
  const button = { id: 'b1', name: 'Питание' };

  it('hides itself when the phone has no IR blaster', () => {
    mount(<IrPanel hardware={{ transmit: false, receive: false }} buttons={[]} onTest={vi.fn()} onDelete={vi.fn()} onLearn={vi.fn()} onImport={vi.fn()} />);
    expect(el.querySelector('[data-code="P08.4"]')).toBeNull();
  });

  it('tests a brand code and hides native learning when the phone cannot receive', () => {
    const onTest = vi.fn();
    mount(<IrPanel hardware={{ transmit: true, receive: false }} buttons={[button]} onTest={onTest} onDelete={vi.fn()} onLearn={vi.fn()} onImport={vi.fn()} />);
    expect(el.querySelector('[data-code="P08.6"]')).toBeNull();
    expect(el.textContent).toContain('Питание');
    click('[data-code="P08.5"]');
    expect(onTest).toHaveBeenCalledWith('lg');
  });

  it('offers native learning when the phone exposes a receiver', () => {
    const onLearn = vi.fn();
    mount(<IrPanel hardware={{ transmit: true, receive: true }} buttons={[]} onTest={vi.fn()} onDelete={vi.fn()} onLearn={onLearn} onImport={vi.fn()} />);
    click('[data-code="P08.6"]');
    expect(onLearn).toHaveBeenCalledTimes(1);
  });

  it('deletes a learned button', () => {
    const onDelete = vi.fn();
    mount(<IrPanel hardware={{ transmit: true, receive: false }} buttons={[button]} onTest={vi.fn()} onDelete={onDelete} onLearn={vi.fn()} onImport={vi.fn()} />);
    click('[data-code="P08.7"]');
    expect(onDelete).toHaveBeenCalledWith('b1');
  });
});
