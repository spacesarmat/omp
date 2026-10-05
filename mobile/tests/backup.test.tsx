import { applyLanguageSetting } from '../../src/i18n';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Backup, setBackupActions } from '../src/screens/Backup';
import { Settings } from '../src/screens/Settings';
import { currentRoute, resetTo } from '../src/nav';
import { toast } from '../src/ui/toast';
import { localServer } from '../src/server/localServer';
import { clearLog, logEntries } from '../../src/lib/log';

function mount(ui: preact.VNode): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const el = document.getElementById('app')!;
  act(() => render(ui, el));
  return el;
}
const btn = (el: HTMLElement, t: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.includes(t))!;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const NOW = new Date(2026, 9, 3, 12).getTime();
const SERVER = { id: 's1', name: 'Дом', url: 'http://192.168.1.5:8090', password: 'pw' };

function fake(over: Record<string, unknown> = {}) {
  const c = { share: [] as { name: string; text: string }[], reloads: 0 };
  setBackupActions({
    shareText: (o) => {
      c.share.push(o);
      return Promise.resolve();
    },
    readFile: (f) => Promise.resolve((f as unknown as { _t: string })._t),
    reload: () => void c.reloads++,
    now: () => NOW,
    ...over,
  });
  return c;
}

async function pick(el: HTMLElement, text: string, size?: number) {
  const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
  const f = { _t: text, size: size ?? text.length } as unknown as File;
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  clearLog();
  toast.value = '';
  resetTo({ name: 'settings' });
  localServer.value = { supported: false, running: false };
});
afterEach(() => setBackupActions(null));

const copy = (data: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'omp-backup', v: 1, omp: '0.14.0', at: '2026-10-03T09:00:00Z', data, ...over });

describe('Backup screen', () => {
  it('is reachable from Settings', async () => {
    const el = mount(<Settings />);
    await act(async () => btn(el, 'Резервная копия').click());
    expect(currentRoute.value.name).toBe('backup');
  });

  it('shows what is and is not saved, the file name and the warning', () => {
    fake();
    const el = mount(<Backup />);
    const t = el.textContent!;
    expect(t).toContain('Серверы TorrServer и их имена');
    expect(t).toContain('Пароли трекеров и cookie');
    expect(t).toContain('omp-копия-2026-10-03.json');
    expect(t).toContain('храните файл как пароль');
  });

  it('saves: shares the allowlisted copy under the dated name', async () => {
    localStorage.setItem('tsp.servers', JSON.stringify([SERVER]));
    localStorage.setItem('tsp.log', JSON.stringify([{ t: 1, l: 'info', a: 'app', x: 'личное' }]));
    const c = fake();
    const el = mount(<Backup />);
    await act(async () => btn(el, 'Сохранить копию').click());
    await settle();
    expect(c.share).toHaveLength(1);
    expect(c.share[0].name).toBe('omp-копия-2026-10-03.json');
    const parsed = JSON.parse(c.share[0].text);
    expect(Object.keys(parsed.data)).toEqual(['tsp.servers']);
    expect(c.share[0].text).not.toContain('личное');
  });

  it('reports a share failure in Russian and logs generically', async () => {
    fake({ shareText: () => Promise.reject(new Error('Нет приложения для отправки файла')) });
    const el = mount(<Backup />);
    await act(async () => btn(el, 'Сохранить копию').click());
    await settle();
    expect(toast.value).toBe('Нет приложения для отправки файла');
    expect(logEntries().some((e) => e.l === 'error' && e.a === 'app')).toBe(true);
  });

  it('restore: shows the contents, then replaces on confirm and reloads', async () => {
    localStorage.setItem('tsp.servers', JSON.stringify([{ id: 'old', name: 'Старый', url: 'http://o:1' }]));
    const c = fake();
    const el = mount(<Backup />);
    await pick(el, copy({ 'tsp.servers': [SERVER], 'tsp.settings': { libraryView: 'list' } }));
    expect(el.textContent).toContain('Серверов TorrServer: 1 (Дом)');
    expect(JSON.parse(localStorage.getItem('tsp.servers')!)[0].id).toBe('old'); // nothing yet
    await act(async () => btn(el, 'Заменить данные').click());
    expect(JSON.parse(localStorage.getItem('tsp.servers')!)).toEqual([SERVER]);
    expect(JSON.parse(localStorage.getItem('tsp.settings')!).libraryView).toBe('list');
    expect(c.reloads).toBe(1);
  });

  it('cancel leaves the phone untouched', async () => {
    localStorage.setItem('tsp.servers', JSON.stringify([{ id: 'old', name: 'Старый', url: 'http://o:1' }]));
    const c = fake();
    const el = mount(<Backup />);
    await pick(el, copy({ 'tsp.servers': [SERVER] }));
    await act(async () => btn(el, 'Отмена').click());
    expect(JSON.parse(localStorage.getItem('tsp.servers')!)[0].id).toBe('old');
    expect(c.reloads).toBe(0);
    expect(el.textContent).toContain('Сохранить копию');
  });

  it('shows a clear message for a wrong file and does not log its contents', async () => {
    fake();
    const el = mount(<Backup />);
    await pick(el, '{"format":"other","секрет":"hunter2"}');
    expect(el.querySelector('[role=alert]')!.textContent).toBe('Это не копия OMP');
    await pick(el, copy({ 'tsp.servers': [SERVER] }, { v: 5 }));
    expect(el.querySelector('[role=alert]')!.textContent).toContain('более новой версией');
    expect(JSON.stringify(logEntries())).not.toContain('hunter2');
    expect(logEntries().length).toBeGreaterThan(0);
  });

  it('rejects an oversized file without reading it', async () => {
    let read = 0;
    fake({
      readFile: () => {
        read++;
        return Promise.resolve('');
      },
    });
    const el = mount(<Backup />);
    await pick(el, 'x', 6 * 1024 * 1024);
    expect(read).toBe(0);
    expect(el.querySelector('[role=alert]')!.textContent).toContain('слишком большой');
  });

  it("apply failure: screen leaves the review, shows the error, no reload, nothing changed", async () => {
    localStorage.setItem("tsp.servers", JSON.stringify([{ id: "old", name: "Старый", url: "http://o:1" }]));
    const c = fake();
    const el = mount(<Backup />);
    await pick(el, copy({ "tsp.servers": [SERVER], "tsp.settings": { libraryView: "list" } }));
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k === "tsp.settings") throw new Error("quota");
      return real.call(this, k, v);
    };
    try {
      await act(async () => btn(el, "Заменить данные").click());
    } finally {
      Storage.prototype.setItem = real;
    }
    expect(c.reloads).toBe(0);
    expect(el.querySelector("[role=alert]")!.textContent).toContain("Не удалось записать");
    expect(JSON.parse(localStorage.getItem("tsp.servers")!)[0].id).toBe("old");
    expect(el.textContent).toContain("Сохранить копию");
  });

  it("a double tap on save shares once", async () => {
    let release: () => void = () => {};
    const c = fake({
      shareText: (o: { name: string; text: string }) => {
        c.share.push(o);
        return new Promise<void>((r) => (release = r));
      },
    });
    const el = mount(<Backup />);
    await act(async () => {
      btn(el, "Сохранить копию").click();
      btn(el, "Сохранить копию").click();
    });
    release();
    await settle();
    expect(c.share).toHaveLength(1);
  });

  it("the picker accepts text files too", () => {
    fake();
    const el = mount(<Backup />);
    expect(el.querySelector("input[type=file]")!.getAttribute("accept")).toContain(".txt");
    expect(el.textContent).toContain("Избранные плейлисты и выбор дорожек");
  });
});

describe('Backup screen in English', () => {
  beforeEach(() => applyLanguageSetting('en'));


  it('lists what is saved and offers save and restore', () => {
    fake();
    const el = mount(<Backup />);
    expect(el.querySelector('h1')!.textContent).toBe('Backup');
    expect(el.textContent).toContain('What is saved');
    expect(el.textContent).toContain('TorrServer servers and their names');
    expect(el.textContent).toContain('Tracker passwords and cookies — enter them again');
    expect(el.textContent).toContain('History and “Skip” — they are on TorrServer');
    expect(btn(el, 'Save the backup…')).toBeTruthy();
    expect(btn(el, 'Restore from a file…')).toBeTruthy();
    expect(el.querySelector('[aria-label="Backup file"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Back"]')).toBeTruthy();
    expect(el.textContent).not.toMatch(/[А-Яа-яЁё]/);
  });

  it('a share failure without a message is reported in English', async () => {
    fake({ shareText: () => Promise.reject(null) });
    const el = mount(<Backup />);
    await act(async () => btn(el, 'Save the backup…').click());
    await settle();
    expect(toast.value).toBe('Could not save the backup');
    expect(logEntries().some((e) => e.l === 'error' && e.x === 'Could not share the settings backup')).toBe(true);
  });

  it('review: what is in the file and the replace button', async () => {
    fake();
    const el = mount(<Backup />);
    await pick(el, copy({ 'tsp.servers': [{ id: 'h', name: 'Home', url: 'http://h:1' }] }));
    expect(el.textContent).toContain('What is in the file');
    expect(el.textContent).toContain('Backup from 2026-10-03, OMP 0.14.0.');
    expect(el.textContent).toContain('Restoring replaces this data on the phone. Everything else stays as it is.');
    expect(btn(el, 'Replace the data on the phone')).toBeTruthy();
    expect(btn(el, 'Cancel')).toBeTruthy();
  });
});
