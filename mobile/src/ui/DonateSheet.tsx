import { useEffect } from 'preact/hooks';
import { Clipboard } from '@capacitor/clipboard';
import { Sheet } from './Sheet';
import { sheetBackHandler } from './UpdateSheet';
import { showToast } from './toast';
import { donateOpen, closeDonate, activeMethods, type DonateMethod } from '../donate';

export interface DonateActions {
  openUrl(url: string): void;
  copy(text: string): Promise<unknown>;
}

const defaults: DonateActions = {
  openUrl: (url) => {
    window.open(url, '_system');
  },
  copy: (text) => Clipboard.write({ string: text }),
};

let actions: DonateActions = defaults;

/** Replaces the link opener / clipboard (tests); no argument restores the real ones. */
export function setDonateActions(a?: Partial<DonateActions>): void {
  actions = { ...defaults, ...a };
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
        <p>OMP бесплатный и без рекламы. Если он вам полезен, можно поддержать разработку. Все функции остаются бесплатными, а приложение ничего не отправляет и не собирает.</p>
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
              {m.title}
            </button>
          ),
        )}
      </div>
      <button type="button" class="m-btn m-btn-secondary" onClick={closeDonate}>
        Закрыть
      </button>
    </Sheet>
  );
}
