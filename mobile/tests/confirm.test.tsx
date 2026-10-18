import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'preact/test-utils';
import { applyLanguageSetting, t, tp } from '../../src/i18n';
import { runBack } from '../src/ui/backStack';
import { askConfirm } from '../src/ui/confirm';
import { acceptConfirm, confirmText, declineConfirm, mountConfirmHost, unmountConfirmHost } from './confirmHost';

afterEach(() => {
  unmountConfirmHost();
  applyLanguageSetting('ru');
});

describe('in-app confirm', () => {
  it('a delete question is a dark dialog: red confirm, localized cancel, back and backdrop dismiss', async () => {
    mountConfirmHost();
    let answer!: Promise<boolean>;
    act(() => {
      answer = askConfirm('Удалить раздачу «Quiet Signal»?', t('common.delete'), { destructive: true });
    });
    const dialog = document.querySelector('[role=dialog]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(confirmText()).toBe('Удалить раздачу «Quiet Signal»?');
    const ok = document.querySelector('[data-confirm="danger"]') as HTMLElement;
    expect(ok.textContent).toBe('Удалить');
    expect(ok.classList.contains('m-btn-danger')).toBe(true);
    expect(document.querySelector('[data-confirm-cancel]')!.textContent).toBe('Отмена');
    act(() => {
      runBack();
    });
    expect(await answer).toBe(false);
    expect(document.querySelector('[data-confirm-host]')).toBeNull();

    let again!: Promise<boolean>;
    act(() => {
      again = askConfirm('Удалить раздачу «Quiet Signal»?', t('common.delete'), { destructive: true });
    });
    act(() => (document.querySelector('.m-confirm-host .m-sheet-backdrop') as HTMLButtonElement).click());
    expect(await again).toBe(false);
  });

  it('the confirm button resolves true; a second question cancels the first', async () => {
    mountConfirmHost();
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = askConfirm('первая', t('common.delete'), { destructive: true });
    });
    act(() => {
      second = askConfirm('вторая', t('tvSettings.clear'));
    });
    expect(confirmText()).toBe('вторая');
    expect(document.querySelector('[data-confirm="ok"]')!.textContent).toBe('Очистить');
    await acceptConfirm();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });

  it('«Отмена» declines', async () => {
    mountConfirmHost();
    let answer!: Promise<boolean>;
    act(() => {
      answer = askConfirm('Очистить журнал?', t('tvSettings.clear'));
    });
    await declineConfirm();
    expect(await answer).toBe(false);
  });

  it('keep-only copy counts the extra torrents in Russian and English', () => {
    expect(tp('series.keepOnlyAsk', 1, { season: '2' })).toBe('Удалить ещё 1 раздачу 2-го сезона?');
    expect(tp('series.keepOnlyAsk', 2, { season: '2' })).toBe('Удалить ещё 2 раздачи 2-го сезона?');
    expect(tp('series.keepOnlyAsk', 5, { season: '2' })).toBe('Удалить ещё 5 раздач 2-го сезона?');
    expect(tp('series.keepOnlyAskNoSeason', 1)).toBe('Удалить ещё 1 раздачу без сезона?');
    expect(tp('series.keepOnlyAskNoSeason', 3)).toBe('Удалить ещё 3 раздачи без сезона?');
    expect(tp('series.keepOnlyAskNoSeason', 5)).toBe('Удалить ещё 5 раздач без сезона?');
    applyLanguageSetting('en');
    expect(tp('series.keepOnlyAsk', 1, { season: '2' })).toBe('Delete 1 more torrent of season 2?');
    expect(tp('series.keepOnlyAsk', 2, { season: '2' })).toBe('Delete 2 more torrents of season 2?');
    expect(tp('series.keepOnlyAskNoSeason', 1)).toBe('Delete 1 more torrent with no season?');
    expect(tp('series.keepOnlyAskNoSeason', 4)).toBe('Delete 4 more torrents with no season?');
    expect(t('common.cancel')).toBe('Cancel');
    expect(t('common.delete')).toBe('Delete');
    expect(t('series.keepOnly')).toBe('Keep only this one');
  });
});
