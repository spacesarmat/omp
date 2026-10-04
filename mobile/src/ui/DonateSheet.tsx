import { useEffect, useState } from 'preact/hooks';
import { Clipboard } from '@capacitor/clipboard';
import { Sheet } from './Sheet';
import { sheetBackHandler } from './UpdateSheet';
import { showToast } from './toast';
import { donateOpen, closeDonate, activeMethods, applySupportCode, activeSupportUntil, supportShared, supportThanks, type DonateMethod } from '../donate';

export interface DonateActions {
  openUrl(url: string): void;
  copy(text: string): Promise<unknown>;
  /** Text of the clipboard («Вставить» of the support code). */
  paste(): Promise<string>;
}

const defaults: DonateActions = {
  openUrl: (url) => {
    window.open(url, '_system');
  },
  copy: (text) => Clipboard.write({ string: text }),
  paste: () => Clipboard.read().then((r) => (r && typeof r.value === 'string' ? r.value : '')),
};

let actions: DonateActions = defaults;

/** Replaces the link opener / clipboard (tests); no argument restores the real ones. */
export function setDonateActions(a?: Partial<DonateActions>): void {
  actions = { ...defaults, ...a };
}

/** «Уже поддержали?»: the support code field; a valid code hides the prompts on the phone and the TVs. */
function SupportCodeBox() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const paste = async () => {
    try {
      const t = await actions.paste();
      if (t) {
        setCode(t.trim());
        setError('');
      } else showToast('Буфер обмена пуст');
    } catch (e) {
      showToast('Не удалось вставить');
    }
  };
  const apply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await applySupportCode(code);
      if (r.ok) {
        setError('');
        setCode('');
      } else setError(r.error);
    } catch (e) {
      setError('Код не подходит');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="m-support">
      <div class="m-support-title">Уже поддержали?</div>
      <div class="m-muted m-small m-support-text">
        Код поддержки опубликован на Boosty для подписчиков и меняется каждый месяц. С кодом OMP не просит о поддержке ни на телефоне, ни на телевизорах.
      </div>
      <label class="m-support-label">
        Код поддержки
        <input
          class="m-input m-support-input"
          type="text"
          value={code}
          placeholder="OMP-ГГГГ-ММ-…"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          onInput={(e) => {
            setCode((e.currentTarget as HTMLInputElement).value);
            setError('');
          }}
        />
      </label>
      <div class="m-support-actions">
        <button type="button" class="m-btn m-btn-secondary m-btn-sm" onClick={() => void paste()}>
          Вставить
        </button>
        <button type="button" class="m-btn m-btn-primary m-btn-sm" disabled={busy || !code.trim()} onClick={() => void apply()}>
          Применить
        </button>
      </div>
      {error && (
        <div class="m-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** «Поддержать OMP»: a short text and a button per configured method. */
export function DonateSheet({ methods }: { methods?: DonateMethod[] }) {
  const open = donateOpen.value;
  useEffect(() => {
    if (!open) return;
    const h = () => {
      closeDonate();
      return true;
    };
    sheetBackHandler.current = h;
    return () => {
      if (sheetBackHandler.current === h) sheetBackHandler.current = null;
    };
  }, [open]);
  if (!open) return null;
  const list = activeMethods(methods);
  const until = activeSupportUntil();
  const copy = async (address: string) => {
    try {
      await actions.copy(address);
      showToast('Адрес скопирован');
    } catch (e) {
      showToast('Не удалось скопировать');
    }
  };
  return (
    <Sheet label="Поддержать OMP" onClose={closeDonate}>
      <div class="m-sheet-title">Поддержать OMP</div>
      <div class="m-sheet-scroll m-donate">
        <p>OMP бесплатный и без рекламы. Если он вам полезен — можно поддержать разработку. Все функции остаются бесплатными.</p>
        {list.map((m) =>
          m.id === 'crypto' ? (
            <div class="m-donate-crypto" key={m.id}>
              <div class="m-set-label">{m.title}</div>
              {(m.wallets || []).map((w) => (
                <div class="m-set-row" key={w.network + w.address}>
                  <div class="m-set-text">
                    <span>{w.network}</span>
                    <span class="m-muted m-small m-donate-addr">{w.address}</span>
                  </div>
                  <button type="button" class="m-btn m-btn-secondary m-btn-sm" aria-label={'Скопировать адрес ' + w.network} onClick={() => void copy(w.address)}>
                    Скопировать
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <button type="button" class="m-btn m-btn-primary" key={m.id} onClick={() => actions.openUrl(m.url as string)}>
              {'Поддержать на ' + m.title}
            </button>
          ),
        )}
        <SupportCodeBox />
        {until > 0 && (
          <div class="m-support-ok" role="status">
            {supportThanks(until, supportShared())}
          </div>
        )}
      </div>
      <button type="button" class="m-btn m-btn-secondary" onClick={closeDonate}>
        Закрыть
      </button>
    </Sheet>
  );
}
